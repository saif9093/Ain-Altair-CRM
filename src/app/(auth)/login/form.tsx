"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Button, Field, Input } from "@/components/ui";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter();
  const [error, setError] = useState(initialError ?? "");
  const [loading, setLoading] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const { error } = await createClient().auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
    setLoading(false);
    if (error) return setError(error.message);
    router.replace(next.startsWith("/") ? next : "/dashboard");
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      {error && <p className="rounded-xl bg-signal-tint px-3 py-2 text-sm text-signal-ink">{error}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>{loading ? "Signing in…" : "Sign in →"}</Button>
    </form>
  );
}
