/**
 * THE SUBJECT EVERY CUSTOMER EMAIL ABOUT ONE ORDER GOES UNDER (Mark,
 * 2026-10-02: "Donut Friend SO-10098: Smith Wedding"), so Mail.app and Gmail
 * keep them in one conversation. Migration 167 stores it on the order the
 * first time one is sent, and it is never rewritten — "keep the subject the
 * same even if the title changes" — so this is only ever called for an order
 * that has no thread yet.
 *
 * The template is `orgs.settings.special_orders.thread_subject` (design rule
 * 2); the default carries no business name, only `{org}`.
 *
 * MIRRORED in `web/src/lib/specialOrderDocs.ts` (`threadSubject`), because the
 * browser composes the first email's subject for the compose card and Deno
 * cannot import from `web/`. `threadSubject.fixtures.ts` runs both over the
 * same cases, so the copies cannot drift without the suite going red.
 */

export const DEFAULT_THREAD_SUBJECT = "{org} {number}: {title}";

export function threadSubject(
  template: string | null | undefined,
  values: { org: string | null | undefined; number: string | null | undefined; title: string | null | undefined }
): string {
  const t = typeof template === "string" && template.trim() !== "" ? template : DEFAULT_THREAD_SUBJECT;
  const vars: Record<string, string> = {
    org: (values.org ?? "").trim(),
    number: (values.number ?? "").trim(),
    title: (values.title ?? "").trim(),
  };
  return t
    .replace(/\{(org|number|title)\}/g, (_, k: string) => vars[k])
    .replace(/\s+/g, " ")
    // An order with no title leaves "Donut Friend SO-10098:" — the separator
    // goes with the missing words.
    .replace(/^[\s:—–,-]+|[\s:—–,-]+$/g, "")
    .trim();
}
