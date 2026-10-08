"use server";
import { assertPermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { askAssistant, type ChatTurn } from "@/lib/ai/assistant";
import { act } from "./_util";

export async function ask(history: ChatTurn[]) {
  return act(async () => {
    const s = await assertPermission("assistant.use");
    return askAssistant(await createClient(), s.userId, history.map((h) => ({ role: h.role, content: String(h.content).slice(0, 4000) })));
  });
}
