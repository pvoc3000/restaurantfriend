// `lib/calendarColors` — which colour a chip wears, and what is saved.
//
// Checked by BREAKING: letting an item's own colour beat `blackout` recolours a
// closed day; trusting the jsonb lets a layer or a colour that no longer exists
// through to a class lookup that returns undefined; and storing a layer's
// DEFAULT as a decision freezes it against any later change of default.

import { test, eq, ok, no } from "./harness";
import {
  BLACKOUT_CHIP,
  CALENDAR_PALETTE,
  chipClass,
  colorChip,
  DEFAULT_LAYER_COLOR,
  isCalendarColor,
  layerColor,
  readLayerColors,
  withLayerColor,
} from "../../src/lib/calendarColors";
import { CALENDAR_LAYERS } from "../../src/lib/calendar";

test("every layer has a default, and every default is in the palette", () => {
  for (const layer of CALENDAR_LAYERS) {
    ok(isCalendarColor(DEFAULT_LAYER_COLOR[layer.key]), layer.key);
  }
  eq(new Set(CALENDAR_PALETTE.map((c) => c.key)).size, CALENDAR_PALETTE.length, "no duplicate keys");
  eq(new Set(CALENDAR_PALETTE.map((c) => c.chip)).size, CALENDAR_PALETTE.length, "no two swatches alike");
});

test("the order: blackout, the item's own, the organisation's, the default", () => {
  const colors = { deliveries: "lime" } as const;
  eq(chipClass({ layer: "deliveries" }, {}), colorChip("sky"), "default");
  eq(chipClass({ layer: "deliveries" }, colors), colorChip("lime"), "the organisation's");
  eq(chipClass({ layer: "entries", color: "red" }, { entries: "lime" }), colorChip("red"), "its own");
  eq(chipClass({ layer: "entries", color: "red", blackout: true }, {}), BLACKOUT_CHIP, "a blackout is dark");
});

test("a colour the palette does not have is treated as not set", () => {
  no(isCalendarColor("chartreuse"));
  no(isCalendarColor(null));
  eq(chipClass({ layer: "entries", color: "chartreuse" }, {}), colorChip("yellow"));
  eq(colorChip("chartreuse"), colorChip("slate"), "never undefined");
});

test("readLayerColors ignores what it does not know", () => {
  eq(readLayerColors(null), {});
  eq(readLayerColors({ calendar: { colors: "nope" } }), {});
  eq(
    readLayerColors({ calendar: { colors: { deliveries: "lime", gone_layer: "red", tasks: "chartreuse" } } }),
    { deliveries: "lime" },
  );
});

test("withLayerColor keeps the rest of settings, and unsets on the default", () => {
  const settings = { timezone: "America/Los_Angeles", calendar: { other: 1, colors: { tasks: "red" } } };
  const set = withLayerColor(settings, "deliveries", "lime");
  eq(set, {
    timezone: "America/Los_Angeles",
    calendar: { other: 1, colors: { tasks: "red", deliveries: "lime" } },
  });
  eq(layerColor("deliveries", readLayerColors(set)), "lime");
  // Back to sky, the default: the key goes, so the map holds only decisions.
  eq(withLayerColor(set, "deliveries", "sky").calendar, { other: 1, colors: { tasks: "red" } });
  eq(settings.calendar.colors, { tasks: "red" }, "the original is not mutated");
});
