import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { fmtRelative } from "@/lib/format";
import { markNotificationsRead } from "@/app/actions/admin";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  await requireUser();
  const db = await createClient();
  const { data } = await db.from("notifications").select("*").order("created_at", { ascending: false }).limit(200);
  return (
    <div>
      <PageHeader title="Notifications" actions={<form action={async () => { "use server"; await markNotificationsRead(); }}><button className="text-sm underline">Mark all read</button></form>} />
      <Card>
        <ul className="divide-y divide-line">
          {(data ?? []).map((n) => (
            <li key={n.id} className={`px-5 py-3 text-sm ${n.read_at ? "text-mute" : ""}`}>
              <div className="flex justify-between gap-3"><span className="font-medium">{!n.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-signal" />}{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</span><span className="text-xs">{fmtRelative(n.created_at)}</span></div>
              {n.body && <div className="text-mute">{n.body}</div>}
            </li>
          ))}
          {!data?.length && <li className="px-5 py-8 text-center text-sm text-mute">No notifications.</li>}
        </ul>
      </Card>
    </div>
  );
}
