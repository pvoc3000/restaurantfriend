/**
 * "Take me to that shift" — a one-value store, read with `useSyncExternalStore`.
 *
 * WHY A STORE AND NOT A PROP (Mark, 2026-08-22: "Is it possible to click on the
 * issue on the dialogue box and be taken to the timesheet in question so we can
 * edit it?"). The Close-pay-period panel and the shift list are SIBLINGS under a
 * server component, so there is no shared client ancestor to hold the state and
 * no prop that can reach across. The alternatives were worse: moving the panel
 * inside the list is a large restructure for one message, and putting it in the
 * URL means `router.replace` re-running a page that fetches eight queries — for
 * a value that is not view state and should not survive a reload.
 *
 * `lib/navMemoryStore` is the same shape for the same reason.
 *
 * The value is `employee_id|workday`, which is the grain a break finding has —
 * a finding belongs to a WORKDAY, not to one shift of it, and the list resolves
 * that to whichever of the day's rows carries the finding.
 *
 * It is a REQUEST, not a destination: every read is paired with a counter, so
 * asking for the same shift twice in a row still notifies. Without that, closing
 * the panel and clicking the same finding again would do nothing.
 */

let request: { key: string; nonce: number } | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

export function requestShiftFocus(employeeId: string, workday: string): void {
  nonce += 1;
  request = { key: `${employeeId}|${workday}`, nonce };
  for (const l of listeners) l();
}

export function subscribeShiftFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current request, or null. Referentially stable until one is made. */
export function readShiftFocus(): { key: string; nonce: number } | null {
  return request;
}

/** The server snapshot: never a request, so nothing jumps during hydration. */
export function serverShiftFocus(): null {
  return null;
}
