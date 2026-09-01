/**
 * TYPING A DATE — the parse behind `ui/DateField`'s text box.
 *
 * Why this exists (Mark, 2026-09-01): "All fields using the calendar picker
 * should still allow the user to enter the date directly rather than rely on
 * the calendar picker UI. Sometimes it's faster to type the date or even paste
 * the date than fumble around with the picker."
 *
 * A native `<input type="date">` is typeable-ish and is NOT pasteable — no
 * engine accepts `⌘V` into its segments, because there is no text there to
 * replace, only three spin fields. And `DateField` made the typing half worse
 * than the platform: an EMPTY one is laid over a blank and clicking it opens
 * the picker rather than placing a caret, so on the commonest case — a date
 * that is not set yet — there was nothing to type into at all.
 *
 * So the visible control is a text box and the native input survives, hidden,
 * purely as something to call `showPicker()` on. That also RETIRES the bug that
 * file is mostly about: Safari paints today's date into an empty date input, so
 * a null column read as a delivery that had already happened. A text box paints
 * what you give it.
 *
 * Pure — no DOM, no React — so it is compiled into the Node fixture run.
 *
 * ------------------------------------------------------------------------
 * WHAT IT ACCEPTS, and why the order rule is the shape it is.
 *
 * A FOUR-DIGIT FIRST PART MEANS ISO. `2026-09-01` is what Postgres prints,
 * what this app stores, and therefore what gets pasted out of a query result or
 * another cell in this app. Anything else is read US-first, `M/D/Y`, which is
 * what the native input renders in this locale and what somebody at a bench
 * would write.
 *
 * There is no `D/M/Y` reading and there must not be a guess between the two:
 * 03/04 is a real date under both and they are a month apart, so a heuristic
 * would be silently wrong on a third of the calendar. One locale, stated.
 *
 * A TWO-DIGIT YEAR IS 2000 + n, unconditionally. Every date this app holds is
 * an employment date, an order date or a schedule; the earliest real data is
 * 2014 and nothing is typed about 1926.
 *
 * ------------------------------------------------------------------------
 * AND THE ROUND TRIP IS THE PART THAT MATTERS, which is `lib/invoiceExtraction`
 * `isoDate`'s own lesson: `new Date("2026-02-31")` does not fail, it rolls over
 * to March 2nd. Composing the string and comparing it back is what refuses a
 * day that does not exist — otherwise typing 2/31 quietly stores March.
 */

/**
 * What a box of text means.
 *
 * THREE ANSWERS, NOT TWO, and the third is why this is not just `string |
 * null`. An EMPTY box is somebody clearing the field, which is a real edit that
 * writes null; unreadable text is a typo, and writing null for it would erase
 * the date they were trying to correct. The control reverts on `invalid` and
 * commits on the other two.
 */
export type TypedDate =
  | { status: "empty" }
  | { status: "date"; iso: string }
  | { status: "invalid" };

/** Split on the separators anybody actually types, including a pasted ISO. */
const PARTS = /^(\d{1,4})\s*[/\-. ]\s*(\d{1,2})\s*[/\-. ]\s*(\d{1,4})$/;
const DIGITS = /^\d{8}$/;

export function parseTypedDate(raw: string): TypedDate {
  // A pasted timestamp keeps only its date. `2026-09-01T00:00:00+00:00` is what
  // comes off a `created_at`, and refusing it would be pedantry — the reader
  // plainly means that day.
  //
  // ANCHORED ON THE COLON, never on the space. Splitting at the first
  // whitespace was the first cut and it ate `9 1 2026` down to `9`, because a
  // space is also one of the separators below. A time has a colon in it and a
  // date does not, so that is what tells them apart.
  const text = raw
    .trim()
    .replace(/[T\s]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(Z|[+-]\d{2}(:?\d{2})?)?$/i, "")
    .trim();
  if (text === "") return { status: "empty" };

  let y: number;
  let m: number;
  let d: number;

  const parts = PARTS.exec(text);
  if (parts) {
    const [, a, b, c] = parts;
    if (a.length === 4) {
      // ISO: 2026-09-01.
      y = Number(a);
      m = Number(b);
      d = Number(c);
    } else if (c.length === 4 || c.length <= 2) {
      // US: 9/1/2026 or 9/1/26.
      m = Number(a);
      d = Number(b);
      y = expandYear(Number(c), c.length);
    } else {
      // A three-digit year is nobody's typo worth guessing at.
      return { status: "invalid" };
    }
  } else if (DIGITS.test(text)) {
    // Eight bare digits, which is what a scanner or a spreadsheet paste gives.
    // `20260901` versus `09012026` is decided by the FIRST TWO, and only
    // 19xx/20xx is read as a year — every other leading pair is a month, which
    // is the same US-first rule as above rather than a new one.
    const lead = text.slice(0, 2);
    if (lead === "19" || lead === "20") {
      y = Number(text.slice(0, 4));
      m = Number(text.slice(4, 6));
      d = Number(text.slice(6, 8));
    } else {
      m = Number(text.slice(0, 2));
      d = Number(text.slice(2, 4));
      y = Number(text.slice(4, 8));
    }
  } else {
    return { status: "invalid" };
  }

  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return { status: "invalid" };
  }
  // A cheap frame before the round trip, so "month 13" is refused as itself
  // rather than as a rollover.
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1000 || y > 9999) {
    return { status: "invalid" };
  }

  const iso = `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
  // THE ROUND TRIP. February 31st parses, so only formatting it back and
  // comparing catches it.
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { status: "invalid" };
  if (parsed.toISOString().slice(0, 10) !== iso) return { status: "invalid" };

  return { status: "date", iso };
}

/**
 * An ISO date as the box shows it — `09/01/2026`, or "" for no date.
 *
 * ZERO-PADDED AND US-ORDERED, which is exactly what a native `<input
 * type="date">` renders in this locale. That is the whole of the choice: this
 * replaces that control on every screen in the app at once, so anything else
 * would be a visible change to fifty fields nobody asked to move.
 */
export function formatTypedDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function expandYear(n: number, digits: number): number {
  // 26 → 2026. See the header: nothing in this app is typed about the 1900s.
  return digits <= 2 ? 2000 + n : n;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
