// `lib/timeInput` — typing a time into `ui/TimePicker`'s entry field.

import { test, eq } from "./harness";
import {
  composeTime,
  formatTypedTime,
  parseTypedTime,
  timeParts,
} from "../../src/lib/timeInput";

const hhmm = (raw: string) => {
  const out = parseTypedTime(raw);
  return out.status === "time" ? out.hhmm : out.status;
};

/* -- twelve-hour, the way a shop writes its hours -------------------------- */

test("am/pm in its ordinary spellings", () => {
  eq(hhmm("9pm"), "21:00");
  eq(hhmm("9 PM"), "21:00");
  eq(hhmm("9:30p"), "21:30");
  eq(hhmm("9:30 p.m."), "21:30");
  eq(hhmm("10:15am"), "10:15");
  eq(hhmm("7a"), "07:00");
});

test("12am is midnight and 12pm is noon — the pair most often got backwards", () => {
  eq(hhmm("12am"), "00:00");
  eq(hhmm("12:30am"), "00:30");
  eq(hhmm("12pm"), "12:00");
  eq(hhmm("12:45 pm"), "12:45");
});

test("noon and midnight by name", () => {
  eq(hhmm("noon"), "12:00");
  eq(hhmm("Midnight"), "00:00");
});

/* -- twenty-four-hour, and digits with no colon ---------------------------- */

test("with no suffix the hour is 24-hour — never a guess at the half of the day", () => {
  eq(hhmm("21:30"), "21:30");
  eq(hhmm("9:30"), "09:30");
  eq(hhmm("0:15"), "00:15");
  eq(hhmm("9"), "09:00");
});

test("compact digits: the last two are the minute", () => {
  eq(hhmm("930"), "09:30");
  eq(hhmm("0930"), "09:30");
  eq(hhmm("2130"), "21:30");
  eq(hhmm("930p"), "21:30");
});

/* -- the refusals ---------------------------------------------------------- */

test("an empty box is a clear, not a typo", () => {
  eq(parseTypedTime("").status, "empty");
  eq(parseTypedTime("   ").status, "empty");
});

test("what is not a time is refused rather than rounded", () => {
  eq(hhmm("25:00"), "invalid");
  eq(hhmm("9:60"), "invalid");
  eq(hhmm("13pm"), "invalid");
  eq(hhmm("0am"), "invalid");
  eq(hhmm("half ten"), "invalid");
  eq(hhmm("9:5"), "invalid");
  eq(hhmm("12345"), "invalid");
});

/* -- reading a stored value back ------------------------------------------- */

test("a Postgres time reads back as the parts a picker shows", () => {
  eq(JSON.stringify(timeParts("10:00:00")), JSON.stringify({ hour12: 10, minute: 0, meridiem: "am" }));
  eq(JSON.stringify(timeParts("00:30")), JSON.stringify({ hour12: 12, minute: 30, meridiem: "am" }));
  eq(JSON.stringify(timeParts("12:00")), JSON.stringify({ hour12: 12, minute: 0, meridiem: "pm" }));
  eq(JSON.stringify(timeParts("21:05:00")), JSON.stringify({ hour12: 9, minute: 5, meridiem: "pm" }));
  eq(timeParts(null), null);
  eq(timeParts("nonsense"), null);
});

test("composing the parts is the inverse of reading them", () => {
  for (const value of ["00:00", "00:30", "09:05", "12:00", "12:59", "13:00", "21:30", "23:55"]) {
    const p = timeParts(value)!;
    eq(composeTime(p.hour12, p.minute, p.meridiem), value, value);
  }
  eq(composeTime(13, 0, "pm"), null);
});

test("the field shows a twelve-hour time", () => {
  eq(formatTypedTime("10:00:00"), "10:00 AM");
  eq(formatTypedTime("00:30"), "12:30 AM");
  eq(formatTypedTime("12:00"), "12:00 PM");
  eq(formatTypedTime("21:05"), "9:05 PM");
  eq(formatTypedTime(null), "");
});
