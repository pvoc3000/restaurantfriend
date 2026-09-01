import type { ReactNode } from "react";

/**
 * `/legal/*` — the two public documents Intuit requires before it will issue
 * production keys: an end-user licence agreement and a privacy policy, each at
 * a public https URL.
 *
 * Outside the (app) group like `/login`, `/welcome`, `/q/{token}` and
 * `/inquiry`: no session, no nav, no location context. `proxy.ts` exempts it,
 * and of the five exemptions this is the safest — the others reach definer
 * RPCs, and these pages reach NOTHING. They are static text.
 *
 * They must stay reachable SIGNED OUT: Intuit's reviewers fetch them without an
 * account, and a redirect to /login reads as a broken link.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-hairline bg-ink px-6 py-4 text-white">
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em]">
          restaurantfriend
        </p>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-12">
        <article className="space-y-6 text-[15px] leading-relaxed text-ink [&_h2]:pt-4 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:uppercase [&_h2]:tracking-[0.08em] [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
          {children}
        </article>
        <footer className="mt-16 border-t border-hairline pt-6 text-[13px] text-muted">
          <p>
            Donut Friend, Inc. · 543 S Broadway, Los Angeles, CA 90013 ·{" "}
            <a className="underline" href="mailto:info@donutfriend.com">
              info@donutfriend.com
            </a>
          </p>
          <p className="mt-2">
            <a className="underline" href="/legal/terms">
              Terms of use
            </a>{" "}
            ·{" "}
            <a className="underline" href="/legal/privacy">
              Privacy policy
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
