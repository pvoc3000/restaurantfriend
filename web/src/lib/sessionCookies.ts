import type { cookies } from "next/headers";

import { INVOICE_VIEW_COOKIE } from "@/lib/invoiceFilters";
import { NAV_COOKIE } from "@/lib/navMemory";
import { GUIDE_VIEW_COOKIE } from "@/lib/orderGuide";
import { PO_VIEW_COOKIE } from "@/lib/poFilters";
import { SPECIAL_ORDER_VIEW_COOKIE } from "@/lib/specialOrderView";
import { PIN_SESSION_COOKIE } from "@/lib/sharedDevice";

export type CookieJar = Awaited<ReturnType<typeof cookies>>;

/**
 * Everything that is PER SESSION and would otherwise be the previous
 * person's on a shared iPad: the guide, PO, invoice and
 * special-order views, the menu memory, and the PIN-session mark. Never `rf.device` — the device stays
 * registered through a sign-out.
 *
 * One list, read by `signOut`, `lockDevice` and `unlockWithPin`, because a
 * cookie remembered in one sweep and forgotten in another is exactly how
 * `signOut` came to miss the invoice view for a fortnight of that list
 * existing. A plain module rather than a `"use server"` export: a server
 * action is an endpoint, and this takes a cookie jar.
 */
export function clearSessionCookies(jar: CookieJar) {
  jar.delete(GUIDE_VIEW_COOKIE);
  jar.delete(PO_VIEW_COOKIE);
  jar.delete(INVOICE_VIEW_COOKIE);
  jar.delete(SPECIAL_ORDER_VIEW_COOKIE);
  jar.delete(NAV_COOKIE);
  jar.delete(PIN_SESSION_COOKIE);
}
