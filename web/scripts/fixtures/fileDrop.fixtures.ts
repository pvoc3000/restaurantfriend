// Fixtures for what may be DROPPED onto the document pane.
//
// A drop gets no help from the browser: `accept` on an `<input>` governs the
// picker and nothing else, so every guarantee the picker gave has to be
// re-earned here. The case that matters most is HEIC — it's what an iPhone
// photo is, the model API won't read one, and an unchecked drop would file the
// invoice and only fail later, at extraction, with the file already stored.

import { ATTACHMENT_ACCEPT, attachmentRejection } from "../../src/lib/attachments";
import { fileMatchesAccept } from "../../src/lib/fileTypes";
import { eq, no, ok, test } from "./harness";

const file = (name: string, type: string) => ({ name, type });

// ── What gets through ───────────────────────────────────────────────────────

test("a PDF is attachable", () => {
  ok(fileMatchesAccept(file("invoice.pdf", "application/pdf"), ATTACHMENT_ACCEPT));
});

test("the three photo formats are attachable", () => {
  for (const [name, type] of [
    ["a.jpg", "image/jpeg"],
    ["b.png", "image/png"],
    ["c.webp", "image/webp"],
  ]) {
    ok(fileMatchesAccept(file(name, type), ATTACHMENT_ACCEPT), name);
  }
});

test("a stated type is matched case-insensitively", () => {
  ok(fileMatchesAccept(file("INVOICE.PDF", "Application/PDF"), ATTACHMENT_ACCEPT));
});

// ── What doesn't ────────────────────────────────────────────────────────────

test("HEIC is refused — the whole reason this check exists", () => {
  no(fileMatchesAccept(file("IMG_4021.HEIC", "image/heic"), ATTACHMENT_ACCEPT));
});

test("HEIF is refused too", () => {
  no(fileMatchesAccept(file("IMG_4021.heif", "image/heif"), ATTACHMENT_ACCEPT));
});

test("a GIF is refused — the model API takes it, this app doesn't offer it", () => {
  // ATTACHMENT_ACCEPT is the contract, not the API's capability list: the
  // picker doesn't offer GIF, so a drop mustn't be the one way in.
  no(fileMatchesAccept(file("scan.gif", "image/gif"), ATTACHMENT_ACCEPT));
});

test("a spreadsheet dragged in by accident is refused", () => {
  no(fileMatchesAccept(file("order.xlsx", "application/vnd.ms-excel"), ATTACHMENT_ACCEPT));
});

test("a folder — no name extension, no type — is refused", () => {
  no(fileMatchesAccept(file("Invoices", ""), ATTACHMENT_ACCEPT));
});

// ── The extension fallback ──────────────────────────────────────────────────

test("a typeless file falls back to its extension", () => {
  // Some drags report an empty type; refusing a good PDF over a missing MIME
  // string would be its own bug.
  ok(fileMatchesAccept(file("invoice.pdf", ""), ATTACHMENT_ACCEPT));
  ok(fileMatchesAccept(file("photo.JPEG", ""), ATTACHMENT_ACCEPT));
});

test("the extension fallback still refuses a typeless HEIC", () => {
  no(fileMatchesAccept(file("IMG_4021.heic", ""), ATTACHMENT_ACCEPT));
});

test("a stated type WINS over the extension — the fallback never overrides", () => {
  // A file named .pdf that says it's a HEIC is judged on what it says. The
  // reverse matters more: renaming a HEIC to .pdf must not smuggle it in.
  no(fileMatchesAccept(file("invoice.pdf", "image/heic"), ATTACHMENT_ACCEPT));
});

// ── What the person is told ─────────────────────────────────────────────────

test("the rejection names the file", () => {
  const message = attachmentRejection([file("order.xlsx", "application/vnd.ms-excel")]);
  ok(message.includes("order.xlsx"));
  ok(message.includes("PDF"));
});

test("a HEIC rejection says how to get it in anyway", () => {
  const message = attachmentRejection([file("IMG_4021.HEIC", "image/heic")]);
  ok(message.includes("IMG_4021.HEIC"));
  ok(/attach button/i.test(message), "names the way through");
});

test("HEIC is recognised by NAME when the type is empty", () => {
  // A typeless drop is exactly when the advice is most needed, so the sentence
  // must not depend on the MIME string being there.
  ok(/attach button/i.test(attachmentRejection([file("IMG_4021.HEIC", "")])));
});

test("a non-HEIC rejection doesn't offer HEIC advice", () => {
  no(/attach button/i.test(attachmentRejection([file("order.xlsx", "text/csv")])));
});

test("several rejected files are all named", () => {
  const message = attachmentRejection([file("a.gif", "image/gif"), file("b.txt", "text/plain")]);
  ok(message.includes("a.gif"));
  ok(message.includes("b.txt"));
});

test("nothing rejected says nothing", () => {
  eq(attachmentRejection([]), "");
});
