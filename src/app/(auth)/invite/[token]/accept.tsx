"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { acceptInvite } from "@/app/actions/invite";

export function InviteAccept({ token, email }: { token: string; email: string }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div>
      <div className="eyebrow mb-3">You&apos;re invited</div>
      <h2 className="display text-4xl">Set up your account</h2>
      <form className="mt-8 space-y-4" action={async (fd) => { setBusy(true); const r = await acceptInvite(token, String(fd.get("name")), String(fd.get("password"))); setBusy(false); if (!r.ok) return setErr(r.error); router.push("/login?next=/dashboard"); }}>
        <Field label="Email"><Input value={email} disabled /></Field>
        <Field label="Full name"><Input name="name" required /></Field>
        <Field label="Password"><Input name="password" type="password" minLength={8} required /></Field>
        {err && <p className="text-sm text-signal-ink">{err}</p>}
        <Button variant="primary" size="lg" className="w-full" disabled={busy}>Create account →</Button>
      </form>
    </div>
  );
}
