"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { FORM_TEXTAREA } from "@/components/ui/fieldMetrics";
import { PickList } from "@/components/ui/PickList";
import { TextInput } from "@/components/ui/TextInput";
import {
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_LABEL,
  taskAge,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/facilityTasks";
import { sectionPickOptions } from "@/lib/locations";
import {
  LIKELY_MATCH,
  rankOpenRequests,
  raisedPriority,
  withAlsoReported,
  type OpenRequest,
  type RequestDraft,
} from "@/lib/maintenanceMatch";
import { createClient } from "@/lib/supabase/client";
import { dateInTimeZone } from "@/lib/today";

import type { RequestContext } from "./RequestTile";
import { TILE_CLASS } from "./tileClass";

type Open = OpenRequest & {
  status: TaskStatus;
  priority: TaskPriority;
  created_at: string;
  reporter: string | null;
  section_name: string | null;
};

type Loaded = {
  open: Open[];
  equipment: { id: string; name: string; shop_section_id: string | null }[];
  sections: { id: string; display_name: string }[];
  /** Everybody's name by user id, for "Karina, 3 days ago" and for the
   *  "Also reported by" line this person signs. */
  names: Map<string, string>;
};

/**
 * The landing page's "Submit a Maintenance Request" (Mark, 2026-11-02) — a
 * COMMAND tile like Submit a Purchase Request, filing into
 * `/maintenance-requests` (`location_tasks`, kind `maintenance`) for the
 * working shop.
 *
 * ITS JOB IS AS MUCH NOT FILING AS FILING. Everything already open at the shop
 * is listed under the form and re-ranked as the person types or picks the
 * equipment (`lib/maintenanceMatch`), and each carries **Same Problem**, which
 * adds their words to THAT request — signed and dated, raising its priority if
 * they called it high — instead of making a second one. When something ranks
 * as a likely match, the commit button stops saying Submit and says **Submit
 * as New**, so filing a duplicate is a choice made with it on screen.
 *
 * FETCHED ON THE TAP, AND AGAIN ON SUBMIT. On the tap because one tile in a
 * dozen wants it (`ScanEmployeeTile`'s reasoning), and again just before the
 * insert, because the other shift may have filed the same thing while this
 * person was typing: a NEW likely match stops the submit and is put in front
 * of them. Two inserts in the same second can still both land — this is a
 * courtesy, not a lock.
 *
 * The desk's New maintenance request (`tasks/NewTask`) is untouched: it asks
 * the manager's questions (assignee, due date, shift, carry-forward), and this
 * asks the floor's — what, which machine, where, how bad.
 */
export function MaintenanceRequestTile({
  label,
  note,
  orgId,
  locationId,
  userId,
  locationCode,
}: RequestContext & { label: string; note: string | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  // What the tile says it just did, in place of its own line, until the next
  // tap — the purchase request tile's count can't confirm a Same Problem,
  // because adding to a request does not change how many are open.
  const [done, setDone] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [equipmentId, setEquipmentId] = useState("");
  const [sectionId, setSectionId] = useState("");
  // `NewTask`'s rule: picking a machine fills in where it stands, but never
  // over a shelf somebody chose.
  const [sectionWasFilled, setSectionWasFilled] = useState(false);
  // The request "Same Problem" was pressed on — the dialog's second page.
  const [joining, setJoining] = useState<Open | null>(null);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dateInTimeZone(new Date().toISOString(), timeZone);

  async function load(): Promise<Loaded | null> {
    const [requests, equipment, sections, members] = await Promise.all([
      supabase
        .from("location_tasks")
        .select(
          "id, title, details, status, priority, created_at, created_by, equipment_id, shop_section_id",
        )
        .eq("location_id", locationId)
        .eq("kind", "maintenance")
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false }),
      supabase
        .from("equipment")
        .select("id, name, shop_section_id")
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("shop_sections")
        .select("id, display_name")
        .eq("location_id", locationId)
        .order("sort_order"),
      supabase.from("org_members").select("user_id, display_name"),
    ]);
    const error = requests.error ?? equipment.error ?? sections.error ?? members.error;
    if (error) {
      setFailed(`Could not load what is already reported: ${error.message}`);
      return null;
    }
    const names = new Map(
      (members.data ?? []).map((m) => [
        m.user_id as string,
        (m.display_name as string | null)?.trim() || "Someone",
      ]),
    );
    const equipmentName = new Map((equipment.data ?? []).map((e) => [e.id as string, e.name as string]));
    const sectionName = new Map(
      (sections.data ?? []).map((s) => [s.id as string, s.display_name as string]),
    );
    return {
      names,
      equipment: (equipment.data ?? []).map((e) => ({
        id: e.id as string,
        name: e.name as string,
        shop_section_id: (e.shop_section_id as string | null) ?? null,
      })),
      sections: (sections.data ?? []).map((s) => ({
        id: s.id as string,
        display_name: s.display_name as string,
      })),
      open: (requests.data ?? []).map((r) => ({
        id: r.id as string,
        title: r.title as string,
        details: (r.details as string | null) ?? null,
        status: r.status as TaskStatus,
        priority: r.priority as TaskPriority,
        created_at: r.created_at as string,
        reporter: r.created_by ? (names.get(r.created_by as string) ?? null) : null,
        equipment_id: (r.equipment_id as string | null) ?? null,
        equipment_name: r.equipment_id ? (equipmentName.get(r.equipment_id as string) ?? null) : null,
        shop_section_id: (r.shop_section_id as string | null) ?? null,
        section_name: r.shop_section_id ? (sectionName.get(r.shop_section_id as string) ?? null) : null,
      })),
    };
  }

  function start() {
    setDone(null);
    setFailed(null);
    setNotice(null);
    setTitle("");
    setDetails("");
    setPriority("normal");
    setEquipmentId("");
    setSectionId("");
    setSectionWasFilled(false);
    setJoining(null);
    setLoaded(null);
    setOpen(true);
    void load().then((l) => l && setLoaded(l));
  }

  function close() {
    if (busy) return;
    setOpen(false);
  }

  const draft: RequestDraft = {
    title,
    details,
    equipment_id: equipmentId,
    equipment_name: loaded?.equipment.find((e) => e.id === equipmentId)?.name ?? null,
    shop_section_id: sectionId,
  };
  const ranked = loaded ? rankOpenRequests(draft, loaded.open) : [];
  const likely = ranked.some((r) => r.score >= LIKELY_MATCH);
  const canSubmit = title.trim().length > 0 && loaded !== null && !busy;

  function submit() {
    if (!canSubmit || !loaded) return;
    setFailed(null);
    setNotice(null);
    startTransition(async () => {
      // Again, right before the insert: has anybody filed this since the
      // dialog opened?
      const fresh = await load();
      if (!fresh) return;
      const seen = new Set(loaded.open.map((r) => r.id));
      const arrived = rankOpenRequests(draft, fresh.open).find(
        (r) => r.score >= LIKELY_MATCH && !seen.has(r.request.id),
      );
      setLoaded(fresh);
      if (arrived) {
        const who = arrived.request.reporter ?? "Someone";
        setNotice(`${who} just reported “${arrived.request.title}”. Is it the same problem?`);
        return;
      }

      const { data, error } = await supabase
        .from("location_tasks")
        .insert({
          org_id: orgId,
          location_id: locationId,
          kind: "maintenance",
          title: title.trim(),
          details: details.trim() || null,
          priority,
          equipment_id: equipmentId || null,
          shop_section_id: sectionId || null,
          created_by: userId,
        })
        .select("id");
      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? "The request was not submitted.");
        return;
      }
      router.refresh();
      setDone(`Submitted: ${title.trim()}`);
      setOpen(false);
    });
  }

  function addReport() {
    if (!joining || busy) return;
    setFailed(null);
    startTransition(async () => {
      // Read the details NOW, not as loaded: somebody else's "Also reported"
      // added while this dialog sat open must not be written over.
      const { data: row, error: readError } = await supabase
        .from("location_tasks")
        .select("details, priority, status")
        .eq("id", joining.id)
        .maybeSingle();
      if (readError || !row) {
        setFailed(readError?.message ?? "That request could not be found.");
        return;
      }
      if (row.status !== "open" && row.status !== "in_progress") {
        setFailed("That request has just been closed. Go back and submit a new one.");
        return;
      }
      const { data, error } = await supabase
        .from("location_tasks")
        .update({
          details: withAlsoReported((row.details as string | null) ?? null, {
            name: loaded?.names.get(userId) ?? "Someone",
            date: shortDate(today),
            note: details.trim() || (title.trim() !== joining.title ? title.trim() : ""),
          }),
          priority: raisedPriority(row.priority as TaskPriority, priority),
        })
        .eq("id", joining.id)
        .select("id");
      if (error || !data || data.length === 0) {
        setFailed(error?.message ?? "Your report was not added.");
        return;
      }
      router.refresh();
      setDone(`Added to: ${joining.title}`);
      setOpen(false);
    });
  }

  function pickEquipment(next: string) {
    setEquipmentId(next);
    const where = loaded?.equipment.find((e) => e.id === next)?.shop_section_id;
    if (where && (sectionId === "" || sectionWasFilled)) {
      setSectionId(where);
      setSectionWasFilled(true);
    }
  }

  const line = done ?? note;

  return (
    <>
      <button type="button" onClick={start} className={TILE_CLASS}>
        <span className="font-bold uppercase tracking-[0.04em] text-ink">{label}</span>
        {line && <span className="text-[14px] text-muted">{line}</span>}
      </button>

      {open && (
        <Dialog
          title={joining ? "Same Problem" : "New Maintenance Request"}
          onClose={close}
          busy={busy}
          width="max-w-2xl"
          onSubmit={joining ? addReport : canSubmit ? submit : undefined}
          footer={
            <>
              <button
                type="button"
                onClick={joining ? () => setJoining(null) : close}
                disabled={busy}
                className={DIALOG_CANCEL_CLASS}
              >
                {joining ? "Back" : "Cancel"}
              </button>
              {joining ? (
                <button type="button" onClick={addReport} disabled={busy} className={DIALOG_COMMIT_CLASS}>
                  {busy ? "Adding…" : "Add My Report"}
                </button>
              ) : (
                <button type="button" onClick={submit} disabled={!canSubmit} className={DIALOG_COMMIT_CLASS}>
                  {busy ? "Submitting…" : likely ? "Submit as New" : "Submit"}
                </button>
              )}
            </>
          }
        >
          {joining ? (
            <div className="space-y-5 text-[16px]">
              <RequestCard request={joining} today={today} />
              <Field label="What you saw">
                <textarea
                  value={details}
                  rows={3}
                  autoFocus
                  disabled={busy}
                  onChange={(e) => setDetails(e.target.value)}
                  aria-label="What you saw"
                  className={FORM_TEXTAREA}
                />
              </Field>
              <Field label="How urgent">
                <PickList
                  variant="field"
                  value={priority}
                  ariaLabel="How urgent"
                  options={TASK_PRIORITY_OPTIONS}
                  onPick={(v) => setPriority((v || "normal") as TaskPriority)}
                  className="w-40"
                  disabled={busy}
                />
              </Field>
              {failed && <p className="text-sm text-accent">{failed}</p>}
            </div>
          ) : (
            <div className="space-y-5 text-[16px]">
              <p className="text-sm text-muted">For {locationCode}.</p>

              <Field label="What’s wrong">
                <TextInput
                  value={title}
                  onValueChange={setTitle}
                  fullWidth
                  autoFocus
                  disabled={busy}
                  aria-label="What’s wrong"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Equipment">
                  <PickList
                    variant="field"
                    value={equipmentId}
                    ariaLabel="Equipment"
                    options={[
                      { value: "", label: "Nothing in particular" },
                      ...(loaded?.equipment ?? []).map((e) => ({ value: e.id, label: e.name })),
                    ]}
                    onPick={pickEquipment}
                    disabled={busy || !loaded}
                  />
                </Field>
                <Field label="Where">
                  <PickList
                    variant="field"
                    value={sectionId}
                    ariaLabel="Where"
                    options={sectionPickOptions(loaded?.sections ?? [])}
                    onPick={(next) => {
                      setSectionId(next);
                      setSectionWasFilled(false);
                    }}
                    disabled={busy || !loaded}
                  />
                </Field>
              </div>

              <Field label="Details">
                <textarea
                  value={details}
                  rows={2}
                  disabled={busy}
                  onChange={(e) => setDetails(e.target.value)}
                  aria-label="Details"
                  className={FORM_TEXTAREA}
                />
              </Field>

              <Field label="How urgent">
                <PickList
                  variant="field"
                  value={priority}
                  ariaLabel="How urgent"
                  options={TASK_PRIORITY_OPTIONS}
                  onPick={(v) => setPriority((v || "normal") as TaskPriority)}
                  className="w-40"
                  disabled={busy}
                />
              </Field>

              {notice && <p className="text-sm font-semibold text-ink">{notice}</p>}
              {failed && <p className="text-sm text-accent">{failed}</p>}

              {loaded === null && !failed ? (
                <p className="text-sm text-muted">Checking what is already reported…</p>
              ) : ranked.length > 0 ? (
                <section className="space-y-2">
                  <h3 className="text-[11px] uppercase tracking-[0.12em] text-subtle">
                    Already reported at {locationCode}
                  </h3>
                  <ul className="space-y-2">
                    {ranked.map(({ request, score }) => (
                      <li
                        key={request.id}
                        className={`flex items-start gap-3 border p-3 ${
                          score >= LIKELY_MATCH ? "border-2 border-ink" : "border-hairline"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <RequestCard request={request} today={today} likely={score >= LIKELY_MATCH} bare />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setFailed(null);
                            setNotice(null);
                            setJoining(request);
                          }}
                          disabled={busy}
                          className={`${BUTTON_CLASS} min-h-11 shrink-0`}
                        >
                          Same Problem
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : loaded ? (
                <p className="text-sm text-muted">Nothing else is open at {locationCode}.</p>
              ) : null}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

/** One open request: what, which machine and where, who said so and when. */
function RequestCard({
  request,
  today,
  likely = false,
  bare = false,
}: {
  request: Open;
  today: string;
  likely?: boolean;
  /** Inside a list row that draws its own border. */
  bare?: boolean;
}) {
  // Filed at 8pm here is tomorrow in UTC, so the day is the shop's, not the
  // timestamp's.
  const filedOn = dateInTimeZone(request.created_at, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const days = taskAge({ created_at: filedOn }, today);
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  const place = [request.equipment_name, request.section_name].filter(Boolean).join(" · ");
  return (
    <div className={bare ? "space-y-1" : "space-y-1 border border-ink p-3"}>
      <p className="font-bold text-ink">
        {request.title}
        {likely && (
          <span className="ml-2 bg-mark px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink">
            Likely the same
          </span>
        )}
      </p>
      <p className="text-[14px] text-muted">
        {[place, `${request.reporter ?? "Someone"}, ${when}`, TASK_STATUS_LABEL[request.status]]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {request.details && (
        <p className="line-clamp-3 whitespace-pre-line text-[14px] text-ink">{request.details}</p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">{label}</span>
      {children}
    </div>
  );
}

/** "Nov 2" — what a manager reads in the request's details. */
function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
