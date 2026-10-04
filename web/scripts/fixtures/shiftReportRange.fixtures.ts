// The shift report list's date window — `lib/shiftReportRange`.

import {
  DEFAULT_SHIFT_REPORT_RANGE,
  shiftReportRangeBounds,
  shiftReportRangeToken,
} from "../../src/lib/shiftReportRange";
import { eq, test } from "./harness";

const TODAY = "2026-10-04";

test("shiftReportRange: the default is the last 30 days THROUGH today", () => {
  // Through today, not to yesterday: the draft somebody came to finish is
  // today's, and the list opens on Drafts.
  eq(shiftReportRangeBounds(undefined, TODAY), { from: "2026-09-04", to: TODAY }, "absent");
  eq(shiftReportRangeBounds("30", TODAY), { from: "2026-09-04", to: TODAY }, "by key");
  // An unreadable token is the default, never all time.
  eq(shiftReportRangeBounds("nonsense", TODAY), { from: "2026-09-04", to: TODAY }, "nonsense");
  eq(shiftReportRangeBounds("2026-13-45..2026-10-01", TODAY), { from: "2026-09-04", to: TODAY }, "bad date");
});

test("shiftReportRange: presets, all time and a picked pair", () => {
  eq(shiftReportRangeBounds("all", TODAY), null, "all time");
  eq(shiftReportRangeBounds("7", TODAY), { from: "2026-09-27", to: TODAY }, "7 days");
  eq(shiftReportRangeBounds("yesterday", TODAY), { from: "2026-10-03", to: "2026-10-03" }, "yesterday");
  eq(
    shiftReportRangeBounds("2026-08-28..2026-09-02", TODAY),
    { from: "2026-08-28", to: "2026-09-02" },
    "custom"
  );
});

test("shiftReportRange: the picker's answer is stored by KEY where it is a preset", () => {
  eq(shiftReportRangeToken({ from: "2026-09-04", to: TODAY }, TODAY), DEFAULT_SHIFT_REPORT_RANGE, "30");
  eq(shiftReportRangeToken(null, TODAY), "all", "all time");
  eq(
    shiftReportRangeToken({ from: "2026-08-28", to: "2026-09-02" }, TODAY),
    "2026-08-28..2026-09-02",
    "custom"
  );
});
