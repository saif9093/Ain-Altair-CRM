import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandK } from "@/components/shell/command-k";
import { ADMIN_NAV, MAIN_NAV, visible } from "@/components/shell/nav";
import { SignOutButton } from "@/components/sign-out";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireUser();
  const supabase = await createClient();
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return (
    <div className="min-h-screen">
      <Sidebar main={visible(MAIN_NAV, s.can)} admin={visible(ADMIN_NAV, s.can)} user={{ name: s.fullName ?? s.email, role: s.role }} />
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ink/90 px-4 pl-20 backdrop-blur lg:px-8">
          <CommandK />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/notifications" className="focus-ring relative rounded-full border border-line-strong bg-ink-3 px-3 py-1.5 text-[13px]">
              Notifications
              {!!count && <span className="ml-2 rounded-full bg-signal px-1.5 text-[11px] font-semibold text-white">{count}</span>}
            </Link>
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
