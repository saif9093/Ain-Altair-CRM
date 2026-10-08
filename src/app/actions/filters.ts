"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { act } from "./_util";

export async function saveFilter(name: string, filters: Record<string, string>) {
  return act(async () => {
    const s = await assertPermission();
    const supabase = await createClient();
    delete filters.page;
    await supabase.from("saved_filters").insert({ organisation_id: s.organisationId, user_id: s.userId, name: z.string().trim().min(1).max(60).parse(name), scope: "leads", filters });
    revalidatePath("/leads");
    return { ok: true as const, message: "Filter saved" };
  });
}

export async function deleteFilter(id: string) {
  return act(async () => {
    await assertPermission();
    const supabase = await createClient();
    await supabase.from("saved_filters").delete().eq("id", id);
    revalidatePath("/leads");
    return { ok: true as const, message: "Filter removed" };
  });
}
