import { createClient } from "@/lib/supabase/server";
import { getAppSession } from "@/lib/session";
import { canEditChecklists } from "@/lib/roles";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";
import { EquipmentList, type EquipmentRow } from "@/components/equipment/EquipmentList";

/**
 * The equipment register — the noun the rest of this module points at.
 *
 * Without it a task says "the fryer" as a string and nothing can be aggregated:
 * no repair history, no per-unit temperature trend, no cost per asset. With it,
 * a reading belongs to THAT walk-in and "this one has crept 36 → 39 over six
 * weeks" is a failing compressor visible before it fails.
 */
export default async function EquipmentPage() {
  const session = await getAppSession();
  const supabase = await createClient();
  const active = session.activeLocation;

  if (!active) {
    return <p className="text-sm text-muted">No location is set up for this org yet.</p>;
  }

  const today = todayInTimeZone(session.orgSettings.timezone ?? serverTimeZone());
  const editable = canEditChecklists(session.membership.role);

  const [{ data: equipment, error }, { data: sections }, { data: vendors }, { data: tasks }] =
    await Promise.all([
      supabase
        .from("equipment")
        .select(
          "id, name, kind, make, model, serial, installed_on, warranty_ends_on, service_vendor_id, shop_section_id, is_active, notes",
        )
        .eq("location_id", active.id)
        .order("name"),
      supabase
        .from("shop_sections")
        .select("id, display_name")
        .eq("location_id", active.id)
        .order("sort_order"),
      supabase.from("vendors").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("location_tasks")
        .select("equipment_id")
        .eq("location_id", active.id)
        .in("status", ["open", "in_progress"])
        .not("equipment_id", "is", null),
    ]);

  if (error) {
    return (
      <p className="max-w-[72ch] text-sm text-accent">
        Could not load the equipment: {error.message}
        {error.message.includes("equipment") &&
          " — migration 075 has not been applied yet."}
      </p>
    );
  }

  const openTasks = new Map<string, number>();
  for (const t of tasks ?? []) {
    const id = t.equipment_id as string;
    openTasks.set(id, (openTasks.get(id) ?? 0) + 1);
  }
  const sectionName = new Map(
    (sections ?? []).map((s) => [s.id as string, s.display_name as string]),
  );

  const rows: EquipmentRow[] = (equipment ?? []).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    kind: (e.kind as string | null) ?? null,
    make: (e.make as string | null) ?? null,
    model: (e.model as string | null) ?? null,
    serial: (e.serial as string | null) ?? null,
    installed_on: (e.installed_on as string | null) ?? null,
    warranty_ends_on: (e.warranty_ends_on as string | null) ?? null,
    service_vendor_id: (e.service_vendor_id as string | null) ?? null,
    shop_section_id: (e.shop_section_id as string | null) ?? null,
    section_name: e.shop_section_id
      ? (sectionName.get(e.shop_section_id as string) ?? null)
      : null,
    is_active: e.is_active as boolean,
    notes: (e.notes as string | null) ?? null,
    open_tasks: openTasks.get(e.id as string) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          Equipment
        </h1>
        <p className="max-w-[72ch] text-sm text-muted">
          What stands at {active.code}. A checklist item can be about one of
          these, which is what turns a reading into a trend and a repair into a
          history. A warranty with no date set simply never lapses.
        </p>
      </div>

      <EquipmentList
        key={active.id}
        rows={rows}
        today={today}
        orgId={session.membership.org_id}
        locationId={active.id}
        locationCode={active.code}
        editable={editable}
        sections={(sections ?? []).map((s) => ({
          id: s.id as string,
          display_name: s.display_name as string,
        }))}
        vendors={(vendors ?? []).map((v) => ({
          id: v.id as string,
          name: v.name as string,
        }))}
      />
    </div>
  );
}
