"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  readingLabel,
  statusForReading,
  type CheckStatus,
  type ResponseType,
} from "@/lib/checklists";
import {
  PHOTO_ACCEPT_ATTR,
  PHOTO_BUCKET,
  photoPath,
  photoRejection,
} from "@/lib/facilityPhotos";
import { RaiseTaskFromIssue } from "./RaiseTaskFromIssue";

export type WalkItemRow = {
  id: string;
  prompt: string;
  section_name: string | null;
  response_type: ResponseType;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  choices: string[] | null;
  requires_photo: boolean;
  equipment_id: string | null;
  equipment_name: string | null;
  /** 078: how you know it is done, and whose job it is. Both optional. */
  guidance: string | null;
  position: string | null;
  status: CheckStatus;
  value_number: number | null;
  value_text: string | null;
  score: number | null;
  note: string | null;
  task_id: string | null;
  photos: { id: string; url: string | null }[];
  /** Only a walkthrough asks for one, so only a walkthrough shows the control. */
  scored: boolean;
};

/** 44px, which is the floor for a touch target, and 16px type — below which
 *  iOS Safari zooms the whole page on focus. */
const TAP =
  "min-h-11 border px-3 text-[13px] font-semibold uppercase tracking-[0.06em] transition-colors";

const STATE_BUTTONS: { status: CheckStatus; label: string }[] = [
  { status: "done", label: "Done" },
  { status: "issue", label: "Issue" },
  { status: "na", label: "N/A" },
];

/**
 * One question on the walk.
 *
 * FOUR STATES, and they are the order guide's three-state lesson widened by
 * one: pending / done / issue / n/a. "Nobody has been there yet" and "looked
 * at, fine" are different sentences and a checklist that merges them is one you
 * cannot audit.
 *
 * Pressing the state you are already in returns the item to PENDING, which is
 * how a mis-tap is undone — there is no other way back, and a walk you cannot
 * correct is one people stop trusting.
 */
export function WalkItem({
  row,
  orgId,
  locationId,
  runId,
  writable,
  onError,
}: {
  row: WalkItemRow;
  orgId: string;
  locationId: string;
  runId: string;
  writable: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState(row.note ?? "");
  const [value, setValue] = useState(
    row.value_number == null ? "" : String(row.value_number),
  );
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const outOfRange = readingLabel(row, row.value_number);

  async function write(patch: Record<string, unknown>) {
    onError(null);
    const { data, error } = await supabase
      .from("checklist_run_items")
      .update({
        ...patch,
        checked_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        checked_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      // A write that matches no policy changes 0 rows and returns NO error, so
      // the row count is the only honest success test — and here it is what
      // stops a submitted run silently swallowing a tap.
      .select("id");
    if (error || !data || data.length === 0) {
      onError(error?.message ?? "That answer was not saved.");
      return false;
    }
    router.refresh();
    return true;
  }

  function setStatus(next: CheckStatus) {
    // Pressing the current state returns to pending — the undo.
    const target: CheckStatus = row.status === next ? "pending" : next;
    // 076 refuses an issue or an n/a with no note, so the note has to travel in
    // the SAME statement. Bouncing a raw 23514 back at somebody standing in a
    // walk-in is the one refusal an inline control cannot explain.
    if ((target === "issue" || target === "na") && !note.trim()) {
      onError("Say what is wrong before flagging it — an issue needs a note.");
      return;
    }
    startTransition(async () => {
      await write({
        status: target,
        note: target === "pending" ? null : note.trim() || null,
      });
    });
  }

  function commitValue() {
    const raw = value.trim();
    const parsed = raw === "" ? null : Number(raw);
    if (raw !== "" && !Number.isFinite(parsed)) {
      onError(`“${raw}” is not a number.`);
      return;
    }
    // THE ONE PLACE THE APP DECIDES ANYTHING: a reading outside the item's
    // expected range raises the issue by itself, so nobody has to remember that
    // 41°F is bad. An issue needs a note, so a bare out-of-range reading writes
    // one naming the value — the constraint is satisfied by a true sentence
    // rather than by an empty string.
    const implied = statusForReading(row, parsed);
    const autoNote =
      implied === "issue" && !note.trim()
        ? `Reading ${parsed}${row.unit ? ` ${row.unit}` : ""} — ${readingLabel(row, parsed) ?? "out of range"}`
        : note.trim() || null;
    startTransition(async () => {
      await write({
        value_number: parsed,
        status: implied,
        note: implied === "pending" ? null : autoNote,
      });
    });
  }

  async function addPhoto(file: File) {
    const refusal = photoRejection(file);
    if (refusal) return onError(refusal);
    setBusy(true);
    onError(null);
    try {
      // UPLOAD = STORAGE THEN ROW. A row pointing at nothing renders broken,
      // where an orphaned object is invisible and harmless. Delete goes the
      // other way round, for the same reason read backwards.
      const path = photoPath(orgId, runId, file.name);
      const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file);
      if (up.error) return onError(up.error.message);

      const { data, error } = await supabase
        .from("facility_photos")
        .insert({
          org_id: orgId,
          run_item_id: row.id,
          storage_path: path,
          file_name: file.name,
          content_type: file.type,
          byte_size: file.size,
        })
        .select("id");
      if (error || !data || data.length === 0) {
        onError(error?.message ?? "The photo was uploaded but not filed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const needsNote = row.status === "issue" || row.status === "na";

  return (
    <li className="space-y-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[16px] leading-snug">{row.prompt}</p>
          {/* 078's two columns, in the paper's own order: WHO, then HOW you
              know it is done. Both quiet — the instruction is what you read,
              and these are what you read when the instruction is not enough. */}
          {(row.position || row.equipment_name) && (
            <p className="text-[13px] text-muted">
              {[row.position, row.equipment_name].filter(Boolean).join(" · ")}
            </p>
          )}
          {row.guidance && (
            <p className="text-[13px] text-muted">{row.guidance}</p>
          )}
          {row.requires_photo && row.photos.length === 0 && (
            <span className="mt-1 inline-block bg-mark-fill px-1 text-[12px]">
              wants a photo
            </span>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {STATE_BUTTONS.map((b) => {
            const on = row.status === b.status;
            const danger = b.status === "issue";
            return (
              <button
                key={b.status}
                type="button"
                disabled={!writable}
                aria-pressed={on}
                onClick={() => setStatus(b.status)}
                className={`${TAP} ${
                  on
                    ? danger
                      ? "border-accent bg-accent text-white"
                      : "border-ink bg-ink text-white"
                    : "border-ink bg-white text-ink hover:bg-ink hover:text-white"
                } disabled:opacity-35`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {row.response_type === "number" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            // `inputMode="decimal"` and 16px type: below 16 iOS Safari zooms the
            // whole page on focus, which on a walk means losing your place.
            inputMode="decimal"
            value={value}
            disabled={!writable}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commitValue}
            aria-label={`${row.prompt} reading`}
            className="h-11 w-28 border border-hairline px-2 text-[16px] tabular-nums focus:border-ink focus:outline-none disabled:opacity-50"
          />
          {row.unit && <span className="text-[14px] text-muted">{row.unit}</span>}
          {/* ONE MARK PER FACT. The quiet hint and the red chip say the same
              thing, so only one of them shows: the expected range is guidance
              while the reading is fine, and a warning once it is not. Both at
              once read as two different complaints about one number. */}
          {outOfRange ? (
            <span className="bg-accent px-1 text-[13px] text-white">{outOfRange}</span>
          ) : (
            (row.min_value != null || row.max_value != null) && (
              <span className="text-[13px] text-muted">
                expected {row.min_value ?? ""}–{row.max_value ?? ""}
                {row.unit ? ` ${row.unit}` : ""}
              </span>
            )
          )}
        </div>
      )}

      {row.response_type === "text" && (
        <input
          value={row.value_text ?? ""}
          disabled={!writable}
          onChange={(e) => {
            const v = e.target.value;
            startTransition(async () => {
              await write({ value_text: v || null });
            });
          }}
          aria-label={`${row.prompt} answer`}
          className="h-11 w-full border border-hairline px-2 text-[16px] focus:border-ink focus:outline-none disabled:opacity-50"
        />
      )}

      {row.scored && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">Score</span>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              disabled={!writable}
              aria-pressed={row.score === n}
              onClick={() =>
                startTransition(async () => {
                  // Pressing the score it already has clears it — "not scored"
                  // is the resting state and has to be reachable, or 89% of
                  // everything becomes a 5 by accident.
                  await write({ score: row.score === n ? null : n });
                })
              }
              className={`${TAP} w-11 justify-center ${
                row.score === n
                  ? "border-ink bg-ink text-white"
                  : "border-hairline bg-white text-ink hover:border-ink"
              } disabled:opacity-35`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {(needsNote || note) && (
        <textarea
          value={note}
          disabled={!writable}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if ((note.trim() || null) === (row.note ?? null)) return;
            if (needsNote && !note.trim()) {
              onError("An issue needs a note saying what is wrong.");
              setNote(row.note ?? "");
              return;
            }
            startTransition(async () => {
              await write({ note: note.trim() || null });
            });
          }}
          rows={2}
          placeholder="What is wrong?"
          aria-label={`Note for ${row.prompt}`}
          className="w-full border border-hairline p-2 text-[16px] focus:border-ink focus:outline-none disabled:opacity-50"
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        {row.photos.map((p) =>
          p.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.id}
              src={p.url}
              alt=""
              className="h-16 w-16 border border-hairline object-cover"
            />
          ) : null,
        )}
        {writable && (
          <>
            <input
              ref={fileInput}
              type="file"
              // NO `capture` attribute, deliberately: without it iOS offers
              // Photo Library / Take Photo / Choose File in one sheet, and the
              // named formats are what ask it to transcode HEIC on the way out.
              accept={PHOTO_ACCEPT_ATTR}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void addPhoto(f);
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className={`${TAP} border-ink bg-white text-ink hover:bg-ink hover:text-white disabled:opacity-35`}
            >
              {busy ? "Adding…" : "Photo"}
            </button>
          </>
        )}
        {row.status === "issue" && writable && (
          <RaiseTaskFromIssue
            runItemId={row.id}
            orgId={orgId}
            locationId={locationId}
            prompt={row.prompt}
            note={row.note}
            taskId={row.task_id}
          />
        )}
      </div>
    </li>
  );
}
