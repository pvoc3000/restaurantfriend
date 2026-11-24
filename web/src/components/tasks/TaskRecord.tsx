"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLatestWrite } from "@/lib/latestWrite";
import { crumbPath, type Crumb } from "@/lib/breadcrumbs";
import { sectionPickOptions } from "@/lib/locations";
import { SHIFT_SLOT_LABEL, SHIFT_SLOT_OPTIONS } from "@/lib/employeeEvents";
import {
  TASK_KIND_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_LABEL,
  isTaskOpen,
  taskAgeLabel,
  taskTone,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/facilityTasks";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RecordNav } from "@/components/ui/RecordNav";
import { InlineValue } from "@/components/catalog/InlineValue";
import { PickList } from "@/components/ui/PickList";
import { Checkbox } from "@/components/ui/Checkbox";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { EventLog, type EventLogRow } from "@/components/ui/EventLog";
import { BOXED_FIELD, BOXED_FIELDS, READ_ONLY_VALUE } from "@/components/ui/fieldMetrics";
import { ResolveTask } from "./ResolveTask";
import { TaskPhotos, type TaskPhoto } from "./TaskPhotos";
import type { Assignee } from "./TasksScreen";

export type TaskRecordData = {
  id: string;
  orgId: string;
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
  shop_section_id: string | null;
  assigned_to: string | null;
  vendor_id: string | null;
  from_walk: boolean;
  locationCode: string;
  /** "Flagged by Mark on Nov 3, 2026", composed on the server in org time. */
  flagged: string;
};

const STATUS_OPTIONS = (["open", "in_progress", "done", "cancelled"] as const).map((s) => ({
  value: s,
  label: TASK_STATUS_LABEL[s],
}));

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted";

/**
 * A task's record — a maintenance request's, or a crew task's (Mark,
 * 2026-11-23: "I cannot view the maintenance description completely in the
 * list view … I would also like to be able to track and update progress").
 *
 * One scroll, Mark's choice over tabs: the fields, then the history. The
 * history is 226's — the database writes an entry for each status, priority,
 * assignee, due date, description, vendor and kind change, and people add
 * notes, which are permanent.
 *
 * STATUS IS A PICK THAT SOMETIMES OPENS A DIALOG. Open ↔ In Progress writes at
 * once. Done and Canceled go through `ResolveTask`, because a cancellation must
 * carry its reason in the same statement (075's CHECK) and a done note belongs
 * in the same history line as the status (226).
 */
export function TaskRecord({
  task,
  trail,
  today,
  editable,
  equipment,
  sections,
  vendors,
  assignees,
  photos,
  history,
  historyTotal,
}: {
  task: TaskRecordData;
  trail: Crumb[];
  today: string;
  editable: boolean;
  equipment: { id: string; name: string }[];
  sections: { id: string; display_name: string }[];
  vendors: { id: string; name: string }[];
  assignees: Assignee[];
  photos: TaskPhoto[];
  history: EventLogRow[];
  historyTotal: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [resolving, setResolving] = useState<"done" | "cancel" | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);

  // The status shown is LOCAL, so a tap shows at once (lib/latestWrite); the
  // server's value re-seeds it on the refresh, since the record is keyed.
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [carry, setCarry] = useState(task.carry_forward);

  const writeStatus = useLatestWrite<TaskStatus>(
    async (next) => {
      // Reopening clears the RESOLUTION as well as the status, or the row reads
      // open while still claiming somebody settled it on Tuesday — the list's
      // Reopen rule (059's, for a reopened purchase request).
      const patch = isTaskOpen({ status: task.status })
        ? { status: next }
        : { status: next, done_at: null, done_by: null, resolution_note: null };
      const { data, error } = await supabase
        .from("location_tasks")
        .update(patch)
        .eq("id", task.id)
        .select("id");
      if (error) return error.message;
      if (!data?.length) return "That change was not saved.";
      return null;
    },
    (error) => {
      if (error) {
        setFailed(error);
        setStatus(task.status);
      }
      router.refresh();
    },
  );

  const writeCarry = useLatestWrite<boolean>(
    async (next) => {
      const { data, error } = await supabase
        .from("location_tasks")
        .update({ carry_forward: next })
        .eq("id", task.id)
        .select("id");
      if (error) return error.message;
      if (!data?.length) return "That change was not saved.";
      return null;
    },
    (error) => {
      if (error) {
        setFailed(error);
        setCarry(task.carry_forward);
      }
      router.refresh();
    },
  );

  function pickStatus(next: string) {
    const s = next as TaskStatus;
    if (s === status) return;
    setFailed(null);
    if (s === "done") return setResolving("done");
    if (s === "cancelled") return setResolving("cancel");
    setStatus(s);
    writeStatus(s);
  }

  async function moveKind() {
    setFailed(null);
    const next: TaskKind = task.kind === "task" ? "maintenance" : "task";
    const { data, error } = await supabase
      .from("location_tasks")
      .update({ kind: next })
      .eq("id", task.id)
      .select("id");
    if (error || !data?.length) {
      setFailed(error?.message ?? "That change was not saved.");
      return;
    }
    // The record redirects to the other list's route on this refresh.
    router.refresh();
  }

  async function addNote(text: string): Promise<string | null> {
    const uid = (await supabase.auth.getSession()).data.session?.user.id ?? null;
    const { data, error } = await supabase
      .from("location_task_events")
      .insert({
        org_id: task.orgId,
        task_id: task.id,
        message: text,
        // The policy pins this to the signer; the database stamps the name and
        // the time itself (226), so neither is sent.
        author_id: uid,
        source: "manual",
      })
      .select("id");
    if (error) return error.message;
    if (!data?.length) return "Nothing was written — the database refused it and said nothing.";
    router.refresh();
    return null;
  }

  const ageLabel = isTaskOpen({ status }) ? taskAgeLabel(task, today) : null;
  const tone = taskTone(task, today);
  const field = BOXED_FIELDS ? BOXED_FIELD : "";
  const listKey = crumbPath(trail[trail.length - 1]);
  const assigneeName = new Map(assignees.map((a) => [a.user_id, a.name]));
  const shiftLabel = (v: string | null) =>
    v ? (SHIFT_SLOT_LABEL[v as never] ?? v) : "Any shift";

  // Each detail row: label, then the editor or the read-only value.
  const rows: { label: string; edit: React.ReactNode; read: string }[] = [
    {
      label: "Priority",
      read: TASK_PRIORITY_LABEL[task.priority],
      edit: (
        <InlineValue
          table="location_tasks"
          id={task.id}
          column="priority"
          value={task.priority}
          kind="pick"
          nullable={false}
          boxed={BOXED_FIELDS}
          className={`${field} ${task.priority === "high" ? "text-accent" : ""}`}
          ariaLabel="Priority"
          options={TASK_PRIORITY_OPTIONS}
        />
      ),
    },
    {
      label: "About",
      read: equipment.find((e) => e.id === task.equipment_id)?.name ?? "",
      edit: (
        <InlineValue
          table="location_tasks"
          id={task.id}
          column="equipment_id"
          value={task.equipment_id ?? ""}
          kind="pick"
          boxed={BOXED_FIELDS}
          className={field}
          ariaLabel="Equipment"
          options={[
            { value: "", label: "Nothing in particular" },
            ...equipment.map((e) => ({ value: e.id, label: e.name })),
          ]}
        />
      ),
    },
    {
      label: "Where",
      read: sections.find((s) => s.id === task.shop_section_id)?.display_name ?? "",
      edit: (
        <InlineValue
          table="location_tasks"
          id={task.id}
          column="shop_section_id"
          value={task.shop_section_id ?? ""}
          kind="pick"
          boxed={BOXED_FIELDS}
          className={field}
          ariaLabel="Section"
          options={sectionPickOptions(sections)}
        />
      ),
    },
    {
      label: "Shift",
      read: shiftLabel(task.target_shift),
      edit: (
        <InlineValue
          table="location_tasks"
          id={task.id}
          column="target_shift"
          value={task.target_shift ?? ""}
          kind="pick"
          boxed={BOXED_FIELDS}
          className={field}
          ariaLabel="Shift"
          options={[
            { value: "", label: "Any shift" },
            ...SHIFT_SLOT_OPTIONS.map((o) => ({
              value: String(o.value),
              label: SHIFT_SLOT_LABEL[o.value as never] ?? String(o.label),
            })),
          ]}
        />
      ),
    },
    {
      label: "Assigned",
      read: task.assigned_to ? (assigneeName.get(task.assigned_to) ?? "Somebody") : "Anybody",
      edit: (
        <InlineValue
          table="location_tasks"
          id={task.id}
          column="assigned_to"
          value={task.assigned_to ?? ""}
          kind="pick"
          boxed={BOXED_FIELDS}
          className={field}
          ariaLabel="Assigned to"
          options={[
            { value: "", label: "Anybody" },
            ...assignees.map((a) => ({ value: a.user_id, label: a.name })),
          ]}
        />
      ),
    },
    {
      label: "Due",
      read: task.due_on ?? "",
      edit: (
        <InlineValue
          table="location_tasks"
          id={task.id}
          column="due_on"
          value={task.due_on}
          kind="date"
          boxed={BOXED_FIELDS}
          className={field}
          ariaLabel="Due date"
        />
      ),
    },
    {
      label: "Vendor",
      read: vendors.find((v) => v.id === task.vendor_id)?.name ?? "",
      edit: (
        <InlineValue
          table="location_tasks"
          id={task.id}
          column="vendor_id"
          value={task.vendor_id ?? ""}
          kind="pick"
          boxed={BOXED_FIELDS}
          className={field}
          ariaLabel="Vendor"
          options={[
            { value: "", label: "None" },
            ...vendors.map((v) => ({ value: v.id, label: v.name })),
          ]}
        />
      ),
    },
  ];

  return (
    <div className="space-y-12">
      <Breadcrumbs
        trail={trail}
        current={task.title}
        trailing={<RecordNav listKey={listKey} id={task.id} />}
      />

      <div className="space-y-1">
        <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
          {editable ? (
            <InlineValue
              table="location_tasks"
              id={task.id}
              column="title"
              value={task.title}
              nullable={false}
              ariaLabel={task.kind === "maintenance" ? "What needs doing" : "Task"}
              className="uppercase"
            />
          ) : (
            task.title
          )}
        </h1>
        <p className="text-sm text-muted">
          {TASK_KIND_LABEL[task.kind]}
          {task.locationCode && ` · ${task.locationCode}`}
          {` · ${task.flagged}`}
          {task.from_walk && " · raised on a checklist"}
          {ageLabel && (
            <>
              {" · "}
              <span className={tone === "loud" ? "bg-accent px-1 text-white" : "bg-mark-fill px-1 text-ink"}>
                {ageLabel}
              </span>
            </>
          )}
        </p>
      </div>

      <section className="space-y-4">
        <SectionHeading>Details</SectionHeading>
        {failed && <p className="text-sm text-accent">{failed}</p>}

        <dl className="grid max-w-[min(42rem,max(24rem,50%))] grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt className={LABEL}>Status</dt>
          <dd>
            {editable ? (
              <PickList
                ariaLabel="Status"
                variant="field"
                boxed={BOXED_FIELDS}
                className={field}
                value={status}
                options={STATUS_OPTIONS}
                onPick={pickStatus}
              />
            ) : (
              <span className={READ_ONLY_VALUE}>{TASK_STATUS_LABEL[status]}</span>
            )}
          </dd>

          <dt className={`${LABEL} self-start pt-2`}>Description</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="location_tasks"
                id={task.id}
                column="details"
                value={task.details}
                multiline
                boxed={BOXED_FIELDS}
                ariaLabel="Description"
              />
            ) : (
              <p className={`${READ_ONLY_VALUE} whitespace-pre-wrap`}>{task.details ?? ""}</p>
            )}
          </dd>

          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className={LABEL}>{r.label}</dt>
              <dd>{editable ? r.edit : <span className={READ_ONLY_VALUE}>{r.read}</span>}</dd>
            </div>
          ))}

          <dt className={LABEL}>Checklists</dt>
          <dd>
            <Checkbox
              checked={carry}
              disabled={!editable}
              onChange={(next) => {
                setFailed(null);
                setCarry(next);
                writeCarry(next);
              }}
            >
              Put it on every checklist until it is done
            </Checkbox>
          </dd>
        </dl>

        {editable && (
          <div className="flex flex-wrap gap-3">
            <button type="button" className={BUTTON_CLASS} onClick={() => setShowPhotos(true)}>
              {photos.length === 0 ? "Photos…" : `Photos (${photos.length})…`}
            </button>
            {isTaskOpen({ status }) && (
              <button type="button" className={BUTTON_CLASS} onClick={() => void moveKind()}>
                {task.kind === "task" ? "Make it maintenance" : "Make it a task"}
              </button>
            )}
          </div>
        )}
      </section>

      <EventLog
        rows={history}
        total={historyTotal}
        canWrite={editable}
        onAdd={addNote}
        addLabel="Add note"
        inputLabel="Note"
        empty="Nothing has been recorded yet."
      />

      {showPhotos && (
        <TaskPhotos
          task={{ id: task.id, title: task.title }}
          orgId={task.orgId}
          photos={photos}
          onClose={() => setShowPhotos(false)}
        />
      )}

      {resolving && (
        <ResolveTask
          task={{ id: task.id, title: task.title }}
          mode={resolving}
          onClose={() => setResolving(null)}
          onDone={() => {
            setStatus(resolving === "done" ? "done" : "cancelled");
            setResolving(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
