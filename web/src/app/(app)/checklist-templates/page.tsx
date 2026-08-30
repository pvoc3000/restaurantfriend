import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditChecklists } from "@/lib/roles";
import {
  ChecklistTemplatesList,
  type TemplateRow,
} from "@/components/checklists/ChecklistTemplatesList";

/**
 * The master lists — what a checklist, a walkthrough or an inspection ASKS.
 *
 * Location-scoped, and deliberately (Mark, 2026-08-29): "the same checklist
 * probably wouldn't run at two shops. The layouts are too different and the
 * requirements aren't even close." Duplicate-then-change-location is the
 * shortcut instead, and it lives on the record.
 *
 * Migration 076 is the schema; `lib/checklists` holds the rules.
 */
export default async function ChecklistTemplatesPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }

  const editable = canEditChecklists(session.membership.role);

  const { data: templates, error } = await supabase
    .from("checklist_templates")
    .select("id, kind, name, weekdays, shifts, is_active, notes")
    .eq("location_id", active.id)
    .order("kind")
    .order("name");

  if (error) {
    // 076 may not have been applied yet. Say so rather than rendering an empty
    // table, which would assert that this shop has no lists — 018's precedent.
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load the master lists: {error.message}
        {error.message.includes("checklist_templates") &&
          " — migration 076 has not been applied yet."}
      </p>
    );
  }

  // One narrow count per template, tallied in the browser rather than with an
  // embedded aggregate. Paginated: PostgREST caps a page at 1,000 silently, and
  // a truncated count reads exactly like a real one.
  const counts = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error: countError } = await supabase
      .from("checklist_template_items")
      .select("template_id")
      .eq("is_active", true)
      .order("id")
      .range(from, from + 999);
    if (countError) break;
    for (const row of data ?? []) {
      const id = row.template_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if ((data ?? []).length < 1000) break;
  }

  const rows: TemplateRow[] = (templates ?? []).map((t) => ({
    id: t.id as string,
    kind: t.kind as TemplateRow["kind"],
    name: t.name as string,
    weekdays: (t.weekdays as number[] | null) ?? null,
    shifts: (t.shifts as string[] | null) ?? null,
    is_active: t.is_active as boolean,
    notes: (t.notes as string | null) ?? null,
    item_count: counts.get(t.id as string) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Master lists
        </h1>
        <p className="max-w-[72ch] text-sm text-muted">
          What a walk at {active.code} asks for. A checklist is walked at the end
          of a shift; a walkthrough is a manager’s round; an inspection log
          records an outside visit. Items are grouped by shop section, so a walk
          follows the same route through the building as the order guide.
        </p>
      </div>

      {/* Keyed for /shop-sections' reason: switching location is a navigation
          to this same route, so without it the search box keeps the term you
          typed against the other shop's lists. */}
      <ChecklistTemplatesList
        key={active.id}
        rows={rows}
        orgId={session.membership.org_id}
        locationId={active.id}
        locationCode={active.code}
        editable={editable}
      />
    </div>
  );
}
