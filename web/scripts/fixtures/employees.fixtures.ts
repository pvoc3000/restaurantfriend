// lib/employees — the two judgments the create form and the delete dialog make
// before they touch the database.
//
// `findPossibleRehires` is the one with real teeth: 417 of the 445 rows are
// former employees, so the duplicate you're most likely to create is someone the
// roster's default Active tab isn't even showing. The cases that matter are the
// ones where a match SHOULD be found among people nobody is looking at, and the
// ones where an over-eager matcher would cry wolf on two unrelated people.

import {
  EMPLOYEE_TABS,
  EMPLOYEE_TAB_LABEL,
  employeeTabHref,
  parseEmployeeTab,
  deleteWarnings,
  findPossibleRehires,
  isSelf,
  type EmployeeStatus,
} from "../../src/lib/employees";
import { eq, no, ok, test } from "./harness";

type Row = {
  id: string;
  first_name: string;
  last_name: string;
  nickname: string | null;
  status: EmployeeStatus;
};

const person = (
  id: string,
  first: string,
  last: string,
  status: EmployeeStatus = "inactive",
  nickname: string | null = null
): Row => ({ id, first_name: first, last_name: last, nickname, status });

const ROSTER: Row[] = [
  person("1", "Daniel", "Kim"),
  person("2", "Sofia", "Kim", "active"),
  person("3", "Ada", "Prentice", "active"),
  person("4", "Rosa", "Jimenez"),
  person("5", "Robert", "Nakamura", "inactive", "Bobby"),
  person("6", "Ana", "Bananas", "active"),
];

const names = (rows: Row[]) => rows.map((r) => `${r.last_name}, ${r.first_name}`);

// ---------------------------------------------------------------- rehires

test("a former employee is found — the whole point", () => {
  eq(names(findPossibleRehires(ROSTER, "Rosa", "Jimenez")), ["Jimenez, Rosa"]);
});

test("an exact first-name match ranks above a surname-only one", () => {
  // Both Kims come back, but the Daniel you typed leads.
  eq(names(findPossibleRehires(ROSTER, "Daniel", "Kim")), ["Kim, Daniel", "Kim, Sofia"]);
});

test("surname alone still warns — that's a different Kim, and worth seeing", () => {
  eq(names(findPossibleRehires(ROSTER, "Marcus", "Kim")), ["Kim, Daniel", "Kim, Sofia"]);
});

test("case and surrounding whitespace don't matter", () => {
  eq(names(findPossibleRehires(ROSTER, "  rosa ", "  JIMENEZ  ")), ["Jimenez, Rosa"]);
});

test("the name they went by counts as an exact match", () => {
  // Robert Nakamura is "Bobby"; hiring a Bobby Nakamura is the same man.
  const found = findPossibleRehires(ROSTER, "Bobby", "Nakamura");
  eq(names(found), ["Nakamura, Robert"]);
});

test("an unknown surname warns about nobody", () => {
  eq(findPossibleRehires(ROSTER, "Jordan", "Okonkwo"), []);
});

test("a surname is not a prefix — 'Ban' must not match 'Bananas'", () => {
  eq(findPossibleRehires(ROSTER, "Ana", "Ban"), []);
});

test("an empty surname warns about nobody, whatever the first name says", () => {
  eq(findPossibleRehires(ROSTER, "Daniel", ""), []);
  eq(findPossibleRehires(ROSTER, "Daniel", "   "), []);
});

test("a one-letter surname is a real surname, not too short to match", () => {
  // There is no minimum length, deliberately: matching is exact rather than a
  // prefix, so a floor would only ever suppress the warning for someone
  // genuinely called O.
  const roster = [...ROSTER, person("7", "Min-ji", "O", "inactive")];
  eq(names(findPossibleRehires(roster, "Min-ji", "O")), ["O, Min-ji"]);
});

test("no first name yet still warns on the surname", () => {
  eq(names(findPossibleRehires(ROSTER, "", "Kim")), ["Kim, Daniel", "Kim, Sofia"]);
});

test("the list is capped, so a common surname can't fill the dialog", () => {
  const many = Array.from({ length: 40 }, (_, i) => person(String(i), `A${i}`, "Nguyen"));
  eq(findPossibleRehires(many, "Linh", "Nguyen").length, 5);
  eq(findPossibleRehires(many, "Linh", "Nguyen", 2).length, 2);
});

test("the exact match survives the cap — it must never be the one dropped", () => {
  const many = Array.from({ length: 40 }, (_, i) => person(String(i), `A${i}`, "Nguyen"));
  many.push(person("x", "Linh", "Nguyen"));
  const found = findPossibleRehires(many, "Linh", "Nguyen");
  eq(names(found)[0], "Nguyen, Linh");
});

// ------------------------------------------------------- delete warnings

const clean = { legacy_id: null, user_id: null };

test("a hand-created record with nothing attached warns about nothing", () => {
  const w = deleteWarnings(clean, 0);
  no(w.any, "any");
  eq(w.migrated, null);
  no(w.hasAccess, "hasAccess");
  eq(w.documents, 0);
});

test("a migrated record names its FileMaker id", () => {
  const w = deleteWarnings({ legacy_id: 214, user_id: null }, 0);
  ok(w.any, "any");
  eq(w.migrated, 214);
});

test("legacy_id 0 is still a migrated record, not a missing one", () => {
  // Guards the `?? null` — a falsy id must not read as "created in the app".
  const w = deleteWarnings({ legacy_id: 0, user_id: null }, 0);
  ok(w.any, "any");
  eq(w.migrated, 0);
});

test("app access alone fires the warning", () => {
  const w = deleteWarnings({ legacy_id: null, user_id: "u-1" }, 0);
  ok(w.any, "any");
  ok(w.hasAccess, "hasAccess");
});

test("documents alone fire the warning", () => {
  const w = deleteWarnings(clean, 3);
  ok(w.any, "any");
  eq(w.documents, 3);
});

test("events alone fire the warning", () => {
  // 035 cascades, and this is the count that grows without anyone noticing — a
  // decade of warnings buried under a thousand shift ratings. Drop `events` out
  // of the `any` expression and this goes red.
  const w = deleteWarnings(clean, 0, 1214);
  ok(w.any, "any");
  eq(w.events, 1214);
});

test("all four at once, each reported separately", () => {
  const w = deleteWarnings({ legacy_id: 214, user_id: "u-1" }, 2, 903);
  eq(w, { migrated: 214, hasAccess: true, documents: 2, events: 903, any: true });
});

test("a record with nothing hanging off it stays a clean delete", () => {
  // The other half of the rule: the events count must not make EVERY record
  // look dangerous, or the warning stops meaning anything.
  const w = deleteWarnings(clean, 0, 0);
  no(w.any, "any");
  eq(w.events, 0);
});

test("the event count defaults to zero, so an unmigrated caller still works", () => {
  const w = deleteWarnings(clean, 0);
  eq(w.events, 0);
  no(w.any, "any");
});

// ------------------------------------------------------------ record tabs

test("an unrecognised tab falls back to the record itself", () => {
  // A stale bookmark or a typo should show you the person, not an error and not
  // an empty shell.
  eq(parseEmployeeTab("events"), "events", "a real tab");
  eq(parseEmployeeTab(undefined), "info", "no parameter at all");
  eq(parseEmployeeTab(""), "info", "empty");
  eq(parseEmployeeTab("payroll"), "info", "a tab that never existed");
  eq(parseEmployeeTab("Events"), "info", "case matters — the URL is the vocabulary");
  eq(parseEmployeeTab(["documents", "admin"]), "documents", "a repeated parameter takes the first");
});

test("every tab in the list parses back to itself", () => {
  // The list, the labels and the parser have to agree or a sidebar cell links
  // somewhere that renders as `info`.
  for (const t of EMPLOYEE_TABS) {
    eq(parseEmployeeTab(t), t, t);
    ok(EMPLOYEE_TAB_LABEL[t], `${t} is labelled`);
  }
});

test("the default tab writes no parameter, so the record keeps one address", () => {
  // Otherwise every link already stored — the roster's rows, the found set, a
  // pasted URL — would point at something that isn't canonical.
  eq(employeeTabHref("e-1", "info"), "/employees/e-1");
  eq(employeeTabHref("e-1", "events"), "/employees/e-1?tab=events");
});

test("switching tabs carries the breadcrumb trail through", () => {
  // Drop `from` here and moving between tabs silently strips the trail that led
  // to the record, which also costs the record book its found set.
  eq(
    employeeTabHref("e-1", "admin", { from: "/employees", fromLabel: "Employees" }),
    "/employees/e-1?from=%2Femployees&fromLabel=Employees&tab=admin",
    "params kept, tab appended",
  );
  eq(
    employeeTabHref("e-1", "info", { from: "/employees", fromLabel: "Employees" }),
    "/employees/e-1?from=%2Femployees&fromLabel=Employees",
    "and no tab= on the default",
  );
});

test("the old tab is replaced, never appended twice", () => {
  eq(employeeTabHref("e-1", "documents", { tab: "events" }), "/employees/e-1?tab=documents");
  eq(employeeTabHref("e-1", "info", { tab: "events" }), "/employees/e-1", "back to the default drops it");
});

// ------------------------------------------------------------ self-delete

test("your own record is recognised — Delete is never offered on it", () => {
  ok(isSelf({ user_id: "u-me" }, "u-me"), "isSelf");
});

test("someone else's record is not you", () => {
  no(isSelf({ user_id: "u-them" }, "u-me"), "isSelf");
});

test("a record with NO access is never you, whoever is asking", () => {
  // Most of the 445 have no user_id at all; every one of them must stay
  // deletable, or the guard that protects one record protects all of them.
  no(isSelf({ user_id: null }, "u-me"), "isSelf");
});
