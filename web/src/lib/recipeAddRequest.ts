/**
 * "Open the add row" — a one-value store, `lib/shiftFocus`' shape.
 *
 * The recipe record's Actions menu (title row) and the sheet's add rows (inside
 * a tab) are SIBLINGS under a server component, so no prop can reach from one
 * to the other. The menu may also have to NAVIGATE to the Ingredients or
 * Procedure tab first, which remounts the sheet; a module value survives that
 * soft navigation, so the request is still waiting when the add row mounts.
 *
 * A REQUEST, not a state: each carries a nonce, and the add row clears it once
 * honoured, so returning to the tab later does not reopen it.
 */

export type RecipeAddKind = "ingredient" | "step";

let request: { what: RecipeAddKind; nonce: number } | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function requestRecipeAdd(what: RecipeAddKind): void {
  nonce += 1;
  request = { what, nonce };
  notify();
}

export function clearRecipeAdd(n: number): void {
  if (request?.nonce !== n) return;
  request = null;
  notify();
}

export function subscribeRecipeAdd(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readRecipeAdd(): { what: RecipeAddKind; nonce: number } | null {
  return request;
}

export function serverRecipeAdd(): null {
  return null;
}
