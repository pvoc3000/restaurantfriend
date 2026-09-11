import { InterfaceShowcase } from "@/components/interface/InterfaceShowcase";
import { getAppSession } from "@/lib/session";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";

/**
 * THE INTERFACE — every shared control in the app on one page, working, with
 * fake data (Mark, 2026-09-10: "put on it examples of every single UI object we
 * have in the app … the elements/controls should be operable so we can test
 * them"). Nothing on it writes to the database: every control that normally
 * writes is handed a local write instead.
 *
 * Ungoverned in `lib/pageAccess` (no row) and exempt from
 * `InactiveLocationGate`, like /account — it is not about a shop or a role.
 */
export default async function InterfacePage() {
  const session = await getAppSession();
  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  return <InterfaceShowcase today={today} />;
}
