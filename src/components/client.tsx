"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState, useTransition, type ReactNode } from "react";
import { Button, cx } from "@/components/ui";
import type { ActionResult } from "@/app/actions/_util";

type Toast = { id: number; text: string; tone: "ok" | "err" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[70] flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cx("rounded-xl px-4 py-3 text-sm shadow-lg", t.tone === "ok" ? "bg-paper text-white" : "bg-signal text-white")}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Run a server action with pending state, toast feedback and refresh. */
export function useAction() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = useCallback(<T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; refresh?: boolean; onDone?: (d: T | undefined) => void } = {}) => {
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast(r.error, "err"); return; }
      toast(r.message ?? opts.success ?? "Saved");
      opts.onDone?.(r.data);
      if (opts.refresh !== false) router.refresh();
    });
  }, [router, toast]);
  return { run, pending };
}

export function ActionButton<T>({ action, children, confirm, success, variant = "outline", size = "sm", className }: { action: () => Promise<ActionResult<T>>; children: ReactNode; confirm?: string; success?: string; variant?: "primary" | "dark" | "ghost" | "outline" | "danger"; size?: "sm" | "md" | "lg"; className?: string }) {
  const { run, pending } = useAction();
  return (
    <Button variant={variant} size={size} className={className} disabled={pending} onClick={() => { if (confirm && !window.confirm(confirm)) return; run(action, { success }); }}>
      {pending ? "Working…" : children}
    </Button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const toast = useToast();
  return <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(text); toast("Copied"); }}>{label}</Button>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-paper/40 p-4 pt-[8vh]" onClick={onClose}>
      <div className={cx("w-full rounded-2xl border border-line bg-ink-3 shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="text-sm text-mute hover:text-paper">Close</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Real progress bar: value/total from the database, never simulated. */
export function Progress({ value, total, label, sub }: { value: number; total: number; label: string; sub?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{label}</span><span className="tag-mono text-[11px] text-mute">{total ? `${value}/${total} · ${pct}%` : sub ?? "—"}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-4"><div className="h-full rounded-full bg-signal transition-all duration-700" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
