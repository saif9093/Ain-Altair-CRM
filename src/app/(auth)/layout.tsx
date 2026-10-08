import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="hero-bg relative hidden flex-col justify-between p-12 text-white lg:flex">
        <Image src="/brand/ainaltair-logo.png" alt="Ain AlTair" width={150} height={103} className="h-auto w-36 brightness-0 invert" priority />
        <div>
          <div className="tag-mono mb-5 inline-flex items-center gap-3 rounded-full border border-white/25 px-4 py-1.5 text-[12px] text-white/80">Lead intelligence · Internal</div>
          <h1 className="display text-[64px] leading-[0.92]">FIND THE<br />BEST PROSPECTS.<br /><span className="font-black">CONTACT<br />THEM TODAY.</span></h1>
          <p className="mt-6 max-w-md text-lg text-white/75">Research any niche in any location, spot website and digital gaps, and move qualified businesses into the pipeline.</p>
        </div>
        <div className="tag-mono text-[11px] text-white/50">© Ain AlTair</div>
      </div>
      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
