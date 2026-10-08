import { appUrl } from "@/lib/env";

/** Nudge the worker so queued work starts now instead of on the next cron tick. Fire-and-forget. */
export async function kickWorker(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  // Awaited briefly so the request is actually sent before this function ends;
  // the worker keeps running after we stop waiting.
  await fetch(`${appUrl()}/api/cron/worker`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(1200) }).catch(() => undefined);
}
