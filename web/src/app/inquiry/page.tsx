import { InquiryForm } from "./InquiryForm";

/**
 * `/inquiry` — decision 18's front door, and the app's second and last
 * customer-facing page.
 *
 * Outside the (app) group like `/login`, `/welcome` and `/q/{token}`: no
 * session, no nav, no location context. `proxy.ts` exempts it, because whoever
 * arrives here has no account and does not need one.
 *
 * What makes a public route in an auth-gated app sound is not this file, it is
 * what the page can REACH: two definer RPCs from migration 057 — one that lists
 * the shops and one that creates a lead — and nothing else in the schema. See
 * that migration's header for the full argument.
 *
 * The org comes from `NEXT_PUBLIC_ORG_ID`, a per-deployment constant exactly as
 * `NEXT_PUBLIC_APP_URL` already is: a public page has no session to resolve it
 * from, and a deployment serves one business's form. It is read HERE, on the
 * server, so a missing value is a sentence rather than a form that silently
 * fails on submit.
 */
export const metadata = {
  title: "Special order inquiry",
};

export default function InquiryPage() {
  const orgId = (process.env.NEXT_PUBLIC_ORG_ID ?? "").trim();

  if (!orgId) {
    return (
      <main className="mx-auto w-full max-w-xl space-y-4 px-5 py-10">
        <h1 className="text-[22px] font-bold uppercase leading-tight tracking-[-0.01em]">
          This form isn’t set up yet
        </h1>
        <p className="text-[15px] text-muted">
          NEXT_PUBLIC_ORG_ID is missing, so there is no business to file an
          inquiry against. Set it in web/.env.local and in the deployment’s
          environment, then restart — Next inlines it at build time.
        </p>
      </main>
    );
  }

  return <InquiryForm orgId={orgId} />;
}
