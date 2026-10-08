import { requireUser } from "@/lib/auth/session";
import { isAiConfigured } from "@/lib/ai/client";
import { NotConfigured, PageHeader } from "@/components/ui";
import { Chat } from "./chat";

export const metadata = { title: "AI Assistant" };

export default async function AssistantPage() {
  await requireUser("assistant.use");
  return (
    <div>
      <PageHeader eyebrow="AI" title="AI Sales Assistant" description="Ask about your leads. Answers come only from your CRM data (and only what you are allowed to see)." />
      {isAiConfigured() ? <Chat /> : <NotConfigured what="Claude is not configured">Set ANTHROPIC_API_KEY on the server to enable the assistant.</NotConfigured>}
    </div>
  );
}
