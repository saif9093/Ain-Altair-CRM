import { AuthError } from "@/lib/auth/session";

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Wrap a server action body: permission/validation errors become user-facing messages. */
export async function act<T>(fn: () => Promise<T | ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const r = await fn();
    if (r && typeof r === "object" && "ok" in (r as object)) return r as ActionResult<T>;
    return { ok: true, data: r as T };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    const msg = (e as Error).message ?? "Unexpected error";
    console.error("[action]", msg);
    return { ok: false, error: msg };
  }
}

export const BULK_APPROVAL_THRESHOLD = 200;
