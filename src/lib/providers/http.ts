/**
 * Resilient HTTP for providers: timeouts, retries with exponential backoff +
 * jitter, Retry-After support, and per-provider rate limiting.
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly status?: number,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class NotConfiguredError extends ProviderError {
  constructor(provider: string, missing: string[]) {
    super(`${provider} is not configured (missing ${missing.join(", ")})`, provider, undefined, false);
    this.name = "NotConfiguredError";
  }
}

/** Simple token bucket shared within a process. */
class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private readonly perMinute: number) {
    this.tokens = Math.max(1, Math.min(perMinute, 5));
  }
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.perMinute, this.tokens + ((now - this.last) / 60_000) * this.perMinute);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil(((1 - this.tokens) / this.perMinute) * 60_000);
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 10_000)));
    }
  }
}

const buckets = new Map<string, TokenBucket>();
export async function rateLimit(provider: string, perMinute: number | null | undefined): Promise<void> {
  if (!perMinute || perMinute <= 0) return;
  const key = `${provider}:${perMinute}`;
  if (!buckets.has(key)) buckets.set(key, new TokenBucket(perMinute));
  await buckets.get(key)!.take();
}

export interface FetchOptions extends RequestInit {
  provider: string;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  rateLimitPerMinute?: number | null;
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : undefined;
}

export async function providerFetch(url: string, opts: FetchOptions): Promise<Response> {
  const { provider, timeoutMs = 20_000, retries = 3, backoffMs = 800, rateLimitPerMinute, ...init } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await rateLimit(provider, rateLimitPerMinute);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => "");
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      lastErr = new ProviderError(`${provider} HTTP ${res.status}: ${body.slice(0, 300)}`, provider, res.status, retryable, retryAfter);
      if (!retryable || attempt === retries) throw lastErr;
      await sleep(retryAfter ?? backoff(backoffMs, attempt));
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ProviderError && !e.retryable) throw e;
      const isAbort = e instanceof Error && e.name === "AbortError";
      lastErr = e instanceof ProviderError ? e : new ProviderError(`${provider} ${isAbort ? "timeout" : "network error"}: ${(e as Error).message}`, provider, undefined, true);
      if (attempt === retries) throw lastErr;
      await sleep(backoff(backoffMs, attempt));
    }
  }
  throw lastErr;
}

export function backoff(base: number, attempt: number): number {
  return Math.min(30_000, base * 2 ** attempt) + Math.floor(Math.random() * base);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
