import { getAppSession } from "@/lib/session";
import { canManageMembers } from "@/lib/roles";
import { ShiftReportSettings } from "@/components/settings/ShiftReportSettings";
import { SpecialOrderSettings } from "@/components/settings/SpecialOrderSettings";

/**
 * Where the masthead's gear points, and what it had been promising since the
 * skeleton: "Org and location settings live in orgs.settings / locations.settings
 * jsonb today and are edited in Supabase; this is the slot for the screen that
 * will edit them properly."
 *
 * This is that screen, for the SPECIAL ORDERS module — the one whose settings a
 * person actually needs to reach, because they are the words customers read.
 * The other blocks in `orgs.settings` (payroll, po_email, po_number_format,
 * billing, timezone) are still SQL-only and named at the bottom, so nobody has
 * to guess whether this screen is the whole of it.
 *
 * OWNER AND MANAGER ONLY, because 001's `org_update` policy is
 * `user_has_role(id, array['owner','admin'])`. Below that RLS would accept the
 * write, change zero rows and return NO error — the silent-failure shape this
 * app has been bitten by repeatedly — so the screen renders read-only rather
 * than offering an edit the database will swallow. Every value is still SHOWN:
 * knowing what the shop's quote says is not manager-only, changing it is.
 */
export default async function SettingsPage() {
  const session = await getAppSession();
  if (!session) return null;

  const editable = canManageMembers(session.membership.role);

  return (
    <div className="space-y-16">
      <div className="space-y-2">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Settings
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          {editable
            ? "What this business says to its customers. Everything here is saved as you type."
            : "What this business says to its customers. Changing these is open to managers and the owner."}
        </p>
      </div>

      <SpecialOrderSettings
        orgId={session.membership.org_id}
        settings={session.orgSettings as Record<string, unknown>}
        editable={editable}
      />

      <div className="border-t border-hairline pt-8">
        <ShiftReportSettings
          settings={session.orgSettings as Record<string, unknown>}
          editable={editable}
        />
      </div>

      {/* Say what this screen does NOT cover, so its absence is a statement
          rather than something to hunt for. */}
      <section className="space-y-2 border-t border-hairline pt-6">
        <p className="max-w-2xl text-[13px] leading-relaxed text-subtle">
          Purchase-order email, the PO number format, payroll and the billing
          entity also live in this org&rsquo;s settings and do not have a screen
          yet — they are edited in the database. The shop names customers see are
          on each location&rsquo;s own record.
        </p>
      </section>
    </div>
  );
}
