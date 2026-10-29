/**
 * An order's emails on its Emails tab (migration 214) — the pure half.
 *
 * `special_order_messages` holds each message whole, quoted history and all,
 * because that is what the customer sent. The tab FOLDS the history: a reply
 * that repeats the whole conversation under itself would make every message
 * on the tab as long as the tab.
 */

export type OrderMessage = {
  id: string;
  direction: "in" | "out";
  from_address: string;
  from_name: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  subject: string | null;
  sent_at: string;
  rfc_message_id: string | null;
  body_text: string | null;
  snippet: string | null;
  attachments: { part_id: string; filename: string; mime_type: string; size: number }[];
  handled_at: string | null;
  handled_by: string | null;
};

/** The order's Emails tab columns — one string so the page and anything else
 *  that reads them cannot ask for different ones. */
export const ORDER_MESSAGE_COLUMNS =
  "id, direction, from_address, from_name, to_addresses, cc_addresses, subject, sent_at, rfc_message_id, body_text, snippet, attachments, handled_at, handled_by";

/** Whether this message is still waiting for somebody to answer it. */
export function isWaiting(m: Pick<OrderMessage, "direction" | "handled_at">): boolean {
  return m.direction === "in" && m.handled_at === null;
}

/**
 * Where the quoted history begins in a message's text, or -1.
 *
 * The shapes, all from real mail: Apple Mail and Gmail's "On … wrote:" (which
 * Gmail wraps onto a second line when the sender's name is long); Outlook's
 * "From: … / Sent: …" header block and its older "-----Original Message-----";
 * and a run of ">" lines.
 */
function quoteStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(line)) return i;
    if (/^on\s.+/i.test(line)) {
      if (/wrote:$/i.test(line)) return i;
      if (i + 1 < lines.length && /wrote:$/i.test(lines[i + 1].trim()) && line.length < 200) return i;
    }
    if (/^from:\s.+/i.test(line)) {
      const next = lines.slice(i + 1, i + 4).map((l) => l.trim());
      if (next.some((l) => /^(sent|date):\s/i.test(l))) return i;
    }
    if (line.startsWith(">")) {
      // Only when the rest is quotes and blanks: an answer typed BETWEEN
      // quoted lines is the message, not history.
      const rest = lines.slice(i).map((l) => l.trim());
      if (rest.every((l) => l === "" || l.startsWith(">"))) return i;
    }
  }
  return -1;
}

/** A message's own words, and the history under them (empty when none). */
export function splitQuoted(text: string | null | undefined): { main: string; quoted: string } {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const at = quoteStart(lines);
  if (at <= 0) {
    // A message that is NOTHING but history (a forward with no note) shows it
    // all rather than an empty box.
    return { main: lines.join("\n").trim(), quoted: "" };
  }
  return {
    main: lines.slice(0, at).join("\n").trim(),
    quoted: lines.slice(at).join("\n").trim(),
  };
}

/** How long a message has been waiting — "40 min", "3 h", "1 d 3 h". */
export function waitingFor(sinceIso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - new Date(sinceIso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/**
 * One copy per email. Gmail can hold a message the mailbox sent to itself as
 * well as to the customer twice — once sent, once received — and both are the
 * same email, so the RFC Message-ID decides. Oldest first.
 */
export function conversation(messages: OrderMessage[]): OrderMessage[] {
  const seen = new Set<string>();
  const out: OrderMessage[] = [];
  for (const m of [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at))) {
    const key = m.rfc_message_id?.trim().toLowerCase();
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(m);
  }
  return out;
}

/**
 * Who a reply goes to: whoever wrote the newest message from outside, or —
 * with none — the order's contact.
 */
export function replyAddress(messages: OrderMessage[], contactEmail: string | null): string {
  const latestIn = [...messages].reverse().find((m) => m.direction === "in");
  return latestIn?.from_address ?? (contactEmail ?? "").trim();
}

/** The message a reply answers: the newest one from outside, else the newest. */
export function answering(messages: OrderMessage[]): OrderMessage | null {
  return [...messages].reverse().find((m) => m.direction === "in") ?? messages[messages.length - 1] ?? null;
}

/** Every address in a header-style list — "Jen <jen@x.com>, bo@y.org" —
 *  lower-cased, in order, once each. Names are dropped: a Cc box holds
 *  addresses, and the stored lists are `order-mail`'s own formatting. */
export function addressesIn(list: string | null | undefined): string[] {
  const found = (list ?? "").match(/[^\s<>,;"'()]+@[^\s<>,;"'()]+/g) ?? [];
  return [...new Set(found.map((a) => a.toLowerCase()))];
}

/**
 * Who a reply copies: everyone else the answered message went to or copied
 * (Mail.app's Reply All), never the shop's own mailbox and never whoever the
 * reply is already To. A message the shop sent copies nobody back.
 */
export function replyCc(message: OrderMessage | null, to: string, mailboxes: string[]): string {
  if (!message || message.direction !== "in") return "";
  const skip = new Set([...addressesIn(to), ...mailboxes.flatMap((m) => addressesIn(m))]);
  return [...addressesIn(message.to_addresses), ...addressesIn(message.cc_addresses)]
    .filter((a, i, all) => !skip.has(a) && all.indexOf(a) === i)
    .join(", ");
}

/**
 * The quoted message under a reply, the way Mail.app writes it:
 *
 *     On Oct 29, 2026, at 3:21 PM, Kelly Nygaard <kelly@gmail.com> wrote:
 *
 *     > Thank you - this looks great!
 *
 * The whole message is quoted, its own history included, because that is
 * what a mail program does — and the tab folds it away again from the "On …
 * wrote:" line (`splitQuoted`). Lines already quoted gain one more ">".
 */
export function replyQuote(message: OrderMessage | null, timeZone: string): string {
  if (!message) return "";
  const at = new Date(message.sent_at);
  const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(at);
  // ICU puts a narrow no-break space before "PM"; a plain email wants a space.
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
    .format(at)
    .replace(/[  ]/g, " ");
  const who = message.from_name ? `${message.from_name} <${message.from_address}>` : message.from_address;
  const text = (message.body_text ?? message.snippet ?? "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const quoted = text
    .split("\n")
    .map((line) => (line === "" ? ">" : line.startsWith(">") ? `>${line}` : `> ${line}`))
    .join("\n");
  return `On ${day}, at ${time}, ${who} wrote:\n\n${quoted}`;
}

/** A new reply's text: room to type, then the quote. The caret goes at 0. */
export function replyDraft(message: OrderMessage | null, timeZone: string): string {
  const quote = replyQuote(message, timeZone);
  return quote ? `\n\n${quote}` : "";
}

/** The shop's own addresses for special orders — the mailbox it sends from
 *  and any reply-to it publishes — which a reply never copies back. */
export function orderMailboxes(orgSettings: Record<string, unknown> | null | undefined): string[] {
  const so = (orgSettings?.special_orders ?? {}) as Record<string, unknown>;
  const provider = (so.email_provider ?? {}) as Record<string, unknown>;
  return [provider.from, provider.reply_to, so.reply_to].flatMap((v) => (typeof v === "string" ? addressesIn(v) : []));
}
