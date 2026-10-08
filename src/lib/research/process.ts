import type { SupabaseClient } from "@supabase/supabase-js";
import { auditWebsite } from "@/lib/enrichment/website-audit";
import { classifyNoWebsite, classifyWebsite, type WebsiteClassification } from "@/lib/intel/website-classify";
import { computeLeadScore, computeSalesIntent, tierFor } from "@/lib/intel/scoring";
import { buildOpportunities } from "@/lib/intel/opportunities";
import { qualify, type QualificationResult } from "@/lib/intel/qualification";
import { classifyBusinessSize, detectFranchise, isKnownChain } from "@/lib/intel/classify-business";
import type { BusinessSignals, Evidence, WebsiteIssue, WebsiteStatus } from "@/lib/intel/types";
import { categoryByKey } from "@/lib/categories/taxonomy";
import { findWebPresence } from "@/lib/providers/brave";
import { runPageSpeed } from "@/lib/providers/pagespeed";
import { getAdapter } from "@/lib/providers/registry";
import { enrichmentAvailability } from "@/lib/providers/registry";
import { normalizePhone } from "@/lib/normalize/phone";
import { domainOf, normalizeUrl } from "@/lib/normalize/url";
import type { Depth, SearchCriteria } from "@/lib/search/criteria";
import { diffSnapshots, type BusinessSnapshot, type DetectedChange } from "./change-detection";
import { mergeObservations, type FieldConfidenceMap, type Observation } from "./observations";
import { recordObservationSources, upsertSocials } from "./ingest";
import type { OrgSettings } from "./settings";

/**
 * Research processing for one business: website discovery, website audit,
 * social enrichment, classification, scoring, opportunities, qualification
 * and change detection. Idempotent and reusable for reprocessing from the
 * lead page ("re-run audit", "re-score").
 */

export interface ProcessOptions {
  depth: Depth;
  settings: OrgSettings;
  criteria?: SearchCriteria | null;
  jobId?: string | null;
  steps?: { discover?: boolean; audit?: boolean; social?: boolean; score?: boolean };
  actorId?: string | null;
}

export interface ProcessResult {
  businessId: string;
  websiteStatus: WebsiteStatus;
  leadScore: number;
  salesIntent: number;
  tier: string;
  audited: boolean;
  qualification: QualificationResult | null;
  changes: DetectedChange[];
  errors: string[];
}

const now = () => new Date().toISOString();

export async function processBusiness(db: SupabaseClient, businessId: string, opts: ProcessOptions): Promise<ProcessResult> {
  const errors: string[] = [];
  const steps = { discover: true, audit: true, social: true, score: true, ...opts.steps };
  const avail = enrichmentAvailability(opts.settings.providers);
  const rt = (key: string) => {
    const row = opts.settings.providers.find((p) => p.key === key);
    return { rateLimitPerMinute: row?.rate_limit_per_minute, config: (row?.config ?? {}) as Record<string, unknown> };
  };

  const { data: b, error } = await db.from("businesses").select("*").eq("id", businessId).single();
  if (error || !b) throw new Error(`business ${businessId} not found: ${error?.message}`);
  const { data: socialsRows } = await db.from("business_socials").select("*").eq("business_id", businessId);
  const { data: sourceProviders } = await db.from("source_records").select("provider").eq("business_id", businessId);
  const listingSources = [...new Set((sourceProviders ?? []).map((s) => s.provider))];
  let fc = (b.field_confidence ?? {}) as FieldConfidenceMap;
  const observations: Observation[] = [];
  const checkedForWebsite: string[] = listingSources.map((p) => providerLabel(p));
  let socialSearched = false;

  // ---- 1. Website discovery (web search) when listings had none
  if (steps.discover && !b.website_url && opts.depth !== "FAST" && avail.webSearch) {
    try {
      const presence = await findWebPresence({ name: b.name, city: b.city ?? b.area, country: b.country_code }, rt("brave_search"));
      checkedForWebsite.push(...presence.checked);
      socialSearched = true;
      if (presence.website) {
        observations.push({ field: "website", value: { url: presence.website.url, domain: domainOf(presence.website.url) }, display: presence.website.url, provider: "brave_search", confidence: presence.website.confidence, sourceUrl: presence.website.url, retrievedAt: now() });
      }
      await upsertSocials(db, businessId, presence.socials.map((s) => ({ platform: s.platform, url: s.url, username: s.username, confidence: s.confidence, source: "brave_search" })));
      await recordUsage(db, opts.settings.organisationId, "brave_search", 1, true);
    } catch (e) {
      errors.push(`web search: ${(e as Error).message}`);
      await recordUsage(db, opts.settings.organisationId, "brave_search", 1, false, (e as Error).message);
    }
  }
  if (observations.length) {
    const m = mergeObservations(b, fc, observations);
    if (Object.keys(m.patch).length) await db.from("businesses").update({ ...m.patch, field_confidence: m.fieldConfidence }).eq("id", businessId);
    await recordObservationSources(db, businessId, m.accepted, null);
    fc = m.fieldConfidence;
    observations.length = 0;
  }

  // ---- 2. Website audit
  let classification: WebsiteClassification | null = null;
  let audited = false;
  let hasMenuLink = false;
  let hasEcommerce = false;
  const websiteUrl: string | null = b.website_url;
  if (!websiteUrl) {
    classification = classifyNoWebsite(checkedForWebsite.length ? checkedForWebsite : ["business listing"], now());
  } else if (steps.audit && opts.depth !== "FAST") {
    try {
      const res = await auditWebsite(websiteUrl);
      const obs = res.observation;
      let psi: Awaited<ReturnType<typeof runPageSpeed>> | null = null;
      if (opts.depth === "DEEP" && obs.reachable && avail.pageSpeed && !res.robotsBlocked) {
        try {
          psi = await runPageSpeed(obs.finalUrl ?? websiteUrl, rt("pagespeed").rateLimitPerMinute);
          await recordUsage(db, opts.settings.organisationId, "pagespeed", 1, true);
        } catch (e) {
          errors.push(`pagespeed: ${(e as Error).message}`);
          await recordUsage(db, opts.settings.organisationId, "pagespeed", 1, false, (e as Error).message);
        }
      }
      const full = {
        ...obs,
        perfMeasured: !!psi && psi.performanceScore != null,
        performanceScore: psi?.performanceScore ?? null,
        seoScore: psi?.seoScore ?? null,
        accessibilityScore: psi?.accessibilityScore ?? null,
        lcpMs: psi?.lcpMs ?? null,
        cls: psi?.cls ?? null,
      };
      if (res.robotsBlocked) {
        classification = { status: "UNKNOWN", issues: [], score: 0, evidence: [{ code: "ROBOTS", label: "Audit not permitted", detail: "robots.txt disallows automated access; website left unassessed.", source: "website_audit", observedAt: now() }] };
      } else {
        classification = classifyWebsite(full, { categoryKey: b.category_key });
      }
      audited = !res.robotsBlocked;
      hasMenuLink = res.extraction.hasMenuLink;
      hasEcommerce = res.extraction.hasEcommerce;

      const domain = domainOf(websiteUrl)!;
      const { data: site } = await db.from("websites").upsert({ business_id: businessId, url: websiteUrl, domain, last_checked_at: now(), last_status: classification.status }, { onConflict: "business_id,domain" }).select("id").single();
      await db.from("website_audits").insert({
        business_id: businessId, website_id: site?.id ?? null, requested_url: obs.requestedUrl, final_url: obs.finalUrl ?? null, http_status: obs.httpStatus ?? null,
        reachable: obs.reachable, https: obs.https ?? null, ssl_valid: obs.sslValid ?? null, response_ms: obs.responseMs ?? null, page_bytes: obs.pageBytes ?? null,
        has_viewport: obs.hasViewport ?? null, title: obs.title?.slice(0, 500) ?? null, meta_description: obs.metaDescription?.slice(0, 1000) ?? null, h1_count: obs.h1Count ?? null,
        has_cta: obs.hasCta ?? null, has_whatsapp: obs.hasWhatsapp ?? null, has_phone_link: obs.hasPhoneLink ?? null, has_email: obs.hasEmail ?? null, has_form: obs.hasForm ?? null,
        has_booking: obs.hasBooking ?? null, has_services: obs.hasServices ?? null, has_about: obs.hasAbout ?? null, has_contact: obs.hasContact ?? null,
        has_location_pages: obs.hasLocationPages ?? null, has_structured_data: obs.hasStructuredData ?? null, nav_link_count: obs.navLinkCount ?? null,
        internal_link_count: obs.internalLinkCount ?? null, image_count: obs.imageCount ?? null, images_missing_alt: obs.imagesMissingAlt ?? null,
        copyright_year: obs.copyrightYear ?? null, generator: obs.generator ?? null, technologies: obs.technologies ?? [],
        perf_source: psi ? "pagespeed_mobile" : null, performance_score: psi?.performanceScore ?? null, mobile_score: psi?.performanceScore ?? null,
        seo_score: psi?.seoScore ?? null, accessibility_score: psi?.accessibilityScore ?? null, best_practices_score: psi?.bestPracticesScore ?? null,
        lcp_ms: psi?.lcpMs ?? null, cls: psi?.cls ?? null, tbt_ms: psi?.tbtMs ?? null,
        website_score: classification.score, classifications: [classification.status, ...classification.issues], evidence: classification.evidence,
        error: obs.error ?? null, raw: { legacySignals: obs.legacySignals ?? [], extraction: res.extraction },
      });

      // Contacts found on the business's own website are strong evidence.
      const site_ = obs.finalUrl ?? websiteUrl;
      const wa = res.extraction.whatsappNumbers.map((n) => normalizePhone(n, b.country_code ?? opts.settings.defaultCountry)).find(Boolean);
      if (wa) observations.push({ field: "whatsapp", value: { e164: wa.e164, source: "website" }, display: wa.international, provider: "website_audit", confidence: "HIGH", sourceUrl: site_, retrievedAt: now() });
      if (!b.phone_e164) {
        const ph = res.extraction.phones.map((n) => normalizePhone(n, b.country_code ?? opts.settings.defaultCountry)).find(Boolean);
        if (ph) observations.push({ field: "phone", value: ph, display: ph.international, provider: "website_audit", confidence: "HIGH", sourceUrl: site_, retrievedAt: now() });
      }
      const email = res.extraction.emails.find((e) => e.endsWith(domainOf(site_) ?? "\u0000")) ?? res.extraction.emails[0];
      if (email) observations.push({ field: "email", value: { email, source: "website" }, display: email, provider: "website_audit", confidence: "HIGH", sourceUrl: site_, retrievedAt: now() });
      await upsertSocials(db, businessId, res.extraction.socials.map((s) => ({ platform: s.platform, url: s.url, username: s.username, confidence: "HIGH", source: "website_audit", sourceUrl: site_ })));
    } catch (e) {
      errors.push(`website audit: ${(e as Error).message}`);
    }
  }
  if (observations.length) {
    const fresh = { ...b };
    const m = mergeObservations(fresh, fc, observations);
    if (Object.keys(m.patch).length) await db.from("businesses").update({ ...m.patch, field_confidence: m.fieldConfidence }).eq("id", businessId);
    await recordObservationSources(db, businessId, m.accepted, null);
    fc = m.fieldConfidence;
    Object.assign(b, m.patch);
  }

  // ---- 3. Social metrics (public Instagram profiles)
  const { data: socials } = await db.from("business_socials").select("*").eq("business_id", businessId);
  const ig = (socials ?? socialsRows ?? []).find((s) => s.platform === "INSTAGRAM");
  const wantIgActivity = opts.depth === "DEEP" || opts.criteria?.digital.instagram === "ACTIVE";
  if (steps.social && ig?.username && wantIgActivity && avail.instagramMetrics && (!ig.checked_at || Date.now() - Date.parse(ig.checked_at) > 7 * 86_400_000)) {
    try {
      const data = await getAdapter("apify_instagram")!.getSocialProfileData!([ig.username], rt("apify_instagram"));
      const d = data.find((x) => x.username.toLowerCase() === ig.username.toLowerCase());
      await db.from("business_socials").update({
        followers: d?.followers ?? null, followers_source: d ? "apify_instagram" : null, last_post_at: d?.lastPostAt ?? null,
        activity: d?.activity ?? "UNKNOWN", checked_at: now(),
      }).eq("id", ig.id);
      if (d) Object.assign(ig, { followers: d.followers, activity: d.activity, last_post_at: d.lastPostAt });
      await recordUsage(db, opts.settings.organisationId, "apify_instagram", 1, true);
    } catch (e) {
      errors.push(`instagram metrics: ${(e as Error).message}`);
      await recordUsage(db, opts.settings.organisationId, "apify_instagram", 1, false, (e as Error).message);
    }
  }
  const fb = (socials ?? []).find((s) => s.platform === "FACEBOOK");

  // ---- 4. Size & franchise (observable signals)
  const { count: sameName } = await db.from("businesses").select("id", { count: "exact", head: true })
    .eq("organisation_id", b.organisation_id).eq("normalized_name", b.normalized_name).neq("lifecycle", "MERGED");
  const { count: sharedDomain } = b.website_domain
    ? await db.from("businesses").select("id", { count: "exact", head: true }).eq("organisation_id", b.organisation_id).eq("website_domain", b.website_domain).neq("lifecycle", "MERGED")
    : { count: 0 };
  const chain = isKnownChain(b.normalized_name);
  const size = classifyBusinessSize({ reviewCount: b.google_review_count, hasWebsite: !!b.website_url, locationCount: sameName ?? 1, isKnownChain: chain });
  const franchise = detectFranchise({ normalizedName: b.normalized_name, sameNameLocationCount: sameName ?? 1, sharedDomainCount: sharedDomain ?? 0, rawName: b.name });

  // ---- 5. Classification → scoring → opportunities
  const override = (b.overrides ?? {}) as Record<string, { value: unknown }>;
  let websiteStatus: WebsiteStatus = classification?.status ?? (b.website_url ? (b.website_status as WebsiteStatus) ?? "UNKNOWN" : "NO_WEBSITE");
  let websiteIssues: WebsiteIssue[] = classification?.issues ?? ((b.website_issues ?? []) as WebsiteIssue[]);
  if (override.website_status) websiteStatus = override.website_status.value as WebsiteStatus;
  const category = b.category_key ? categoryByKey(b.category_key) : undefined;
  const signals: BusinessSignals = {
    name: b.name,
    categoryKey: b.category_key,
    categoryValueMultiplier: category?.valueMultiplier ?? 1,
    rating: b.google_rating != null ? Number(b.google_rating) : null,
    reviewCount: b.google_review_count,
    businessStatus: b.business_status,
    hasPhone: !!b.phone_e164,
    phoneIsMobile: b.phone_type === "MOBILE" || b.phone_type === "FIXED_LINE_OR_MOBILE",
    hasWhatsapp: !!b.whatsapp_e164,
    hasEmail: !!b.email,
    websiteUrl: b.website_url,
    websiteStatus,
    websiteIssues,
    websiteScore: classification?.score ?? b.website_score,
    websiteAudited: audited || !!b.last_audited_at,
    // null = looked and found none; undefined = not checked yet (unknown ≠ absent)
    instagram: ig ? { present: true, activity: ig.activity, followers: ig.followers } : (audited || socialSearched ? null : undefined),
    facebook: fb ? { present: true, activity: fb.activity, followers: fb.followers } : (audited || socialSearched ? null : undefined),
    otherSocialCount: (socials ?? []).filter((s) => !["INSTAGRAM", "FACEBOOK"].includes(s.platform)).length,
    businessSize: size.size,
    franchiseStatus: franchise.status,
    hasMenuLink,
    hasEcommerce,
    previouslyContacted: b.pipeline_stage !== "NOT_CONTACTED",
  };

  const score = computeLeadScore(signals, opts.settings.scoring);
  const intent = computeSalesIntent(signals);
  const plan = buildOpportunities(signals, opts.settings.pricing, classification?.evidence ?? []);
  const finalScore = override.lead_score ? Number(override.lead_score.value) : score.total;
  const tier = tierFor(finalScore, opts.settings.scoring);

  const patch: Record<string, unknown> = {
    website_status: websiteStatus,
    website_issues: websiteIssues,
    website_score: classification?.score ?? b.website_score ?? null,
    business_size: size.size,
    franchise_status: franchise.status,
    lead_score: finalScore,
    lead_score_breakdown: { ...score, signals: { size: size.signals, franchise: franchise.signals } },
    sales_intent: intent.score,
    sales_intent_factors: intent,
    tier,
    recommended_service: override.recommended_service ? override.recommended_service.value : plan.recommendedService,
    recommended_package: plan.recommendedPackage,
    upsells: plan.upsells,
    last_researched_at: now(),
  };
  if (audited) patch.last_audited_at = now();
  if (steps.score) {
    await db.from("businesses").update(patch).eq("id", businessId);
    // Amounts go to lead_pricing (RLS: pricing.view only). Manual price overrides are preserved.
    const { data: pricing } = await db.from("lead_pricing").select("price_override").eq("business_id", businessId).maybeSingle();
    await db.from("lead_pricing").upsert({
      business_id: businessId,
      currency: opts.settings.currency,
      ...(pricing?.price_override ? {} : { recommended_price_min: plan.priceMin, recommended_price_max: plan.priceMax }),
      opportunity_value: plan.estimatedValue,
      opportunity_values: Object.fromEntries(plan.opportunities.map((o) => [o.type, { min: o.min, max: o.max }])),
    }, { onConflict: "business_id" });
    await db.from("lead_scores").insert({ business_id: businessId, score: score.total, tier: tierFor(score.total, opts.settings.scoring), breakdown: score, config_version: opts.settings.scoringVersion, computed_by: opts.actorId ?? null });
    await db.from("sales_intent").insert({ business_id: businessId, score: intent.score, factors: intent.factors, method: intent.method, computed_by: opts.actorId ?? null });
    // Replace auto-generated open opportunities; never touch overrides or ones in progress.
    await db.from("opportunities").delete().eq("business_id", businessId).eq("is_override", false).eq("status", "OPEN").not("type", "in", `(${plan.opportunities.map((o) => o.type).join(",") || "NONE"})`);
    if (plan.opportunities.length) {
      const { data: existing } = await db.from("opportunities").select("type, is_override, status").eq("business_id", businessId);
      const locked = new Set((existing ?? []).filter((e) => e.is_override || e.status !== "OPEN").map((e) => e.type));
      const rows = plan.opportunities.filter((o) => !locked.has(o.type)).map((o) => ({
        business_id: businessId, type: o.type, priority: o.priority, value_band: o.valueBand,
        reason: o.reason, evidence: o.evidence as Evidence[], status: "OPEN",
      }));
      if (rows.length) await db.from("opportunities").upsert(rows, { onConflict: "business_id,type" });
    }
  }

  // ---- 6. Qualification against the search criteria
  let qualification: QualificationResult | null = null;
  if (opts.criteria) {
    qualification = qualify({
      ...signals, normalizedName: b.normalized_name, categoryLabel: b.category_label, leadScore: finalScore, salesIntent: intent.score, opportunityValue: plan.estimatedValue,
    }, opts.criteria);
  }

  // ---- 7. Change detection vs last snapshot
  const snapshot: BusinessSnapshot = {
    website_domain: (b.website_domain as string | null) ?? (b.website_url ? domainOf(normalizeUrl(b.website_url)) : null),
    website_status: websiteStatus,
    google_rating: b.google_rating != null ? Number(b.google_rating) : null,
    google_review_count: b.google_review_count,
    business_status: b.business_status,
    phone_e164: b.phone_e164,
    whatsapp_e164: b.whatsapp_e164,
    instagram_present: !!ig,
    instagram_activity: ig?.activity ?? null,
    lead_score: finalScore,
  };
  const { data: prevSnap } = await db.from("business_snapshots").select("snapshot").eq("business_id", businessId).order("taken_at", { ascending: false }).limit(1).maybeSingle();
  const changes = diffSnapshots((prevSnap?.snapshot as BusinessSnapshot) ?? null, snapshot);
  await db.from("business_snapshots").insert({ business_id: businessId, search_job_id: opts.jobId ?? null, snapshot });
  if (changes.length) {
    await db.from("activities").insert(changes.map((c) => ({ organisation_id: b.organisation_id, business_id: businessId, type: c.type, title: c.title, data: { from: c.from, to: c.to, alert: c.alert }, search_job_id: opts.jobId ?? null })));
  }
  await db.from("activities").insert({
    organisation_id: b.organisation_id, business_id: businessId, type: audited ? "AUDITED" : "RESEARCHED",
    title: audited ? `Website audited: ${websiteStatus.replace(/_/g, " ").toLowerCase()}` : `Researched (${opts.depth.toLowerCase()})`,
    data: { score: finalScore, tier, errors }, actor_id: opts.actorId ?? null, search_job_id: opts.jobId ?? null,
  });

  return { businessId, websiteStatus, leadScore: finalScore, salesIntent: intent.score, tier, audited, qualification, changes, errors };
}

function providerLabel(key: string): string {
  return ({ google_places: "Google Business listing", apify_google_maps: "Google Maps listing (Apify)", osm_overpass: "OpenStreetMap listing", import: "imported data", manual: "manual entry" } as Record<string, string>)[key] ?? key;
}

export async function recordUsage(db: SupabaseClient, org: string, key: string, units: number, ok: boolean, error?: string) {
  await db.rpc("record_provider_usage", { p_org: org, p_key: key, p_units: units, p_ok: ok, p_error: error ?? null });
}
