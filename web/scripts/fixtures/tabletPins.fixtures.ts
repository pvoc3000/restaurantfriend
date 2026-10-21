// The tablet's pinned tiles and the desk's Actions widget (lib/tablet/pins).

import { eq, ok, test } from "./harness";
import { LANDING_GROUPS, type TileGroup } from "../../src/lib/tablet/landing";
import { chosenTiles, readTileKeys, stepPin, togglePin, withPinned } from "../../src/lib/tablet/pins";

const keysOf = (tiles: { key: string }[]) => tiles.map((t) => t.key);
const all = LANDING_GROUPS as unknown as TileGroup[];

test("pins: unknown keys and second copies are dropped, order kept", () => {
  eq(readTileKeys(["order_guide", "weather", "shift_report", "order_guide", 3]), ["order_guide", "shift_report"]);
  eq(readTileKeys(null), []);
  eq(readTileKeys("order_guide"), []);
});

test("pins: a pinned tile moves up out of its group, and an emptied group goes", () => {
  const { pinned, groups } = withPinned(all, ["special_orders", "order_guide"]);
  eq(keysOf(pinned), ["special_orders", "order_guide"], "in the order pinned");
  const purchasing = groups.find((g) => g.label === "Purchasing")!;
  ok(!keysOf(purchasing.tiles).includes("order_guide"));
  ok(!groups.some((g) => g.label === "Sales"), "Sales held only View Orders");
});

test("pins: a pin the role cannot use is hidden, not shown as a door", () => {
  const noPurchasing = all.filter((g) => g.label !== "Purchasing");
  eq(keysOf(chosenTiles(noPurchasing, ["order_guide", "tags"])), ["tags"]);
});

test("pins: toggle appends or removes", () => {
  eq(togglePin(["tags"], "order_guide"), ["tags", "order_guide"]);
  eq(togglePin(["tags", "order_guide"], "tags"), ["order_guide"]);
});

test("pins: a step moves past hidden pins, and is a no-op at the ends", () => {
  const pins = ["tags", "order_guide", "recipes"] as const;
  const shown = ["tags", "recipes"] as const; // order_guide hidden
  eq(stepPin([...pins], "recipes", -1, shown), ["recipes", "tags", "order_guide"]);
  eq(stepPin([...pins], "tags", 1, shown), ["order_guide", "recipes", "tags"]);
  eq(stepPin([...pins], "tags", -1, shown), [...pins]);
  eq(stepPin([...pins], "recipes", 1, shown), [...pins]);
});
