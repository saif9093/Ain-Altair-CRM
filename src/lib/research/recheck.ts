import type { SupabaseClient } from "@supabase/supabase-js";
import { assessDuplicate, DUPLICATE_THRESHOLDS } from "@/lib/dedup/similarity";

/** Re-check one record for possible duplicates (never merges). Returns new candidates found. */
export async function ingestRecheck(db: SupabaseClient, businessId: string): Promise<number> {
  const { data: b } = await db.from("businesses").select("id, organisation_id, name, normalized_name, phone_e164, whatsapp_e164, website_domain, google_place_id, google_maps_url, address, lat, lng, email").eq("id", businessId).single();
  if (!b) return 0;
  const { data: ig } = await db.from("business_socials").select("username").eq("business_id", businessId).eq("platform", "INSTAGRAM").limit(1).maybeSingle();
  const { data: cands } = await db.rpc("find_business_candidates", { p_org: b.organisation_id, p_name: b.normalized_name, p_phone: b.phone_e164, p_domain: b.website_domain, p_place_id: b.google_place_id, p_lat: b.lat, p_lng: b.lng, p_instagram: ig?.username ?? null, p_email: b.email, p_limit: 20 });
  let n = 0;
  for (const c of (cands ?? []) as Record<string, unknown>[]) {
    if (c.id === businessId) continue;
    const a = assessDuplicate({ name: b.name, phoneE164: b.phone_e164, whatsappE164: b.whatsapp_e164, domain: b.website_domain, googlePlaceId: b.google_place_id, googleMapsUrl: b.google_maps_url, address: b.address, lat: b.lat, lng: b.lng, instagram: ig?.username ?? null, email: b.email },
      { name: c.name as string, phoneE164: c.phone_e164 as string, whatsappE164: c.whatsapp_e164 as string, domain: c.website_domain as string, googlePlaceId: c.google_place_id as string, googleMapsUrl: c.google_maps_url as string, address: c.address as string, lat: c.lat as number, lng: c.lng as number, instagram: c.instagram as string, email: c.email as string });
    if (a.confidence < DUPLICATE_THRESHOLDS.review) continue;
    const [x, y] = [businessId, c.id as string].sort();
    const { error } = await db.from("duplicate_candidates").upsert({ organisation_id: b.organisation_id, business_a: x, business_b: y, confidence: a.confidence, reasons: a.reasons }, { onConflict: "business_a,business_b", ignoreDuplicates: true });
    if (!error) n++;
  }
  return n;
}
