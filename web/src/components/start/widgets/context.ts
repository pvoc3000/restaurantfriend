import type { AppSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";

import type { StartContext } from "./shared";

/** The widgets' context for this session's working shop, or null with none. */
export async function startContext(session: AppSession): Promise<StartContext | null> {
  const shop = session.activeLocation;
  if (!shop) return null;
  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  return {
    supabase: await createClient(),
    session,
    role: session.membership.role,
    orgId: session.membership.org_id,
    today: todayInTimeZone(timeZone),
    timeZone,
    shop: { id: shop.id, code: shop.code },
  };
}
