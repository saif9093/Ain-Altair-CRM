import Link from "next/link";
import { LoginForm } from "./form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div>
      <div className="eyebrow mb-3">Ain AlTair</div>
      <h2 className="display text-4xl">Sign in</h2>
      <p className="mt-2 text-sm text-mute">Use your Ain AlTair account.</p>
      <LoginForm next={sp.next ?? "/dashboard"} initialError={sp.error} />
      <p className="mt-6 text-sm text-mute">No account? <Link href="/register" className="font-medium text-paper underline">Request access</Link></p>
    </div>
  );
}
