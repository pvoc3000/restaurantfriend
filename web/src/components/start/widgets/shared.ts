import type { Role } from "@/lib/roles";
import type { AppSession } from "@/lib/session";
import type { createClient } from "@/lib/supabase/server";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A loader's answer: rows, or the reason there are none. */
export type Result<T> = { data: T; error: null } | { data: null; error: string };

/**
 * What every widget's server half is handed. One wave of fetches per page
 * load, scoped to the WORKING shop (2026-09-17) — every count agrees with the
 * list it links to because those lists follow the working shop too.
 */
export type StartContext = {
  supabase: Supabase;
  session: AppSession;
  role: Role;
  orgId: string;
  today: string;
  timeZone: string;
  shop: { id: string; code: string };
};

/** "9/1/26" — string arithmetic, never a Date, so no timezone can move it. */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}`;
}

/** "Wed 9/1/26". */
export function longDate(iso: string): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${shortDate(iso)}`;
}
