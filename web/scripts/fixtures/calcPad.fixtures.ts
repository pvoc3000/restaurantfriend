// looksUnfinished — the rule that keeps `ui/CalcPad`'s readout quiet while you
// are still tapping.
//
// The pad shows a live "= 35" as you build an expression, so it also has to
// decide when to say it CAN'T read one. Getting that wrong in the noisy
// direction is what these pin: "5×" doesn't parse, and a warning the instant
// you press an operator would be on screen for most of the time anyone spends
// typing. Mark's word for the first attempt at making these fields work on an
// iPad was "clumsy"; nagging is how a control earns that.
//
// The rule is deliberately shallow — "is the person still typing", not "will
// this parse". `evaluateNumeric` is the authority on the second, and these
// cases exist partly to keep this from growing into a second opinion about it.

import { looksUnfinished, evaluateNumeric } from "../../src/lib/calc";
import { eq, test } from "./harness";

test("looksUnfinished: a trailing operator is mid-typing, not an error", () => {
  for (const s of ["5×", "5*", "5+", "5-", "5/", "5÷", "4×9×"]) {
    eq(looksUnfinished(s), true, s);
    // The pair that matters: the pad only stays quiet because BOTH are true —
    // it doesn't parse, and it isn't finished.
    eq(evaluateNumeric(s), null, `${s} really doesn't parse`);
  }
});

test("looksUnfinished: an open paren is mid-typing", () => {
  eq(looksUnfinished("("), true, "just opened");
  eq(looksUnfinished("12×("), true, "opened after an operator");
  eq(looksUnfinished("12×(3+4"), true, "still inside");
  eq(looksUnfinished("(1+2)×(3"), true, "second one still open");
});

test("looksUnfinished: a complete expression is finished", () => {
  for (const s of ["5", "5×7", "12×(3+4)", "(1+2)×(3+4)", "4*9*25", "0.5"]) {
    eq(looksUnfinished(s), false, s);
  }
});

test("looksUnfinished: empty is not unfinished — there is nothing to warn about", () => {
  // The readout renders neither a result nor a refusal here, and it must not
  // claim the field is mid-expression either.
  eq(looksUnfinished(""), false, "empty");
  eq(looksUnfinished("   "), false, "whitespace only");
});

test("looksUnfinished: a REAL typo is finished, so the pad does complain", () => {
  // This is the direction the rule must not swallow. Each parses to null and is
  // not mid-typing, which is exactly when "can't read" earns its place.
  for (const s of ["5×7)", "((1+2)", ")", "1..2", "5×7×"]) {
    const unfinished = looksUnfinished(s);
    const parses = evaluateNumeric(s) !== null;
    if (s === "((1+2)" || s === "5×7×") {
      eq(unfinished, true, `${s} is genuinely still open`);
    } else {
      eq(unfinished, false, `${s} is not mid-typing`);
      eq(parses, false, `${s} does not parse`);
    }
  }
});

test("looksUnfinished: a closing paren too many is NOT treated as still open", () => {
  // Depth goes negative; a naive `depth !== 0` would call this unfinished and
  // silently swallow a real typo.
  eq(looksUnfinished("5×7)"), false, "extra close");
  eq(looksUnfinished("(1+2))"), false, "one extra close");
});

test("looksUnfinished: noise is stripped the same way the parser strips it", () => {
  // `$1,200×` is what a price field looks like mid-expression.
  eq(looksUnfinished("$1,200×"), true, "trailing operator behind noise");
  eq(looksUnfinished("$1,200"), false, "plain money is finished");
});
