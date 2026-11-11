import type { ReactNode } from "react";

const TONES: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  amber: "bg-amber-100 text-amber-800 ring-amber-600/20",
  red: "bg-rose-100 text-rose-800 ring-rose-600/20",
  blue: "bg-sky-100 text-sky-800 ring-sky-600/20",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  violet: "bg-violet-100 text-violet-800 ring-violet-600/20",
};

export function Badge({ tone = "slate", children, title }: { tone?: keyof typeof TONES; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function VerificationBadge({ status }: { status: string }) {
  const tone = status === "VERIFIED" ? "green" : status === "REJECTED" ? "red" : "amber";
  return <Badge tone={tone}>{status.replace("_", " ")}</Badge>;
}

export function LifecycleBadge({ status }: { status: string }) {
  const tone = status === "ACTIVE" ? "green" : status === "EXPIRING_SOON" || status === "UPCOMING" ? "blue" : status === "EXPIRED" || status === "CLOSED" ? "slate" : status === "UNKNOWN" ? "slate" : "red";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}

export function AuthorityBadge({ authority }: { authority: string }) {
  const tone = authority.startsWith("PRIMARY_C") || authority === "PRIMARY_DOCUMENT_CONFIRMED" ? "green" : authority === "PRIMARY_LIKELY" ? "amber" : authority === "SECONDARY" ? "violet" : "slate";
  return <Badge tone={tone}>{authority.replace(/_/g, " ")}</Badge>;
}

export function FixtureBadge() {
  return <Badge tone="violet" title="Simulated provider used for tests/demos — not a real scholarship">FIXTURE</Badge>;
}

export function Card({ title, children, className = "", right }: { title?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? "text-slate-900"}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00Z" : d) : d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};

export const fmtDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
};

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return "Not specified";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.join(", ");
  return JSON.stringify(v);
}

export const NOT_SPECIFIED = "Not specified by the official source";
