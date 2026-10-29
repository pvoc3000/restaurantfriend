// An order's emails (migration 214): reading a Gmail message
// (`supabase/functions/_shared/orderMail.ts`, which `order-mail` runs) and
// showing it on the Emails tab (`lib/orderEmail`).

import { eq, test } from "./harness";
import {
  baseSubject,
  htmlToText,
  messageAttachments,
  messageText,
  orderNumbersIn,
  parseAddresses,
  readMessage,
  type GmailMessage,
} from "../../../supabase/functions/_shared/orderMail";
import {
  answering,
  conversation,
  replyAddress,
  splitQuoted,
  waitingFor,
  type OrderMessage,
} from "../../src/lib/orderEmail";

const b64url = (text: string) =>
  Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("parseAddresses: names, quotes, commas inside quotes, case", () => {
  eq(parseAddresses('"Smith, Jen" <Jen@Example.com>, bo@y.org'), [
    { name: "Smith, Jen", address: "jen@example.com" },
    { name: null, address: "bo@y.org" },
  ], "a quoted comma does not split");
  eq(parseAddresses("Donut Friend <specialorders@donutfriend.com>"), [
    { name: "Donut Friend", address: "specialorders@donutfriend.com" },
  ], "a display name");
  eq(parseAddresses(""), [], "empty");
  eq(parseAddresses("undisclosed-recipients:;"), [], "no address at all");
});

test("orderNumbersIn: the prefix, case-blind, as the number stores it", () => {
  eq(orderNumbersIn("Re: DONUT FRIEND SO-10176: Order", "SO-"), ["SO-10176"], "upper-case subject");
  eq(orderNumbersIn("Delivery quote request — order #SO-10112, 10/28/2026", "SO-"), ["SO-10112"], "after a #");
  eq(orderNumbersIn("[External] Donut Friend so-10145: Corporate Event", "SO-"), ["SO-10145"], "lower-case");
  eq(orderNumbersIn("SO-10150 and SO-10151", "SO-"), ["SO-10150", "SO-10151"], "two orders");
  eq(orderNumbersIn("ALSO-10150", "SO-"), [], "inside a word is not a number");
  eq(orderNumbersIn("Order 10150", ""), [], "no prefix, no guess");
  eq(orderNumbersIn("Last Minute Special Order", "SO-"), [], "none");
});

test("baseSubject: a run of Re:/Fwd: comes off", () => {
  eq(baseSubject("Re: Re: Fwd: Donut Friend SO-10098: Smith Wedding"), "Donut Friend SO-10098: Smith Wedding", "run");
  eq(baseSubject("RE:Donut Friend SO-1"), "Donut Friend SO-1", "no space");
  eq(baseSubject("Reorder for Friday"), "Reorder for Friday", "a word starting Re is not a prefix");
});

test("messageText: the plain part first, else the HTML reduced", () => {
  const plain = {
    mimeType: "multipart/alternative",
    parts: [
      { partId: "0", mimeType: "text/plain", body: { data: b64url("Can we switch to vegan?\r\n\r\nThanks!") } },
      { partId: "1", mimeType: "text/html", body: { data: b64url("<p>ignored</p>") } },
    ],
  };
  eq(messageText(plain), "Can we switch to vegan?\n\nThanks!", "plain wins");
  const htmlOnly = { mimeType: "text/html", body: { data: b64url("<div>Hi&nbsp;there</div><div>Two&amp;three</div>") } };
  eq(messageText(htmlOnly), "Hi there\nTwo&three", "html only");
  eq(htmlToText("<style>p{}</style><p>One</p><br><p>Two &#8217; &rsquo;</p>"), "One\n\nTwo ’ ’", "entities and blocks");
  eq(messageText(undefined), "", "no payload");
});

test("messageAttachments: files with their part, not the body", () => {
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      { partId: "0", mimeType: "text/plain", body: { data: b64url("see photo") } },
      { partId: "1", mimeType: "image/JPEG", filename: "cake.jpg", body: { size: 2048, attachmentId: "ANGjdJ" } },
    ],
  };
  eq(messageAttachments(payload), [
    { part_id: "1", filename: "cake.jpg", mime_type: "image/jpeg", size: 2048, attachment_id: "ANGjdJ" },
  ], "one photo");
  eq(messageText(payload), "see photo", "the file is not the text");
});

const message = (from: string, to: string, labels: string[] = ["INBOX"]): GmailMessage => ({
  id: "m1",
  threadId: "t1",
  labelIds: labels,
  internalDate: String(Date.UTC(2026, 9, 28, 14, 2)),
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: from },
      { name: "To", value: to },
      { name: "Subject", value: "Re: Donut Friend SO-10156: Birthday" },
      { name: "Message-ID", value: "<abc@mail.gmail.com>" },
    ],
    body: { data: b64url("Thanks!") },
  },
});

test("readMessage: in, out, and the app talking to itself", () => {
  const mailbox = "specialorders@donutfriend.com";
  const inbound = readMessage(message("Kelly <kelly@gmail.com>", "specialorders@donutfriend.com"), mailbox);
  eq(inbound.ok && inbound.message.direction, "in", "a customer is in");
  eq(inbound.ok && inbound.message.sentAt, "2026-10-28T14:02:00.000Z", "Gmail's own date");
  eq(inbound.ok && inbound.message.rfcMessageId, "<abc@mail.gmail.com>", "the Message-ID");
  const outbound = readMessage(message("Donut Friend <SpecialOrders@donutfriend.com>", "kelly@gmail.com"), mailbox);
  eq(outbound.ok && outbound.message.direction, "out", "the mailbox is out, case-blind");
  eq(readMessage(message("specialorders@donutfriend.com", "specialorders@donutfriend.com"), mailbox), {
    ok: false,
    reason: "shop notice",
  }, "a notice to itself is left out");
  eq(readMessage(message("kelly@gmail.com", mailbox, ["DRAFT"]), mailbox), { ok: false, reason: "draft" }, "drafts");
  eq(readMessage(message("kelly@gmail.com", mailbox, ["SPAM"]), mailbox), { ok: false, reason: "spam" }, "spam");
});

test("splitQuoted: the reply, and the history under it", () => {
  eq(
    splitQuoted("Yes please!\n\nOn Mon, Oct 27, 2026 at 10:14 AM Donut Friend <specialorders@donutfriend.com> wrote:\n> Hi Jen"),
    { main: "Yes please!", quoted: "On Mon, Oct 27, 2026 at 10:14 AM Donut Friend <specialorders@donutfriend.com> wrote:\n> Hi Jen" },
    "Apple Mail / Gmail"
  );
  eq(
    splitQuoted("Sounds good\n\nOn Mon, Oct 27, 2026 at 10:14 AM Donut Friend <\nspecialorders@donutfriend.com> wrote:\n\n> Hi"),
    { main: "Sounds good", quoted: "On Mon, Oct 27, 2026 at 10:14 AM Donut Friend <\nspecialorders@donutfriend.com> wrote:\n\n> Hi" },
    "Gmail's wrapped attribution"
  );
  eq(
    splitQuoted("Approved.\n\nFrom: Donut Friend <specialorders@donutfriend.com>\nSent: Monday, October 27, 2026 10:14 AM\nTo: Lemus, J"),
    { main: "Approved.", quoted: "From: Donut Friend <specialorders@donutfriend.com>\nSent: Monday, October 27, 2026 10:14 AM\nTo: Lemus, J" },
    "Outlook"
  );
  eq(
    splitQuoted("> what time?\n5 pm works\n> and the address?\n123 Main"),
    { main: "> what time?\n5 pm works\n> and the address?\n123 Main", quoted: "" },
    "an answer typed between quotes is all message"
  );
  eq(
    splitQuoted("Fine by me\n\n> Can we do 5 pm?\n>\n> Jen"),
    { main: "Fine by me", quoted: "> Can we do 5 pm?\n>\n> Jen" },
    "a trailing run of > lines"
  );
  eq(splitQuoted("Just a note"), { main: "Just a note", quoted: "" }, "nothing quoted");
  eq(
    splitQuoted("On Mon, Oct 27 Jen wrote:\n> hi"),
    { main: "On Mon, Oct 27 Jen wrote:\n> hi", quoted: "" },
    "nothing but history shows it all"
  );
  eq(splitQuoted(null), { main: "", quoted: "" }, "no body");
});

test("waitingFor: minutes, hours, days", () => {
  const now = Date.UTC(2026, 9, 29, 12, 0);
  eq(waitingFor(new Date(now - 40 * 60_000).toISOString(), now), "40 min", "minutes");
  eq(waitingFor(new Date(now - 3 * 3_600_000).toISOString(), now), "3 h", "hours");
  eq(waitingFor(new Date(now - 27 * 3_600_000).toISOString(), now), "1 d 3 h", "a day and some");
  eq(waitingFor(new Date(now - 48 * 3_600_000).toISOString(), now), "2 d", "whole days");
  eq(waitingFor(new Date(now + 60_000).toISOString(), now), "0 min", "a clock a little ahead");
});

const msg = (id: string, direction: "in" | "out", at: string, rfc: string | null, from = "jen@x.com"): OrderMessage => ({
  id,
  direction,
  from_address: from,
  from_name: null,
  to_addresses: null,
  cc_addresses: null,
  subject: null,
  sent_at: at,
  rfc_message_id: rfc,
  body_text: null,
  snippet: null,
  attachments: [],
  handled_at: null,
  handled_by: null,
});

test("conversation: oldest first, one copy per Message-ID", () => {
  const list = [
    msg("b", "in", "2026-10-28T10:00:00Z", "<2@x>"),
    msg("a", "out", "2026-10-27T10:00:00Z", "<1@x>", "specialorders@donutfriend.com"),
    msg("a2", "out", "2026-10-27T10:00:01Z", "<1@X>", "specialorders@donutfriend.com"),
    msg("c", "in", "2026-10-29T10:00:00Z", null),
  ];
  eq(conversation(list).map((m) => m.id), ["a", "b", "c"], "the self-copy goes, a message with no id stays");
  eq(replyAddress(conversation(list), "contact@x.com"), "jen@x.com", "the newest sender from outside");
  eq(replyAddress([], " contact@x.com "), "contact@x.com", "no mail: the contact");
  eq(answering(conversation(list))?.id, "c", "the newest from outside");
  eq(answering([msg("a", "out", "2026-10-27T10:00:00Z", "<1@x>")])?.id, "a", "only ours: the newest");
  eq(answering([]), null, "nothing to answer");
});
