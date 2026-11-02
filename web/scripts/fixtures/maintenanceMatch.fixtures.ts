/**
 * Is this maintenance request already reported? (lib/maintenanceMatch) — the
 * tablet's Submit a Maintenance Request ranks what is open at the shop so a
 * second shift adds to a request instead of filing it again.
 *
 * Nothing here refuses anything; the cases pin the RANKING and the line a
 * second report leaves on the first, which is what a manager reads.
 */

import { test, eq, ok } from "./harness";
import {
  LIKELY_MATCH,
  matchScore,
  rankOpenRequests,
  raisedPriority,
  withAlsoReported,
  wordsOf,
  type OpenRequest,
  type RequestDraft,
} from "../../src/lib/maintenanceMatch";

const draft = (over: Partial<RequestDraft> = {}): RequestDraft => ({
  title: "",
  details: "",
  equipment_id: "",
  equipment_name: null,
  shop_section_id: "",
  ...over,
});

const req = (over: Partial<OpenRequest> = {}): OpenRequest => ({
  id: "r",
  title: "",
  details: null,
  equipment_id: null,
  equipment_name: null,
  shop_section_id: null,
  ...over,
});

test("words: roots, no filler, walk-in is one word", () => {
  eq([...wordsOf("The walk-in is leaking again")].sort(), ["leak", "walkin"]);
  eq([...wordsOf("Leaks under the sinks")].sort(), ["leak", "sink", "under"]);
  eq([...wordsOf("Fryer won't heat — broken")], ["fryer", "heat"]);
  eq(wordsOf(null).size, 0);
});

test("same equipment alone is a likely match", () => {
  const s = matchScore(
    draft({ title: "Making a grinding noise", equipment_id: "dish" }),
    req({ title: "Won't drain", equipment_id: "dish" })
  );
  ok(s >= LIKELY_MATCH, `scored ${s}`);
});

test("the same shelf alone is not", () => {
  const s = matchScore(draft({ shop_section_id: "kitchen" }), req({ shop_section_id: "kitchen" }));
  ok(s < LIKELY_MATCH, `scored ${s}`);
});

test("shared words find it with no equipment chosen — the equipment's NAME counts", () => {
  // The first reporter picked the walk-in; the second only typed.
  const s = matchScore(
    draft({ title: "walk in cooler too warm" }),
    req({ title: "Temperature reading 45", equipment_id: "w", equipment_name: "Walk-in Cooler" })
  );
  ok(s >= 2, `scored ${s}`);
  ok(
    matchScore(draft({ title: "Ice machine leaking water" }), req({ title: "ice machine leaks" })) >= LIKELY_MATCH,
    "three shared roots"
  );
});

test("unrelated requests score nothing", () => {
  eq(matchScore(draft({ title: "Front door lock sticks" }), req({ title: "Fryer won't heat", equipment_id: "f" })), 0);
});

test("words are capped, so a long details box cannot outvote the machine", () => {
  const long = "oven door hinge handle glass light fan timer";
  eq(matchScore(draft({ title: long }), req({ title: long })), 3);
});

test("ranking: likeliest first, ties keep the loaded (newest-first) order", () => {
  const open = [req({ id: "a", title: "Door sticks" }), req({ id: "b", title: "Mixer bowl" }), req({ id: "c", title: "Door hinge" })];
  eq(rankOpenRequests(draft({ title: "mixer bowl stuck" }), open).map((r) => r.request.id), ["b", "a", "c"]);
  eq(rankOpenRequests(draft(), open).map((r) => r.request.id), ["a", "b", "c"], "an empty draft browses");
});

test("a second report raises priority, never lowers it", () => {
  eq(raisedPriority("normal", "high"), "high");
  eq(raisedPriority("high", "low"), "high");
  eq(raisedPriority("low", "normal"), "normal");
});

test("Also reported by — signed, dated, appended", () => {
  eq(
    withAlsoReported("Compressor is loud.", { name: "Karina", date: "Nov 2", note: " Still loud, now 44°F " }),
    "Compressor is loud.\n\nAlso reported by Karina on Nov 2: Still loud, now 44°F"
  );
  eq(withAlsoReported(null, { name: "Levi", date: "Nov 3", note: "" }), "Also reported by Levi on Nov 3.");
  eq(withAlsoReported("  ", { name: "Levi", date: "Nov 3", note: "" }), "Also reported by Levi on Nov 3.");
});
