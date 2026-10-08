import { SignOutButton } from "@/components/sign-out";
export default function Suspended() {
  return (
    <main className="mx-auto max-w-md p-12">
      <div className="eyebrow mb-3">Account status</div>
      <h1 className="display text-4xl">Access unavailable</h1>
      <p className="mt-3 text-sm text-mute">Your account is suspended or was not approved. Contact a Super Admin.</p>
      <div className="mt-6"><SignOutButton /></div>
    </main>
  );
}
