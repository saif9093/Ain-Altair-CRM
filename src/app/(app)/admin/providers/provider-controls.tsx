"use client";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/client";
import { updateProvider } from "@/app/actions/admin";

export function ProviderControls({ pkey, enabled, priority, rateLimit, quota }: { pkey: string; enabled: boolean; priority: number; rateLimit: number | null; quota: number | null }) {
  const { run, pending } = useAction();
  return (
    <form className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3 text-xs" action={(fd) => run(() => updateProvider({ key: pkey, priority: Number(fd.get("priority")), rateLimit: fd.get("rate") ? Number(fd.get("rate")) : null, dailyQuota: fd.get("quota") ? Number(fd.get("quota")) : null }))}>
      <label>Priority<Input name="priority" type="number" defaultValue={priority} className="h-8 w-20" /></label>
      <label>Rate/min<Input name="rate" type="number" defaultValue={rateLimit ?? ""} className="h-8 w-20" /></label>
      <label>Daily quota<Input name="quota" type="number" defaultValue={quota ?? ""} className="h-8 w-24" /></label>
      <Button size="sm" variant="outline" disabled={pending}>Save</Button>
      <Button size="sm" type="button" variant={enabled ? "danger" : "primary"} disabled={pending} onClick={() => run(() => updateProvider({ key: pkey, enabled: !enabled }))}>{enabled ? "Disable" : "Enable"}</Button>
    </form>
  );
}
