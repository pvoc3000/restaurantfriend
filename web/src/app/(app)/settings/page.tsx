import { getAppSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { canManageMembers } from "@/lib/roles";
import { ShiftReportSettings } from "@/components/settings/ShiftReportSettings";
import { SpecialOrderSettings } from "@/components/settings/SpecialOrderSettings";
import { AccountingSettings, type AccountingStatus } from "@/components/settings/AccountingSettings";
import { SectionNav } from "@/components/ui/SectionNav";
import {
  SETTINGS_TABS,
  SETTINGS_TAB_LABEL,
  parseSettingsTab,
  settingsTabHref,
} from "@/lib/orgSettings";

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
 * Behind the masthead's STOREFRONT icon since 2026-09-04; the gear beside it
 * is a member's own /account. The layout gate refuses this screen below
 * manager (`lib/pageAccess`), which is why the icon is withheld there too.
 *
 * OWNER AND MANAGER ONLY, because 001's `org_update` policy is
 * `user_has_role(id, array['owner','admin'])`. Below that RLS would accept the
 * write, change zero rows and return NO error — the silent-failure shape this
 * app has been bitten by repeatedly — so the screen renders read-only rather
 * than offering an edit the database will swallow. Every value is still SHOWN:
 * knowing what the shop's quote says is not manager-only, changing it is.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await getAppSession();
  if (!session) return null;
  const tab = parseSettingsTab((await searchParams).tab);

  const editable = canManageMembers(session.membership.role);

  // Read on the SERVER, like every other block on this screen. The token row
  // itself is unreadable — 081 gave it zero policies — so this definer function
  // is the only way to learn anything about the connection, and it returns the
  // realm and the dates and never a credential.
  // Only the Accounting tab reads it — each tab fetches only itself, the
  // employee record's rule.
  let accounting: AccountingStatus | null = null;
  if (tab === "accounting") {
    const supabase = await createClient();
    const { data: qbo } = await supabase.rpc("accounting_connection_status", {
      p_org: session.membership.org_id,
    });
    accounting = Array.isArray(qbo) ? ((qbo[0] as AccountingStatus | undefined) ?? null) : null;
  }

  const tabOptions = SETTINGS_TABS.map((t) => ({
    key: t,
    label: SETTINGS_TAB_LABEL[t],
    href: settingsTabHref(t),
  }));
  const orgId = session.membership.org_id;
  const settings = session.orgSettings as Record<string, unknown>;

  return (
    <div className="space-y-8">
      {/* Indented to the content column — `lg:ml-48` is the sidebar's `lg:w-40`
          plus the row's `lg:gap-8`, the employee record's coupled trio. */}
      <div className="space-y-2 lg:ml-48">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Org settings
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          {editable
            ? "What this business is connected to, and what it says to its customers. Everything here is saved as you type."
            : "What this business is connected to, and what it says to its customers. Changing these is open to managers and the owner."}
        </p>
      </div>

      {/* THREE SECTIONS (Mark, 2026-09-05), `ui/SectionNav` vertical beside the
          content and horizontal above it below `lg` — the employee and vendor
          records' shape, copied rather than re-derived. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div
          className="hidden lg:sticky lg:block lg:w-40 lg:shrink-0"
          style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}
        >
          <SectionNav ariaLabel="Which settings" value={tab} items={tabOptions} />
        </div>
        <div className="lg:hidden">
          <SectionNav orientation="horizontal" ariaLabel="Which settings" value={tab} items={tabOptions} />
        </div>

        <div className="min-w-0 flex-1 space-y-16">
          {tab === "general" && (
            <>
              <SpecialOrderSettings orgId={orgId} settings={settings} editable={editable} section="general" />
              {/* Say what this screen does NOT cover, so its absence is a
                  statement rather than something to hunt for. */}
              <section className="space-y-2 border-t border-hairline pt-6">
                <p className="max-w-2xl text-[13px] leading-relaxed text-subtle">
                  Purchase-order email, the PO number format, payroll and the billing
                  entity also live in this org’s settings and do not have a screen
                  yet — they are edited in the database. The shop names customers see are
                  on each location’s own record.
                </p>
              </section>
            </>
          )}
          {tab === "messages" && (
            <>
              <SpecialOrderSettings orgId={orgId} settings={settings} editable={editable} section="messages" />
              <div className="border-t border-hairline pt-8">
                <ShiftReportSettings settings={settings} editable={editable} />
              </div>
            </>
          )}
          {tab === "accounting" && (
            <AccountingSettings orgId={orgId} editable={editable} initialStatus={accounting} />
          )}
        </div>
      </div>
    </div>
  );
}
