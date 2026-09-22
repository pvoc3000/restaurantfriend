import { PayInvoice } from "./PayInvoice";

/**
 * `/pay/{token}` — the invoice's pay link (migration 119), the approval page's
 * twin. Outside the (app) group like `/q`: no session, no nav, no location
 * context, and `proxy.ts` exempts it by name.
 */
export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PayInvoice token={token} />;
}
