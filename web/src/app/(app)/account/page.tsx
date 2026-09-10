import { AccountSettings } from "@/components/account/AccountSettings";
import { ROLE_LABEL } from "@/lib/roles";
import { getAppSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the masthead's GEAR points since 2026-09-04: the member's own
 * settings, as distinct from the org's behind the storefront icon beside it.
 * Ungoverned in `lib/pageAccess` — everyone has a name and a password — and
 * exempt from `InactiveLocationGate`, since none of it is about a shop.
 */
export default async function AccountPage() {
  const session = await getAppSession();

  // 073: an empty grid means every shop, and `workableLocations` is
  // `activeLocations` narrowed by it — identical for anybody unrestricted.
  const restricted = session.workableLocations.length !== session.activeLocations.length;

  // 097's status read: a timestamp or null, never the hash. Swallowed if the
  // function is not there yet — the block then reads "Not set", which is
  // the honest answer until the migration is applied.
  const supabase = await createClient();
  const { data: pinSetAt } = await supabase.rpc("member_pin_set_at", { p_user: session.userId });

  return (
    <div className="space-y-8">
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        Your settings
      </h1>
      <AccountSettings
        displayName={session.membership.display_name}
        email={session.email}
        roleLabel={ROLE_LABEL[session.membership.role]}
        shops={restricted ? session.workableLocations.map((l) => l.code) : null}
        pinSetAt={(pinSetAt as string | null) ?? null}
        pinSession={session.pinSession}
        registeredDevice={session.registeredDevice}
        shell={session.shell}
      />
    </div>
  );
}
