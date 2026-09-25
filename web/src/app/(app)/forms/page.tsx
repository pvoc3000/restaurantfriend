import { FormPreview } from "@/components/forms/FormPreview";
import { FORM_GROUPS, FORM_KEYS, type FormKey } from "@/components/forms/formCatalog";
import { PageHeading } from "@/components/ui/PageHeading";
import { SectionNav } from "@/components/ui/SectionNav";
import { getAppSession } from "@/lib/session";
import { docOrgFrom } from "@/lib/specialOrderDocs";

/**
 * FORMS — every printed document in the app on one page, rendered by its real
 * component over sample data (Mark, 2026-09-25: "put mockups of all the
 * various forms we use in the app … I want to work on the layouts"). /interface
 * is the same idea for the controls.
 *
 * Nothing here reads a record or writes one. The org's own name and settings
 * are the one real input, so every masthead is the one actually sent.
 *
 * Ungoverned in `lib/pageAccess` (no row) and exempt from
 * `InactiveLocationGate`, like /interface. Reached by URL; not on the menu.
 */
export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string | string[] }>;
}) {
  const session = await getAppSession();
  if (!session) return null;
  const raw = (await searchParams).form;
  const form: FormKey = FORM_KEYS.find((k) => k === raw) ?? FORM_KEYS[0];

  const settings = (session.orgSettings ?? {}) as Record<string, unknown>;
  const docOrg = docOrgFrom(session.orgName, settings);

  return (
    <div className="space-y-6">
      <PageHeading title="Forms" total={FORM_KEYS.length} noun="forms" />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div
          className="hidden space-y-5 lg:sticky lg:block lg:w-52 lg:shrink-0"
          style={{ top: "calc(var(--rf-header-h) + 1.5rem)" }}
        >
          {FORM_GROUPS.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-subtle">
                {group.label}
              </p>
              <SectionNav
                ariaLabel={group.label}
                value={form}
                items={group.forms.map((f) => ({ key: f.key, label: f.label, href: `/forms?form=${f.key}` }))}
              />
            </div>
          ))}
        </div>
        <div className="lg:hidden">
          <SectionNav
            orientation="horizontal"
            ariaLabel="Which form"
            value={form}
            items={FORM_GROUPS.flatMap((g) =>
              g.forms.map((f) => ({ key: f.key, label: f.label, href: `/forms?form=${f.key}` }))
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <FormPreview form={form} docOrg={docOrg} poSettings={settings} orgName={session.orgName} />
        </div>
      </div>
    </div>
  );
}
