import Link from "next/link";
import { Bell } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandK } from "@/components/shell/command-k";
import { visibleSections } from "@/components/shell/nav";
import { SignOutButton } from "@/components/sign-out";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireUser();
  const supabase = await createClient();
  const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
  const [{ count: unread }, { count: due }, { count: pendingApprovals }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    s.can("outreach.log") ? supabase.from("follow_ups").select("id", { count: "exact", head: true }).eq("status", "PENDING").eq("assigned_to", s.userId).lte("due_at", endToday.toISOString()) : Promise.resolve({ count: 0 }),
    s.can("admin.approvals") ? supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING") : Promise.resolve({ count: 0 }),
  ]);
  return (
    <div className="min-h-screen">
      <Sidebar sections={visibleSections(s.can)} user={{ name: s.fullName ?? s.email, role: s.role }} badges={{ "/follow-ups": due ?? 0, "/admin/approvals": pendingApprovals ?? 0 }} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-ink/85 px-4 pl-16 backdrop-blur-md lg:px-8">
          <CommandK />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/notifications" aria-label="Notifications" className="focus-ring relative grid h-9 w-9 place-items-center rounded-full border border-line-strong bg-ink-3 hover:border-paper">
              <Bell size={16} />
              {!!unread && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-signal px-1 text-[10px] font-bold text-white">{unread}</span>}
            </Link>
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
