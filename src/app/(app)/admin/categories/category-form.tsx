"use client";
import { Button, Input } from "@/components/ui";
import { useAction } from "@/components/client";
import { upsertCategory } from "@/app/actions/admin";

export function CategoryForm() {
  const { run, pending } = useAction();
  const list = (v: FormDataEntryValue | null) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return (
    <form className="grid gap-2 md:grid-cols-5" action={(fd) => run(() => upsertCategory({ key: String(fd.get("key")), name: String(fd.get("name")), synonyms: list(fd.get("syn")), exclusions: list(fd.get("exc")), valueMultiplier: Number(fd.get("mult") || 1) }))}>
      <Input name="key" placeholder="key e.g. yacht_charter" required /><Input name="name" placeholder="Name" required /><Input name="syn" placeholder="synonyms, comma separated" /><Input name="exc" placeholder="exclusions" /><div className="flex gap-2"><Input name="mult" type="number" step="0.05" defaultValue="1" /><Button variant="dark" disabled={pending}>Save</Button></div>
    </form>
  );
}
