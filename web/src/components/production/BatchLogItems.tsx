"use client";

import { useRef, useState } from "react";
import type { PickOption } from "@/components/ui/PickList";
import { useExactViewportHeight, useViewportAtLeast } from "@/lib/tableHead";
import { SectionNav } from "@/components/ui/SectionNav";
import { Switch } from "@/components/ui/Switch";
import { clampSplit, setSplit, useSplit } from "@/lib/paneSplit";
import { BatchItemsTable, type BatchRow } from "@/components/production/BatchItemsTable";
import { BatchFields, type BatchFieldsRow } from "@/components/production/BatchFields";
import { BatchActions } from "@/components/production/BatchActions";
import { BatchHistory } from "@/components/production/BatchHistory";
import { BatchRecipe } from "@/components/production/BatchRecipe";

type Pane = "info" | "recipe";

const PANE_SECTIONS = [
  { key: "info" as Pane, label: "Info" },
  { key: "recipe" as Pane, label: "Recipe" },
];

/**
 * THE DIVIDER IS DRAGGABLE — the reader decides how the height is split (Mark,
 * 2026-08-09).
 *
 * This replaced two guesses in a row, and the sequence is the argument. First
 * the pane took 40% of the frame, which gave it 600px of air it had no use for
 * on a tall window while capping the LIST at 60% however much room there was.
 * Then it was a fixed 420px, which fixed that and set a different number nobody
 * had measured: the pane wants more when you are filling in a yield and less
 * when you are working down thirty rows, and no constant is right for both.
 *
 * A handle is the honest answer, and the app already had one — the receiving
 * screen's document/lines divider — so this is that pattern turned 90°. Same
 * rules for the same reasons: FRACTIONS rather than pixels, so the split still
 * means something after a resize; the fraction in localStorage, because it is a
 * display preference; and pointer events rather than HTML5 drag, because iPad
 * Safari is what this is read on.
 *
 * Below `lg` there is no divider at all: the two stack and the page scrolls,
 * which is what a narrow screen wants and leaves nothing to divide.
 */
const SPLIT_NAME = "batch-log";
/** The list gets a little under three fifths — roughly where the old 420px pane
 *  landed on a desk-sized window, so nobody's first look moves. */
const DEFAULT_SPLIT = 0.58;
/**
 * The frame's floor — enough for four dense rows, their labels, and a pane that
 * can still show a field or two.
 *
 * Deliberately mean. Everything above the frame (breadcrumb, title, the log's
 * own strip, the filter row) is ~250px, so a 720px window has ~437px to give:
 * past that point something has to yield, and what the floor decides is WHICH.
 * Set generously the frame simply exceeds the window and the PAGE scrolls,
 * which loses the pinned pane that is the whole design. Set to a real minimum,
 * the two panes divide what there is and the page stays one screen for as long
 * as it possibly can.
 */
const FRAME_FLOOR = 40 + 4 * 36 + 8 + 260;

/**
 * A batch log, laid out the way FileMaker's is: the items on top, ONE batch's
 * detail pinned underneath, and clicking a row moves the detail (Mark,
 * 2026-08-09, with the DF Operations screenshot).
 *
 * WHY A PINNED PANE AND NOT A ROUTE. Working a log is one task with thirty
 * repetitions — pick a row, type what came out, pick the next. A navigation per
 * batch would make that thirty round trips and lose the list's scroll each
 * time.
 *
 * There is NO route for a single batch. One existed and was deleted the same
 * day: "there will never be any use for the standalone batch log item record.
 * It will always be done in the pinned detail pane" (Mark, 2026-08-09). So this
 * pane carries everything a batch record did — its fields, and its Cost and
 * Delete commands — and nothing renders a batch anywhere else.
 *
 * THE HEIGHT IS MEASURED, never a CSS constant. What sits above this row varies
 * — the log's own fields wrap at narrow widths, the actions band comes and goes
 * — so `100vh - <guess>` runs the pane off the bottom of the window, which is
 * the receiving screen's lesson. `useExactViewportHeight` asks the DOM and
 * writes the height to the node.
 *
 * Below `lg` it STACKS and the page scrolls instead: a pinned pane on a narrow
 * screen leaves the table about six rows, which is worse than scrolling.
 */
export function BatchLogItems({
  rows,
  fields,
  orgId,
  operators,
  versionsByElement,
  locationId,
  editable,
  removable,
}: {
  rows: BatchRow[];
  /** The same batches, carrying what the PANE needs. Keyed by id. */
  fields: Record<string, BatchFieldsRow>;
  orgId: string;
  operators: PickOption[];
  versionsByElement: Record<string, PickOption[]>;
  locationId: string;
  editable: boolean;
  /** Purchaser+ — 044's delete policy, narrower than the edit one. */
  removable: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("info");
  /**
   * The history's own filter, held HERE because its switch sits on the footer
   * row beside Delete (Mark, 2026-08-09: "can the new show skipped toggle be in
   * line with the delete button?") while the rows it hides are three columns
   * away. Lifting it is what lets the two live in different boxes.
   *
   * Not remembered between batches: it is a question about the element in front
   * of you, and 42 hidden rounds on one flavour says nothing about the next.
   */
  const [showSkipped, setShowSkipped] = useState(false);
  const [hiddenRounds, setHiddenRounds] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const split = useSplit(SPLIT_NAME, DEFAULT_SPLIT);

  // `lg`, Tailwind's own breakpoint, through the store the rest of the app uses
  // — a `useSyncExternalStore` rather than an effect, which is what the
  // set-state-in-effect rule wants.
  const wide = useViewportAtLeast(1024);
  useExactViewportHeight(frame, wide, FRAME_FLOOR);

  /** Drag the divider. The receiving screen's handler on the other axis: the
   *  fraction is of the FRAME, which is itself measured to the window, so it
   *  keeps meaning the same thing when the window changes. */
  function startDrag(event: React.PointerEvent) {
    event.preventDefault();
    const box = frame.current?.getBoundingClientRect();
    if (!box) return;
    const move = (e: PointerEvent) =>
      setSplit(SPLIT_NAME, clampSplit((e.clientY - box.top) / box.height));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // DERIVED, not corrected. A batch that has gone — deleted, or dropped by a
  // refresh — must not leave the pane showing something that isn't there, and
  // an effect that noticed and re-set the state would both trip the
  // set-state-in-effect rule and paint one frame of the stale batch. Falling
  // back during render has neither problem, and needs no state for the default.
  const selectedId = picked && fields[picked] ? picked : rows[0]?.id ?? null;
  const selected = selectedId ? fields[selectedId] ?? null : null;

  return (
    <div ref={frame} className="flex flex-col">
      {/* `min-h-0` for the same reason the receiving columns carry `min-w-0` on
          the other axis: a flex item's automatic minimum is its CONTENT, which
          outranks `flex-basis`, so thirty rows would push past their share and
          shove the pane off the bottom of the frame. `shrink-0 grow-0` is what
          makes the basis the whole answer rather than a starting point. */}
      <div
        className={wide ? "flex min-h-0 shrink-0 grow-0 flex-col" : ""}
        style={wide ? { flexBasis: `${split * 100}%` } : undefined}
      >
        <BatchItemsTable
          rows={rows}
          editable={editable}
          selectedId={selectedId}
          onSelect={setPicked}
          fill={wide}
        />
      </div>

      <section
        // ONE margin class, not `mt-3` plus a conditional `mt-4`: Tailwind
        // resolves competing utilities by stylesheet order, not class-string
        // order, so having both makes the gap a coin toss.
        className={`border border-ink ${
          wide ? "mt-3 flex min-h-0 flex-1 flex-col" : "mt-4 shrink-0"
        }`}
      >
        {/* FileMaker's own title: BATCH #19510 - OLD FASHION DOUGH. The number
            is the one identifier the list stopped showing, so leading with it
            here is what keeps it legible somewhere.

            THE BAR IS ALSO THE DRAG HANDLE (Mark, 2026-08-09: "the natural
            placement for the drag handle is the black header bar"). He is
            right, and it is better than the 10px strip it replaces for a reason
            worth writing down: that strip was an invisible target you had to
            find, sitting in the gap between two things, and a gap is where you
            aim when you mean to hit NEITHER. The black bar already IS the
            boundary — it is the top edge of the pane and the thing directly
            under the list — so it is where the hand goes, and it is 36px tall
            instead of 10.

            It carries no controls, which is what makes this safe: nothing here
            can swallow the pointerdown or be pressed by accident mid-drag. Add
            one and it needs its own `stopPropagation`. */}
        <header
          onPointerDown={wide ? startDrag : undefined}
          title={wide ? "Drag to resize" : undefined}
          className={`relative flex shrink-0 items-center gap-3 bg-ink px-4 py-2 text-white ${
            wide ? "cursor-row-resize touch-none select-none" : ""
          }`}
        >
          <h2 className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.12em]">
            {selected
              ? `Batch #${selected.batch_number} — ${selected.element_name}`
              : "No batch selected"}
          </h2>
          {selected && !selected.generated && !selected.migrated ? (
            <span className="ml-auto shrink-0 text-[11px] tracking-[0.08em] text-white/70">
              by hand
            </span>
          ) : null}
          {/* A grip, so the bar says it can be dragged rather than only
              revealing it on hover — the iPad has no hover and no cursor.
              Centred, aria-hidden, and it takes no width from the title.

              TWO SOLID WHITE BARS, not a faint glyph (Mark, 2026-08-09). A
              typographic `═` at 40% opacity was a mark you had to be told
              about; this is the affordance every resize grip in every app is,
              at the one weight that reads on black. Drawn rather than typed, so
              it cannot be a font's idea of the character. */}
          {wide ? (
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col gap-[3px]"
            >
              <span className="block h-[2px] w-9 bg-white/80" />
              <span className="block h-[2px] w-9 bg-white/80" />
            </span>
          ) : null}
        </header>

        {selected ? (
          // Info · Recipe as PLAIN TEXT DOWN THE LEFT with the content pushed
          // right (Mark, 2026-08-09), which is the employee record's arrangement
          // brought here rather than re-derived — see `ui/SectionNav`, which
          // grew an `onSelect` mode for it because a batch has no route to link
          // to. It also buys back the ~50px row a segmented bar spent above the
          // fields, which on a divided pane is a field.
          <div className={`flex gap-5 p-4 ${wide ? "min-h-0 flex-1" : ""}`}>
            <SectionNav
              items={PANE_SECTIONS}
              value={pane}
              onSelect={setPane}
              ariaLabel="What to show about this batch"
              className="w-20 shrink-0"
            />

            {pane === "info" ? (
              // EACH COLUMN SCROLLS ITSELF now, rather than the tab scrolling as
              // one (Mark, 2026-08-09: "make the history section fill the
              // frame"). It has to work that way round: filling means taking a
              // share of a definite height, and inside a single scroller there
              // is no height to share — every child is as tall as its content.
              // So this box stops scrolling and hands its height down.
              <div
                className={`flex min-w-0 flex-1 flex-col gap-4 ${
                  wide ? "min-h-0" : "max-h-[46vh] overflow-y-auto"
                }`}
              >
                <BatchFields
                  row={selected}
                  orgId={orgId}
                  operators={operators}
                  versions={
                    selected.element_id ? versionsByElement[selected.element_id] ?? [] : []
                  }
                  editable={editable}
                  fill={wide}
                  history={
                    <BatchHistory
                      elementId={selected.element_id}
                      locationId={locationId}
                      currentBatchId={selected.id}
                      fill={wide}
                      showSkipped={showSkipped}
                      onHiddenCount={setHiddenRounds}
                    />
                  }
                />
                {/* The pane's footer: the batch's own command on the left, the
                    history's filter on the right — under the column it filters,
                    which is what makes a switch that far from its list read as
                    belonging to it. `justify-between` rather than a spacer, so
                    the row still works when Delete is absent below purchaser+. */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <BatchActions
                    batchId={selected.id}
                    elementName={selected.element_name}
                    batchNumber={selected.batch_number}
                    hasYield={selected.yield_count !== null || selected.yield_size !== null}
                    photoPath={selected.photo_path}
                    removable={removable}
                  />
                  {/* NOT a `<label>`: `ui/Switch` renders a button, and a label
                      does not forward its click to one — the caption would look
                      associated and do nothing. The words are their own button. */}
                  <div className="ml-auto flex items-center gap-2">
                    <Switch
                      size="sm"
                      on={showSkipped}
                      onToggle={() => setShowSkipped((v) => !v)}
                      ariaLabel="Show rounds where nothing was made"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSkipped((v) => !v)}
                      className="text-[11px] uppercase tracking-[0.08em] text-muted hover:text-ink"
                    >
                      Show skipped
                      {/* The COUNT is what keeps the default honest: eighteen
                          rows could read as the whole history without it. */}
                      {hiddenRounds > 0 && !showSkipped ? (
                        <span className="ml-1 tabular-nums text-subtle">{hiddenRounds}</span>
                      ) : null}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // The recipe manages its own two scrollers, so this one doesn't —
              // it hands over a definite height and gets out of the way.
              <div
                className={`flex min-w-0 flex-1 flex-col ${
                  wide ? "min-h-0" : "h-[46vh]"
                }`}
              >
                <BatchRecipe
                  versionId={selected.recipe_version_id ?? selected.masterVersionId ?? null}
                  elementName={selected.element_name}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="p-4">
            <p className="text-sm text-muted">Pick a batch above to fill this in.</p>
          </div>
        )}
      </section>
    </div>
  );
}
