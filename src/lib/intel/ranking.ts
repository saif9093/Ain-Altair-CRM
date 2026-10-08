/** "Contact Today" and "Best Opportunities" ranking — explainable, rule-based. */
export interface RankLead {
  id: string; name: string; lead_score: number | null; sales_intent: number | null; website_status: string | null; whatsapp_e164: string | null; phone_e164: string | null; email?: string | null;
  google_rating: number | null; google_review_count: number | null; business_status: string | null; business_socials?: { platform: string; activity?: string }[]; [k: string]: unknown;
}

const SEVERITY: Record<string, number> = { NO_WEBSITE: 20, BROKEN: 20, OUTDATED: 15, MOBILE_ISSUE: 13, POOR_DESIGN: 12, SLOW: 10, MISSING_FUNCTIONALITY: 9, AVERAGE: 3 };

export function rankContactToday<T extends RankLead>(leads: T[]): { lead: T; priority: number; reasons: string[] }[] {
  return leads.map((b) => {
    const reasons: string[] = [];
    let p = (b.lead_score ?? 0) * 0.4 + (b.sales_intent ?? 0) * 0.25;
    const sev = SEVERITY[b.website_status ?? ""] ?? 0;
    if (sev) { p += sev; reasons.push(b.website_status === "NO_WEBSITE" ? "no website" : `website ${b.website_status!.replace(/_/g, " ").toLowerCase()}`); }
    if (b.whatsapp_e164) { p += 10; reasons.push("WhatsApp available"); } else if (b.phone_e164) p += 4;
    if ((b.google_review_count ?? 0) >= 20 && (b.google_rating ?? 0) >= 4) { p += 6; reasons.push(`${b.google_rating}★ / ${b.google_review_count} reviews`); }
    if (b.business_socials?.some((s) => s.activity === "ACTIVE")) { p += 5; reasons.push("active social"); }
    if (b.business_status === "OPERATIONAL") p += 2;
    return { lead: b, priority: Math.round(p), reasons };
  }).sort((a, b) => b.priority - a.priority);
}

/** Best opportunities: likelihood of need × likelihood of response × ease of contact × quality × value. */
export function rankBestOpportunities<T extends RankLead & { opportunity_priority?: number | null }>(leads: T[]): { lead: T; score: number }[] {
  return leads.map((b) => {
    const need = (SEVERITY[b.website_status ?? ""] ?? 2) / 20;
    const respond = (b.sales_intent ?? 40) / 100;
    const ease = b.whatsapp_e164 ? 1 : b.phone_e164 ? 0.7 : b.email ? 0.5 : 0.2;
    const quality = Math.min(1, ((b.google_rating ?? 3.5) / 5) * (0.6 + Math.min(0.4, (b.google_review_count ?? 0) / 250)));
    const value = (b.opportunity_priority ?? 50) / 100;
    return { lead: b, score: Math.round(100 * (0.3 * need + 0.2 * respond + 0.2 * ease + 0.15 * quality + 0.15 * value)) };
  }).sort((a, b) => b.score - a.score);
}
