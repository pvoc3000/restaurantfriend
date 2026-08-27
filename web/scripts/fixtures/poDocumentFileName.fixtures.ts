// poDocumentFileName — what a purchase-order PDF is called on disk.
//
// It exists because a preview tab cannot answer the question: the tab is
// navigated to a `blob:` URL, whose path is a UUID and which carries no
// `Content-Disposition` — measured in the browser on a Blob AND on a File with
// a name, both — so saving from the browser's own PDF viewer produces
// `8f3c….pdf` however the blob was made. `a.download` is the only lever, which
// is why Download is a command of its own beside Preview, and why the name it
// passes is worth pinning.
//
// TWO CALLERS SHARE THIS: `ProcessPo` names one order's document and
// `PurchaseOrderList` names a batch. They have to agree about what a PO
// document is called — a filename spelt in two places is `nextDeliveryDate`'s
// trap in miniature.

import { poDocumentFileName } from "../../src/lib/purchaseOrders";
import { eq, test } from "./harness";

test("poDocumentFileName: one order is named after it", () => {
  eq(poDocumentFileName("po", ["112-181203-01"]), "PO 112-181203-01.pdf", "vendor doc");
  eq(
    poDocumentFileName("shopping", ["164-181207-01"]),
    "Shopping list 164-181207-01.pdf",
    "shopping list"
  );
});

test("poDocumentFileName: a small batch lists every number", () => {
  eq(
    poDocumentFileName("po", ["112-181203-01", "132-181205-01"]),
    "POs 112-181203-01, 132-181205-01.pdf",
    "two"
  );
  eq(
    poDocumentFileName("shopping", ["100-181210-01", "110-181213-01", "135-181202-01"]),
    "Shopping lists 100-181210-01, 110-181213-01, 135-181202-01.pdf",
    "three — the most that is listed"
  );
});

test("poDocumentFileName: past three it counts the rest", () => {
  // A Monday's ordering is a dozen POs. Every number is what the reader wants
  // and twelve of them is a name no file browser will show the end of, so the
  // count is what stops the name lying about what is in the file.
  eq(
    poDocumentFileName("po", ["A", "B", "C", "D"]),
    "POs A, B, C +1 more.pdf",
    "four"
  );
  eq(
    poDocumentFileName("po", ["A", "B", "C", "D", "E", "F", "G", "H"]),
    "POs A, B, C +5 more.pdf",
    "eight"
  );
});

test("poDocumentFileName: characters a filesystem refuses are substituted, not dropped", () => {
  // `number` is TEXT and a human has suffixed one before (`5689a`,
  // `3932 cont.`), so a slash is reachable. Substituting keeps the number
  // legible where stripping would quietly produce a different one.
  eq(poDocumentFileName("po", ["2899/01"]), "PO 2899-01.pdf", "slash");
  eq(poDocumentFileName("po", ['6002:a*b?c"d<e>f|g']), "PO 6002-a-b-c-d-e-f-g.pdf", "the rest");
});

test("poDocumentFileName: nothing selected still names a file", () => {
  // Unreachable from the list (the bar only renders with a selection) and it
  // must not produce ".pdf" or "undefined.pdf" if it ever becomes reachable.
  eq(poDocumentFileName("po", []), "POs.pdf", "no orders");
  eq(poDocumentFileName("shopping", ["   "]), "Shopping lists.pdf", "blank number");
});
