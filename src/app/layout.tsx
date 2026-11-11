import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scholarship Intelligence Crawler",
  description: "Evidence-first discovery, verification and change tracking of scholarships for Indian students.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/runs", label: "Crawl runs & Demo lab" },
  { href: "/sources", label: "Sources & candidates" },
  { href: "/about", label: "Method" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm text-white">SI</span>
              Scholarship Intelligence
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                  {n.label}
                </Link>
              ))}
              <a href="/api/v1/health" className="rounded-md px-3 py-1.5 text-slate-400 hover:bg-slate-100">API health</a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-500">
          Confidence is a rule-based, deterministic estimate of evidence quality (policy v1.0) — not a calibrated probability. Records marked FIXTURE come from simulated providers used for tests and demos.
        </footer>
      </body>
    </html>
  );
}
