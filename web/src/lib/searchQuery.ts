/**
 * THE SERVER HALF OF "A SEARCH LOOKS PAST THE DATE WINDOW" — see
 * `lib/searchWindow` for the client half and why it exists.
 *
 * Bills and purchase orders cap at 500 rows, so dropping the window on its own
 * would hand the client the 500 most recent and search those. Instead the page
 * asks the DATABASE for rows matching every word, all dates, and the client's
 * own word match then narrows exactly as it always has. The server match is a
 * SUPERSET of the client's (each word against each searched field, ANDed across
 * words), so nothing the client would show is ever left behind.
 */

/** Next hands searchParams over as string | string[] | undefined per key. */
export function searchTerm(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
}

/**
 * The words of a term, safe inside a PostgREST `or(…)` list.
 *
 * The characters PostgREST reserves there — `,` `(` `)` `.` `:` `"` and the
 * pattern's own `%` `*` `\` — become `*`, the wildcard, rather than being
 * dropped: "a.b" must still find "a.b", and `a*b` does where `ab` would not.
 */
export function searchWords(term: string): string[] {
  return term
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[,().:"%*\\]/g, "*"))
    .filter((w) => w.replace(/\*/g, "") !== "");
}
