import { SignOutButton } from "@/components/sign-out";

export default function PendingPage() {
  return (
    <div>
      <div className="eyebrow mb-3">Account status</div>
      <h2 className="display text-4xl">Awaiting approval</h2>
      <p className="mt-3 text-sm text-mute">Your account is registered. A Super Admin will approve it and assign your role. You will be able to sign in as soon as that happens.</p>
      <div className="mt-6"><SignOutButton /></div>
    </div>
  );
}
