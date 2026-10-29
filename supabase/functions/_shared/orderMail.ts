// READING A GMAIL MESSAGE INTO AN ORDER'S EMAIL (migration 214).
//
// Pure — no Deno APIs, no network — so `npm run fixtures` runs it over real
// shapes of what `users.messages.get?format=full` returns. `order-mail` does
// the fetching and the writing; everything here decides what a message SAYS:
// who it is from and to, its text, its attachments, and which order numbers
// its subject names.

export type GmailHeader = { name?: string; value?: string };

export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

export type Address = { name: string | null; address: string };

/**
 * `part_id` is the part's place in the message ("1.2"), which does not change.
 * Gmail's `attachmentId` does — it is minted afresh on every fetch — so the
 * file is found again by its part when somebody opens it.
 */
export type MessageAttachment = {
  part_id: string;
  filename: string;
  mime_type: string;
  size: number;
  attachment_id: string;
};

/** A header's value, case-insensitively, or null. */
export function header(part: GmailPart | undefined, name: string): string | null {
  const want = name.toLowerCase();
  const h = (part?.headers ?? []).find((x) => (x.name ?? "").toLowerCase() === want);
  const v = h?.value?.trim();
  return v ? v : null;
}

/**
 * The addresses in a From, To or Cc header — `"Smith, Jen" <jen@x.com>, bo@y.org`.
 * Commas inside quotes or angle brackets do not split. Addresses come back
 * lower-cased, because every comparison made with them is case-blind.
 */
export function parseAddresses(value: string | null | undefined): Address[] {
  if (!value) return [];
  const pieces: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if (ch === "," && !quoted && angle === 0) {
      pieces.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  pieces.push(current);

  const out: Address[] = [];
  for (const raw of pieces) {
    const piece = raw.trim();
    if (!piece) continue;
    const bracket = piece.match(/^(.*)<([^<>]+)>\s*$/);
    if (bracket) {
      const name = bracket[1].trim().replace(/^"(.*)"$/, "$1").trim();
      const address = bracket[2].trim().toLowerCase();
      if (address.includes("@")) out.push({ name: name || null, address });
    } else if (piece.includes("@")) {
      out.push({ name: null, address: piece.replace(/^"|"$/g, "").trim().toLowerCase() });
    }
  }
  return out;
}

/** Bytes from Gmail's base64url. */
function bytesFromBase64Url(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** A part's charset, from its Content-Type, defaulting to UTF-8. */
function charsetOf(part: GmailPart): string {
  const ct = header(part, "Content-Type") ?? "";
  const m = ct.match(/charset\s*=\s*"?([^";\s]+)"?/i);
  return m ? m[1].toLowerCase() : "utf-8";
}

/** Gmail hands back the part's own bytes, so they are decoded in the part's
 *  own charset; one TextDecoder does not know falls back to UTF-8. */
function decodePart(part: GmailPart): string {
  const data = part.body?.data;
  if (!data) return "";
  const bytes = bytesFromBase64Url(data);
  try {
    return new TextDecoder(charsetOf(part)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

/**
 * An HTML body as plain text — for the messages that carry no text part.
 * Not a renderer: blocks become line breaks, tags go, entities are decoded,
 * and runs of blank lines collapse to one.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Every leaf part, depth first, in the order the message holds them. */
export function leaves(part: GmailPart | undefined): GmailPart[] {
  if (!part) return [];
  if (part.parts?.length) return part.parts.flatMap(leaves);
  return [part];
}

function isAttachment(part: GmailPart): boolean {
  return !!part.filename && !!part.body?.attachmentId;
}

/**
 * The message's text: its first text/plain part, or failing that its first
 * text/html part reduced to text. A part that is a file (a .txt attached) is
 * never the body.
 */
export function messageText(payload: GmailPart | undefined): string {
  const parts = leaves(payload).filter((p) => !isAttachment(p));
  const plain = parts.find((p) => (p.mimeType ?? "").toLowerCase() === "text/plain" && p.body?.data);
  if (plain) return decodePart(plain).replace(/\r\n/g, "\n").trim();
  const html = parts.find((p) => (p.mimeType ?? "").toLowerCase() === "text/html" && p.body?.data);
  if (html) return htmlToText(decodePart(html).replace(/\r\n/g, "\n"));
  return "";
}

/** The files a message carries, for the tab to offer. */
export function messageAttachments(payload: GmailPart | undefined): MessageAttachment[] {
  // `attachment_id` is kept for the record but goes stale; see `part_id`.
  return leaves(payload)
    .filter(isAttachment)
    .map((p) => ({
      part_id: p.partId ?? "",
      filename: p.filename!,
      mime_type: (p.mimeType ?? "application/octet-stream").toLowerCase(),
      size: p.body?.size ?? 0,
      attachment_id: p.body!.attachmentId!,
    }));
}

/**
 * The order numbers a subject names, in `prefix` + digits form — "SO-10156"
 * from "Re: DONUT FRIEND SO-10156: Birthday" or "order #SO-10112". Case-blind
 * and returned as the order's `number` stores them (147: the prefix is part of
 * the number). An empty prefix finds nothing, because a bare run of digits in
 * a subject is as likely a date or a phone number as an order.
 */
export function orderNumbersIn(subject: string | null | undefined, prefix: string | null | undefined): string[] {
  const p = (prefix ?? "").trim();
  if (!subject || !p) return [];
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(\\d{3,})(?![0-9])`, "gi");
  const found = new Set<string>();
  for (const m of subject.matchAll(re)) found.add(`${p}${m[1]}`);
  return [...found];
}

/** A subject with its leading Re:/Fwd: run taken off, for a reply's own "Re: ". */
export function baseSubject(subject: string | null | undefined): string {
  return (subject ?? "").replace(/^\s*((re|fwd?|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "").trim();
}

/**
 * What the tab should keep of one message, or why not.
 *
 * `mailbox` is the module mailbox's own address. From it is OUT; from
 * anybody else is IN. A message from the mailbox to nobody but itself is a
 * shop notice ("New inquiry", "Quote approved") — the app talking to itself,
 * which the order already shows elsewhere — and is left out. So are drafts,
 * spam, trash and chats.
 */
export type ReadMessage = {
  direction: "in" | "out";
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string | null;
  rfcMessageId: string | null;
  sentAt: string;
  snippet: string | null;
  text: string;
  attachments: MessageAttachment[];
};

const SKIP_LABELS = ["DRAFT", "SPAM", "TRASH", "CHAT"];

export function readMessage(
  message: GmailMessage,
  mailbox: string
): { ok: true; message: ReadMessage } | { ok: false; reason: string } {
  const labels = message.labelIds ?? [];
  const skipped = SKIP_LABELS.find((l) => labels.includes(l));
  if (skipped) return { ok: false, reason: skipped.toLowerCase() };

  const self = mailbox.trim().toLowerCase();
  const from = parseAddresses(header(message.payload, "From"))[0];
  if (!from) return { ok: false, reason: "no sender" };
  const to = parseAddresses(header(message.payload, "To"));
  const cc = parseAddresses(header(message.payload, "Cc"));
  const direction = from.address === self ? "out" : "in";
  if (direction === "out" && [...to, ...cc].every((a) => a.address === self)) {
    return { ok: false, reason: "shop notice" };
  }

  const ms = Number(message.internalDate);
  return {
    ok: true,
    message: {
      direction,
      from,
      to,
      cc,
      subject: header(message.payload, "Subject"),
      rfcMessageId: header(message.payload, "Message-ID") ?? header(message.payload, "Message-Id"),
      sentAt: new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now()).toISOString(),
      snippet: message.snippet?.trim() || null,
      text: messageText(message.payload),
      attachments: messageAttachments(message.payload),
    },
  };
}

/** Addresses as a header would print them, for the stored To and Cc. */
export function formatAddresses(list: Address[]): string | null {
  if (!list.length) return null;
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
}
