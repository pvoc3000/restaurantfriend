"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { InlineValue, READ_ONLY_VALUE } from "@/components/catalog/InlineValue";
import { TabPicker } from "@/components/ui/TabPicker";
import { TextInput } from "@/components/ui/TextInput";
import { RowMenu } from "@/components/ui/RowMenu";
import { TaskPhotos, type TaskPhoto } from "./TaskPhotos";
import { SHIFT_SLOT_LABEL, SHIFT_SLOT_OPTIONS } from "@/lib/employeeEvents";
import {
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  isTaskOpen,
  staleTaskBanner,
  taskAgeLabel,
  taskTone,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/facilityTasks";
import { NewTask } from "./NewTask";
import { ResolveTask } from "./ResolveTask";

export type TaskRow = {
  id: string;
  kind: TaskKind;
  title: string;
  details: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  target_shift: string | null;
  due_on: string | null;
  carry_forward: boolean;
  created_at: string;
  equipment_id: string | null;
  equipment_name: string | null;
  shop_section_id: string | null;
  section_name: string | null;
  from_walk: boolean;
  photos: TaskPhoto[];
};

/**
 * Tasks and maintenance requests — ONE table, two screens, told apart by `kind`.
 *
 * That is 035's own precedent in Mark's words ("what's one more type") and
 * 051's `kind` column. Promotion between them is an UPDATE, which is the point:
 * "waiting on a plumber" is not a supervisor's task and should leave the nightly
 * list without losing its history.
 */
export function TasksScreen({
  rows,
  kind,
  today,
  orgId,
  locationId,
  locationCode,
  editable,
  equipment,
  sections,
  openRowKey,
}: {
  rows: TaskRow[];
  kind: TaskKind;
  today: string;
  orgId: string;
  locationId: string;
  locationCode: string;
  editable: boolean;
  equipment: { id: string; name: string }[];
  sections: { id: string; display_name: string }[];
  openRowKey?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState<"open" | "done" | "all">("open");
  const [failed, setFailed] = useState<string | null>(null);
  const [resolving, setResolving] = useState<TaskRow | null>(null);
  // THE ID, NOT THE ROW. `router.refresh()` re-renders the server component and
  // hands down fresh `rows`, but a captured row object is a snapshot taken when
  // the dialog opened — so a photo you had just added did not appear until you
  // closed and reopened it, which reads as the upload having failed. Looking
  // the row up each render is what makes the panel live.
  const [photosForId, setPhotosForId] = useState<string | null>(null);
  const photosFor = photosForId ? (rows.find((r) => r.id === photosForId) ?? null) : null;
  const [, startTransition] = useTransition();

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.details ?? "").toLowerCase().includes(q) ||
        (r.equipment_name ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const shown = useMemo(() => {
    if (tier === "all") return searched;
    if (tier === "done") return searched.filter((r) => !isTaskOpen(r));
    return searched.filter((r) => isTaskOpen(r));
  }, [searched, tier]);

  const banner = staleTaskBanner(rows, today);

  async function markDone(row: TaskRow) {
    setFailed(null);
    startTransition(async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { data, error } = await supabase
        .from("location_tasks")
        .update({ status: "done", done_at: new Date().toISOString(), done_by: uid })
        .eq("id", row.id)
        .select("id");
      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? "That change was not saved.");
        return;
      }
      router.refresh();
    });
  }

  async function reopen(row: TaskRow) {
    setFailed(null);
    startTransition(async () => {
      // Reopening clears the RESOLUTION as well as the status, or the row reads
      // open while still claiming somebody settled it on Tuesday — 059's rule
      // for a reopened purchase request, and the same failure.
      const { data, error } = await supabase
        .from("location_tasks")
        .update({ status: "open", done_at: null, done_by: null, resolution_note: null })
        .eq("id", row.id)
        .select("id");
      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? "That change was not saved.");
        return;
      }
      router.refresh();
    });
  }

  async function setKind(row: TaskRow, next: TaskKind) {
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("location_tasks")
        .update({ kind: next })
        .eq("id", row.id)
        .select("id");
      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? "That change was not saved.");
        return;
      }
      router.refresh();
    });
  }

  const columns: DataColumn<TaskRow>[] = [
    {
      key: "title",
      label: kind === "maintenance" ? "What needs doing" : "Task",
      width: 380,
      pinned: true,
      sortValue: (r) => r.title,
      render: (r) => (
        <span className="block">
          {editable ? (
            <InlineValue
              table="location_tasks"
              id={r.id}
              column="title"
              value={r.title}
              nullable={false}
              ariaLabel="Task"
            />
          ) : (
            <span className={READ_ONLY_VALUE}>{r.title}</span>
          )}
          {r.details && (
            <span className="block text-[13px] text-muted">{r.details}</span>
          )}
          {r.from_walk && (
            <span className="block text-[12px] text-muted">raised on a walk</span>
          )}
        </span>
      ),
    },
    {
      key: "priority",
      label: "Priority",
      width: 130,
      sortValue: (r) => ({ high: 0, normal: 1, low: 2 })[r.priority],
      // HIGH IS RED, not the mark colour — a high-priority job is the same class
      // of thing as a flagged special order: not an error, a thing that cannot
      // wait. And `text-mark` on white is 1.43:1, which is text you cannot read.
      render: (r) =>
        editable ? (
          <InlineValue
            table="location_tasks"
            id={r.id}
            column="priority"
            value={r.priority}
            kind="pick"
            nullable={false}
            ariaLabel={`Priority for ${r.title}`}
            options={(["high", "normal", "low"] as const).map((p) => ({
              value: p,
              label: TASK_PRIORITY_LABEL[p],
            }))}
            className={r.priority === "high" ? "text-accent" : ""}
          />
        ) : (
          <span className={r.priority === "high" ? "text-accent" : READ_ONLY_VALUE}>
            {TASK_PRIORITY_LABEL[r.priority]}
          </span>
        ),
    },
    {
      key: "age",
      label: "Age",
      width: 150,
      sortValue: (r) => r.created_at,
      render: (r) => {
        const label = taskAgeLabel(r, today);
        if (!isTaskOpen(r)) return <span className="text-muted">—</span>;
        if (!label) return <span className="text-muted">{r.created_at.slice(0, 10)}</span>;
        const tone = taskTone(r, today);
        return (
          <span
            className={
              tone === "loud" ? "bg-accent px-1 text-white" : "bg-mark-fill px-1"
            }
          >
            {label}
          </span>
        );
      },
    },
    {
      key: "equipment",
      label: "About",
      width: 200,
      hideWhenCompact: true,
      sortValue: (r) => r.equipment_name ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="location_tasks"
            id={r.id}
            column="equipment_id"
            value={r.equipment_id ?? ""}
            kind="pick"
            ariaLabel={`Equipment for ${r.title}`}
            options={[
              { value: "", label: "Nothing in particular" },
              ...equipment.map((e) => ({ value: e.id, label: e.name })),
            ]}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.equipment_name ?? ""}</span>
        ),
    },
    {
      key: "section",
      label: "Where",
      width: 190,
      hideWhenCompact: true,
      sortValue: (r) => r.section_name ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="location_tasks"
            id={r.id}
            column="shop_section_id"
            value={r.shop_section_id ?? ""}
            kind="pick"
            ariaLabel={`Section for ${r.title}`}
            options={[
              { value: "", label: "No section" },
              ...sections.map((s) => ({ value: s.id, label: s.display_name })),
            ]}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.section_name ?? ""}</span>
        ),
    },
    {
      key: "target_shift",
      label: "Shift",
      width: 140,
      hideWhenCompact: true,
      sortValue: (r) => r.target_shift ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="location_tasks"
            id={r.id}
            column="target_shift"
            value={r.target_shift ?? ""}
            kind="pick"
            ariaLabel={`Shift for ${r.title}`}
            options={[
              { value: "", label: "Any shift" },
              ...SHIFT_SLOT_OPTIONS.map((o) => ({
                value: String(o.value),
                label: SHIFT_SLOT_LABEL[o.value as never] ?? String(o.label),
              })),
            ]}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>
            {r.target_shift
              ? (SHIFT_SLOT_LABEL[r.target_shift as never] ?? r.target_shift)
              : "Any shift"}
          </span>
        ),
    },
    {
      key: "due_on",
      label: "Due",
      width: 150,
      sortValue: (r) => r.due_on ?? "",
      render: (r) =>
        editable ? (
          <InlineValue
            table="location_tasks"
            id={r.id}
            column="due_on"
            value={r.due_on}
            kind="date"
            ariaLabel={`Due date for ${r.title}`}
          />
        ) : (
          <span className={READ_ONLY_VALUE}>{r.due_on ?? ""}</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      width: 130,
      sortValue: (r) => r.status,
      render: (r) => (
        <span className={isTaskOpen(r) ? "" : "text-muted"}>
          {TASK_STATUS_LABEL[r.status]}
        </span>
      ),
    },
    {
      key: "menu",
      label: "",
      width: 50,
      render: (r) =>
        editable ? (
          <RowMenu
            label={`Commands for ${r.title}`}
            items={[
              {
                // OFFERED WHETHER OR NOT IT IS OPEN. A photo of what was fixed
                // is worth as much as one of what was broken, and a finished
                // task is the record somebody will read next year.
                label: r.photos.length === 0 ? "Photos…" : `Photos (${r.photos.length})…`,
                onSelect: () => setPhotosForId(r.id),
              },
              ...(isTaskOpen(r)
                ? [
                    { label: "Mark done", onSelect: () => void markDone(r) },
                    {
                      label: kind === "task" ? "Make it maintenance" : "Make it a task",
                      hint:
                        kind === "task"
                          ? "a vendor's job, off the nightly list"
                          : "back to the crew's list",
                      onSelect: () =>
                        void setKind(r, kind === "task" ? "maintenance" : "task"),
                    },
                    {
                      label: "Cancel…",
                      hint: "needs a reason",
                      danger: true,
                      onSelect: () => setResolving(r),
                    },
                  ]
                : [{ label: "Reopen", onSelect: () => void reopen(r) }]),
            ]}
          />
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      {banner && (
        // THE ESCALATION. This is the half of the carry-forward that stops it
        // becoming wallpaper: after a week something has to surface where a
        // MANAGER reads, not only in front of whoever is closing tonight.
        <p className="border-2 border-accent p-3 text-sm">{banner}</p>
      )}

      {failed && <p className="text-sm text-accent">{failed}</p>}

      {editable && (
        <div className="flex justify-end">
          <NewTask
            kind={kind}
            orgId={orgId}
            locationId={locationId}
            equipment={equipment}
            sections={sections}
          />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[16rem] flex-1">
          <TextInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search…"
            aria-label="Search"
            clearLabel="Clear the search"
          />
        </div>
        <TabPicker
          ariaLabel="Which"
          value={tier}
          options={[
            {
              key: "open",
              label: "Open",
              count: searched.filter((r) => isTaskOpen(r)).length,
            },
            {
              key: "done",
              label: "Finished",
              count: searched.filter((r) => !isTaskOpen(r)).length,
            },
            { key: "all", label: "All", count: searched.length },
          ]}
          onChange={(v) => setTier(v as typeof tier)}
        />
      </div>

      <DataTable
        rows={shown}
        columns={columns}
        rowKey={(r) => r.id}
        compactBelow={1280}
        storageKey={`rf.${kind === "maintenance" ? "maintenance" : "tasks"}.columnWidths.v1`}
        columnChooser
        openRowKey={openRowKey}
        defaultSort={{ key: "age" }}
        empty={
          <p className="max-w-[72ch] text-sm text-muted">
            {kind === "maintenance"
              ? `Nothing needs a vendor at ${locationCode}.`
              : `Nothing outstanding at ${locationCode}. Flag something on a walk and it lands here.`}
          </p>
        }
      />

      {photosFor && (
        <TaskPhotos
          task={photosFor}
          orgId={orgId}
          photos={photosFor.photos}
          onClose={() => setPhotosForId(null)}
        />
      )}

      {resolving && (
        <ResolveTask
          task={resolving}
          onClose={() => setResolving(null)}
          onDone={() => {
            setResolving(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
