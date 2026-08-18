import { ApproveQuote } from "./ApproveQuote";

/**
 * `/q/{token}` — decision 17's approval page. Outside the (app) group, like
 * /login and /welcome: no session, no nav, no location context. `proxy.ts`
 * exempts it, because whoever arrives here has no account and never will.
 *
 * The token is read from the PATH rather than a query string on purpose: a
 * path segment survives being forwarded, copied out of a mail client that
 * wraps long lines, and pasted into a phone's browser bar, where `?t=…` is the
 * part people drop.
 */
export default async function QuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ApproveQuote token={token} />;
}
