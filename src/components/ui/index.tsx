import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "dark" | "ghost" | "outline" | "danger";
const btn: Record<BtnVariant, string> = {
  primary: "bg-signal text-white hover:bg-signal-2",
  dark: "bg-paper text-white hover:bg-navy",
  ghost: "bg-transparent text-paper hover:bg-ink-4",
  outline: "border border-line-strong bg-ink-3 text-paper hover:border-paper",
  danger: "border border-signal/40 bg-signal-tint text-signal-ink hover:bg-signal hover:text-white",
};
const btnBase = "focus-ring inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";
const btnSize = { sm: "h-8 px-3.5 text-[13px]", md: "h-10 px-5 text-sm", lg: "h-12 px-7 text-[15px]" };

export function Button({ variant = "dark", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant; size?: keyof typeof btnSize }) {
  return <button className={cx(btnBase, btn[variant], btnSize[size], className)} {...p} />;
}
export function ButtonLink({ variant = "dark", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: keyof typeof btnSize }) {
  return <Link className={cx(btnBase, btn[variant], btnSize[size], className)} {...p} />;
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-line bg-ink-3 shadow-[0_1px_2px_rgba(10,10,10,.04),0_8px_24px_-12px_rgba(20,33,61,.08)]", className)} {...p} />;
}
export function CardHeader({ title, eyebrow, action, className }: { title?: ReactNode; eyebrow?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        {title && <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="display text-3xl md:text-[40px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] text-mute">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  neutral: "bg-ink-4 text-paper",
  navy: "bg-navy-tint text-navy",
  signal: "bg-signal-tint text-signal-ink",
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  dark: "bg-paper text-white",
};
export type Tone = keyof typeof tones;
export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return <span title={title} className={cx("tag-mono inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px]", tones[tone], className)}>{children}</span>;
}

const statTones = {
  neutral: "bg-ink-4 text-paper",
  signal: "bg-signal-tint text-signal",
  navy: "bg-navy-tint text-navy",
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
};
export function Stat({ label, value, hint, accent, icon, tone = "neutral", href }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean; icon?: ReactNode; tone?: keyof typeof statTones; href?: string }) {
  const body = (
    <Card className={cx("relative h-full p-4 transition", href && "hover:-translate-y-0.5 hover:border-line-strong")}>
      <div className="flex items-start justify-between gap-2">
        <div className="tag-mono text-[10.5px] text-mute">{label}</div>
        {icon && <div className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-xl", statTones[accent ? "signal" : tone])}>{icon}</div>}
      </div>
      <div className={cx("mt-2 text-[30px] font-extrabold leading-none tracking-tight", accent && "text-signal")}>{value}</div>
      {hint && <div className="mt-2 text-xs text-dim">{hint}</div>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-ink-3/50 px-6 py-14 text-center">
      <div className="text-base font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-mute">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="tag-mono mb-1.5 block text-[10.5px] text-mute">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-dim">{hint}</span>}
    </label>
  );
}

const inputCls = "focus-ring w-full rounded-xl border border-line-strong bg-ink-3 px-3 py-2 text-sm placeholder:text-dim";
export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cx(inputCls, "h-10", className)} {...p} />;
}
export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select className={cx(inputCls, "h-10", className)} {...p} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputCls, className)} {...p} />;
}

export function NotConfigured({ what, children }: { what: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-warn/30 bg-warn-tint p-4 text-sm">
      <div className="tag-mono text-[11px] text-warn">Not configured</div>
      <div className="mt-1 font-medium">{what}</div>
      {children && <div className="mt-1 text-mute">{children}</div>}
    </div>
  );
}
