import Link from "next/link";
export default function Forbidden() {
  return (
    <main className="mx-auto max-w-md p-12">
      <div className="eyebrow mb-3">403</div>
      <h1 className="display text-4xl">Not permitted</h1>
      <p className="mt-3 text-sm text-mute">Your role does not include access to this area. Ask a Super Admin if you need it.</p>
      <Link href="/dashboard" className="mt-6 inline-block text-sm font-medium underline">Back to dashboard</Link>
    </main>
  );
}
