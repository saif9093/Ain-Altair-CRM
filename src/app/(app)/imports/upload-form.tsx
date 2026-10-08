"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "@/components/ui";
import { useToast } from "@/components/client";

export function UploadForm({ sheets }: { sheets: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  return (
    <Card className="p-5">
      <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await fetch("/api/imports", { method: "POST", body: new FormData(e.currentTarget) });
        const j = await r.json();
        setBusy(false);
        if (!r.ok) return toast(j.error ?? "Upload failed", "err");
        router.push(`/imports/${j.id}`);
      }}>
        <Field label="Upload .xlsx or .csv"><Input type="file" name="file" accept=".xlsx,.csv" /></Field>
        <Field label="…or Google Sheet URL" hint={sheets ? "Share the sheet with the service account first." : "Google Sheets is not configured."}><Input name="sheetUrl" placeholder="https://docs.google.com/spreadsheets/d/…" disabled={!sheets} /></Field>
        <Button variant="primary" disabled={busy}>{busy ? "Reading…" : "Upload & map columns"}</Button>
      </form>
    </Card>
  );
}
