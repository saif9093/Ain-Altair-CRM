"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <Button variant="outline" size="sm" className={className} onClick={async () => { await createClient().auth.signOut(); router.replace("/login"); router.refresh(); }}>
      Sign out
    </Button>
  );
}
