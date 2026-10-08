import Link from "next/link";
import { Badge } from "@/components/ui";
import { human, TIER_TONE, WEBSITE_TONE } from "@/lib/format";
import { whatsappUrl } from "@/lib/normalize/phone";

export function TierBadge({ tier, score }: { tier?: string | null; score?: number | null }) {
  if (!tier) return <Badge>Unscored</Badge>;
  return <Badge tone={TIER_TONE[tier]}>{tier}{score != null ? ` · ${score}` : ""}</Badge>;
}

export function WebsiteBadge({ status }: { status?: string | null }) {
  return <Badge tone={WEBSITE_TONE[status ?? "UNKNOWN"] ?? "neutral"}>{human(status ?? "UNKNOWN")}</Badge>;
}

export function IntentBadge({ v }: { v?: number | null }) {
  if (v == null) return null;
  return <Badge tone="navy" title="Sales intent is a heuristic ESTIMATE from observable signals, not a fact.">Intent {v} · est.</Badge>;
}

/** Outreach quick actions. WhatsApp only appears when a WhatsApp number is verified. */
export function ContactLinks({ b, message }: { b: { whatsapp_e164?: string | null; phone_e164?: string | null; email?: string | null; website_url?: string | null; google_maps_url?: string | null; business_socials?: { platform: string; url: string }[] }; message?: string }) {
  const ig = b.business_socials?.find((s) => s.platform === "INSTAGRAM");
  const fb = b.business_socials?.find((s) => s.platform === "FACEBOOK");
  const cls = "tag-mono rounded-full border border-line-strong px-2 py-0.5 text-[10.5px] hover:border-paper";
  return (
    <div className="flex flex-wrap gap-1">
      {b.whatsapp_e164 && <a className={`${cls} border-ok/40 bg-ok-tint text-ok`} target="_blank" rel="noreferrer" href={whatsappUrl(b.whatsapp_e164, message)!}>WhatsApp</a>}
      {b.phone_e164 && <a className={cls} href={`tel:${b.phone_e164}`}>Call</a>}
      {b.email && <a className={cls} href={`mailto:${b.email}`}>Email</a>}
      {ig && <a className={cls} target="_blank" rel="noreferrer" href={ig.url}>Instagram</a>}
      {fb && <a className={cls} target="_blank" rel="noreferrer" href={fb.url}>Facebook</a>}
      {b.google_maps_url && <a className={cls} target="_blank" rel="noreferrer" href={b.google_maps_url}>Maps</a>}
      {b.website_url && <a className={cls} target="_blank" rel="noreferrer" href={b.website_url}>Website</a>}
    </div>
  );
}

export function LeadLink({ id, name, code }: { id: string; name: string; code?: string }) {
  return (
    <Link href={`/leads/${id}`} className="group block min-w-0">
      <div className="truncate font-medium group-hover:underline">{name}</div>
      {code && <div className="tag-mono text-[10px] text-dim">{code}</div>}
    </Link>
  );
}
