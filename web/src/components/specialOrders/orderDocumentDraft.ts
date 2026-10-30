import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDocumentEmail,
  documentFileName,
  type DocOrg,
  type DocumentKind,
  type EmailParts,
  type OrderDocData,
} from "@/lib/specialOrderDocs";
import { approvalUrl, mintQuoteToken, resolveAppBase } from "@/lib/specialOrderSend";
import { renderOrderDocument } from "./renderOrderDocument";

/**
 * A DOCUMENT READY TO GO OUT — what the order's Email tab holds while a quote,
 * receipt or kitchen order is attached to the compose box (2026-10-29; until
 * then `SendDocument`'s own compose window held it).
 *
 * The PDF is rendered ONCE, here, so the preview under the compose box shows
 * the exact file Send transmits. A quote's approval token is minted HERE too,
 * before the email's text exists, so the link in that text is a real URL the
 * writer can read and edit; minted without a snapshot, so a draft abandoned
 * leaves a link that shows nothing (`mintQuoteToken`).
 */
export type PreparedDocument = {
  kind: DocumentKind;
  blob: Blob;
  /** An object URL for the preview; revoke it when the document is let go. */
  url: string;
  filename: string;
  token: string | null;
  order: OrderDocData;
  org: DocOrg;
  /** The document's own email, from its template (design rule 2). */
  email: EmailParts;
};

export async function prepareDocument(
  supabase: SupabaseClient,
  args: {
    orderId: string;
    orgId: string;
    kind: DocumentKind;
    orgSettings: Record<string, unknown>;
    today: string;
  }
): Promise<PreparedDocument> {
  const { kind } = args;
  const { blob, order, org } = await renderOrderDocument(supabase, args.orderId, kind, args.today);

  // THE LINK IS RESOLVED BEFORE THE TOKEN IS MINTED. If the deployment's
  // address is unknown there is no usable link, and refusing here costs
  // nothing — refusing after the mint would leave an orphan token behind every
  // attempt, and refusing at Send would waste an email somebody had written.
  let token: string | null = null;
  let link = "";
  if (kind === "quote") {
    const resolved = resolveAppBase(window.location.origin);
    if ("error" in resolved) throw new Error(resolved.error);
    token = await mintQuoteToken(supabase, { orderId: args.orderId, orgId: args.orgId });
    link = approvalUrl(token, resolved.base);
  }

  const email = buildDocumentEmail(
    kind,
    order,
    args.orgSettings,
    {
      approve_url: link,
      // The whole paragraph, so a template that omits `{approve_line}` simply
      // doesn't offer the link rather than printing a bare URL mid-sentence.
      approve_line: link ? `\nYou can review and approve it here — no printing or scanning needed:\n${link}\n` : "",
      // The pay link is a customer invoice's (145); an order's own paper
      // carries none, and these stay empty rather than print braces.
      pay_url: "",
      pay_line: "",
    },
    args.today,
    org.name
  );

  return {
    kind,
    blob,
    url: URL.createObjectURL(blob),
    filename: documentFileName(kind, order.number, order.event_date ?? args.today),
    token,
    order,
    org,
    email,
  };
}

/** A file read for the wire: its name, type and base64 content. */
export async function fileForMail(file: File): Promise<{ filename: string; content_type: string; base64: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { filename: file.name, content_type: file.type || "application/octet-stream", base64: btoa(binary) };
}
