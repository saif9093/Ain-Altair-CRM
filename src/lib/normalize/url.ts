/** URL / domain / social-profile normalisation. */

// Hosts that are listings or link aggregators — not a business's own website.
const NON_WEBSITE_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "tiktok.com", "linkedin.com", "youtube.com", "youtu.be", "twitter.com", "x.com",
  "snapchat.com", "wa.me", "whatsapp.com", "google.com", "goo.gl", "maps.app.goo.gl", "g.page", "business.site",
  "linktr.ee", "linkin.bio", "bio.link", "beacons.ai", "taplink.cc", "yelp.com", "tripadvisor.com", "zomato.com",
  "talabat.com", "deliveroo.ae", "careem.com", "noon.com", "booking.com", "fresha.com", "justlife.com", "dubizzle.com",
];

export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s || /^(mailto|tel|javascript):/i.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    // Strip tracking params
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|mc_)/i.test(p)) u.searchParams.delete(p);
    }
    u.hostname = u.hostname.toLowerCase();
    let out = u.toString();
    if (u.pathname === "/" && !u.search) out = out.replace(/\/$/, "");
    return out;
  } catch {
    return null;
  }
}

/** Registrable-ish domain without www. (good enough for matching; no PSL needed) */
export function domainOf(raw: string | null | undefined): string | null {
  const url = normalizeUrl(raw);
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\d?\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isOwnedWebsite(raw: string | null | undefined): boolean {
  const d = domainOf(raw);
  if (!d) return false;
  return !NON_WEBSITE_HOSTS.some((h) => d === h || d.endsWith(`.${h}`));
}

export type SocialPlatform = "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "LINKEDIN" | "YOUTUBE" | "X" | "SNAPCHAT";

const RESERVED_PATHS: Record<SocialPlatform, string[]> = {
  INSTAGRAM: ["p", "reel", "reels", "explore", "stories", "accounts", "tv", "about", "developer", "legal", "direct"],
  FACEBOOK: ["sharer", "sharer.php", "share", "dialog", "plugins", "tr", "events", "groups", "watch", "login", "help", "policies", "privacy", "photo.php", "story.php", "permalink.php", "hashtag", "pages"],
  TIKTOK: ["tag", "music", "discover", "embed", "share"],
  LINKEDIN: ["shareArticle", "share", "feed", "jobs", "login"],
  YOUTUBE: ["watch", "embed", "results", "playlist", "shorts", "feed"],
  X: ["intent", "share", "home", "search", "hashtag", "i"],
  SNAPCHAT: [],
};

export interface SocialProfile {
  platform: SocialPlatform;
  url: string;
  username: string | null;
}

/** Recognise a public social *profile* URL (not a share/intent/post link). */
export function parseSocialUrl(raw: string | null | undefined): SocialProfile | null {
  const url = normalizeUrl(raw);
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|web|mobile|business)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const first = parts[0] ?? "";

  const mk = (platform: SocialPlatform, username: string | null, canonical: string): SocialProfile | null => {
    if (!username) return null;
    if (RESERVED_PATHS[platform].includes(username.toLowerCase())) return null;
    return { platform, username, url: canonical };
  };

  if (host === "instagram.com" || host === "instagr.am") {
    const name = first.replace(/^@/, "");
    if (!/^[A-Za-z0-9._]{1,30}$/.test(name)) return null;
    return mk("INSTAGRAM", name, `https://www.instagram.com/${name}`);
  }
  if (host === "facebook.com" || host === "fb.com" || host === "fb.me") {
    if (first === "profile.php") {
      const id = u.searchParams.get("id");
      return id ? { platform: "FACEBOOK", username: id, url: `https://www.facebook.com/profile.php?id=${id}` } : null;
    }
    if (first === "pages" && parts.length >= 2) {
      const name = parts[parts.length - 1];
      return mk("FACEBOOK", name, `https://www.facebook.com/${parts.join("/")}`);
    }
    if (!/^[A-Za-z0-9.\-]{2,80}$/.test(first)) return null;
    return mk("FACEBOOK", first, `https://www.facebook.com/${first}`);
  }
  if (host === "tiktok.com") {
    if (!first.startsWith("@")) return null;
    const name = first.slice(1);
    return mk("TIKTOK", name, `https://www.tiktok.com/@${name}`);
  }
  if (host === "linkedin.com") {
    if ((first === "company" || first === "in" || first === "school") && parts[1]) {
      return mk("LINKEDIN", parts[1], `https://www.linkedin.com/${first}/${parts[1]}`);
    }
    return null;
  }
  if (host === "youtube.com") {
    if (first.startsWith("@")) return mk("YOUTUBE", first.slice(1), `https://www.youtube.com/${first}`);
    if ((first === "channel" || first === "c" || first === "user") && parts[1]) return mk("YOUTUBE", parts[1], `https://www.youtube.com/${first}/${parts[1]}`);
    return null;
  }
  if (host === "twitter.com" || host === "x.com") {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(first)) return null;
    return mk("X", first, `https://x.com/${first}`);
  }
  if (host === "snapchat.com" && first === "add" && parts[1]) {
    return mk("SNAPCHAT", parts[1], `https://www.snapchat.com/add/${parts[1]}`);
  }
  return null;
}
