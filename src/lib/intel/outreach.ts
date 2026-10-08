/**
 * Deterministic personalised outreach (works without AI). Every sentence is
 * built from an observed fact; if a fact is missing the sentence is omitted.
 */
export interface OutreachFacts {
  businessName: string;
  area?: string | null;
  city?: string | null;
  categoryLabel?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  websiteStatus?: string | null;
  websiteIssues?: string[];
  websiteDomain?: string | null;
  instagramPresent?: boolean;
  senderName?: string | null;
  company?: string;
}

export function buildOutreachMessage(f: OutreachFacts): string {
  const company = f.company ?? "Ain AlTair";
  const place = f.area || f.city;
  const lines: string[] = [];
  lines.push(`Hi ${f.businessName} team,`);
  const intro = `${f.senderName ? `this is ${f.senderName} from` : "I'm reaching out from"} ${company}, a web design and digital agency${f.city ? ` in the UAE` : ""}.`;
  lines.push(intro.charAt(0).toUpperCase() + intro.slice(1));
  if (f.rating && f.reviewCount && f.reviewCount >= 10) {
    lines.push(`I came across your ${f.categoryLabel ? f.categoryLabel.toLowerCase().replace(/s$/, "") + " " : ""}business${place ? ` in ${place}` : ""} — ${f.rating.toFixed(1)}★ from ${f.reviewCount} Google reviews is a great reputation.`);
  } else if (place) {
    lines.push(`I came across your business${place ? ` in ${place}` : ""}.`);
  }
  const s = f.websiteStatus;
  const issues = new Set(f.websiteIssues ?? []);
  if (s === "NO_WEBSITE") {
    lines.push(`I couldn't find a dedicated website for you${f.instagramPresent ? " beyond your Instagram" : ""}. A simple mobile-first site with WhatsApp enquiries could help new customers find and contact you.`);
  } else if (s === "BROKEN") {
    lines.push(`I noticed ${f.websiteDomain ?? "your website"} isn't loading at the moment, so visitors may not be reaching you.`);
  } else if (s === "OUTDATED" || s === "POOR_DESIGN") {
    lines.push(`I had a look at ${f.websiteDomain ?? "your website"} and think a refreshed, mobile-first design could better match your reputation.`);
  } else if (s === "MOBILE_ISSUE" || issues.has("NO_VIEWPORT")) {
    lines.push(`I noticed ${f.websiteDomain ?? "your website"} isn't optimised for phones, where most local customers browse.`);
  } else if (issues.has("MISSING_WHATSAPP") || issues.has("MISSING_BOOKING")) {
    const parts = [issues.has("MISSING_WHATSAPP") && "a WhatsApp button", issues.has("MISSING_BOOKING") && "online booking"].filter(Boolean).join(" and ");
    lines.push(`Adding ${parts} to ${f.websiteDomain ?? "your website"} could make it easier for customers to reach you.`);
  }
  lines.push("Would you be open to a quick chat or a free mock-up?");
  return lines.join("\n\n");
}
