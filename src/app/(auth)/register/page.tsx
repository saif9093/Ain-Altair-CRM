"use client";
import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { Button, Field, Input } from "@/components/ui";

export default function RegisterPage() {
  const [state, setState] = useState<{ error?: string; done?: boolean; loading?: boolean }>({});
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState({ loading: true });
    const { error } = await createClient().auth.signUp({
      email: String(f.get("email")),
      password: String(f.get("password")),
      options: { data: { full_name: String(f.get("full_name")) }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/pending` },
    });
    setState(error ? { error: error.message } : { done: true });
  }
  if (state.done) {
    return (
      <div>
        <div className="eyebrow mb-3">Request received</div>
        <h2 className="display text-4xl">Pending approval</h2>
        <p className="mt-3 text-sm text-mute">Confirm your email if asked. A Super Admin must approve your account and assign a role before you can access the platform.</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium underline">Back to sign in</Link>
      </div>
    );
  }
  return (
    <div>
      <div className="eyebrow mb-3">Ain AlTair</div>
      <h2 className="display text-4xl">Request access</h2>
      <p className="mt-2 text-sm text-mute">New accounts are reviewed by a Super Admin.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <Field label="Full name"><Input name="full_name" required /></Field>
        <Field label="Work email"><Input name="email" type="email" required /></Field>
        <Field label="Password" hint="At least 8 characters."><Input name="password" type="password" minLength={8} required /></Field>
        {state.error && <p className="rounded-xl bg-signal-tint px-3 py-2 text-sm text-signal-ink">{state.error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={state.loading}>{state.loading ? "Submitting…" : "Request access →"}</Button>
      </form>
      <p className="mt-6 text-sm text-mute">Already approved? <Link href="/login" className="font-medium text-paper underline">Sign in</Link></p>
    </div>
  );
}
