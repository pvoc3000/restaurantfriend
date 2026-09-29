import { test, eq } from "./harness";
import { poLine, withCatalog } from "./factories";
import { billLinesFromOrder } from "../../src/lib/billFromOrder";

test("a bill from an order bills what arrived, at the line's price", () => {
  const counted = poLine({ qty_ordered: 4, qty_received: 3, unit_price: 12.5, description: "Flour" });
  const uncounted = poLine({ qty_ordered: 2, qty_received: null, unit_price: 5 });
  const nothingCame = poLine({ qty_ordered: 6, qty_received: 0, unit_price: 9 });
  const bill = billLinesFromOrder("po-1", [counted, nothingCame, uncounted]);

  eq(bill.length, 2, "a line counted at 0 is left off");
  eq(bill[0].qty, 3, "received, not ordered, where it was counted");
  eq(bill[0].extended, 37.5, "and the charge follows it");
  eq(bill[1].qty, 2, "ordered where nobody counted");
  eq(bill.map((l) => l.line_no).join(","), "1,2", "numbered with no gap for the skipped line");
  eq(bill[0].purchase_order_item_id, counted.id, "each line names its PO line");
  eq(bill[1].purchase_order_id, "po-1", "and its order");
});

test("no price is an absence, not a free line", () => {
  const [line] = billLinesFromOrder("po-1", [poLine({ qty_ordered: 1, unit_price: null })]);
  eq(line.extended, null, "no extended without a price");
});

test("the description falls back to the catalog name", () => {
  const [line] = billLinesFromOrder("po-1", [
    withCatalog(poLine({ description: null, unit_price: 1 }), { name: "Sugar" }),
  ]);
  eq(line.description, "Sugar", "our name when the line has none");
});
