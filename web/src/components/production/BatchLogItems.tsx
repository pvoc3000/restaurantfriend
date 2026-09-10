"use client";

import { useRef, useState, type ReactNode } from "react";
import type { PickOption } from "@/components/ui/PickList";
import { useExactViewportHeight } from "@/lib/tableHead";
import { SectionNav } from "@/components/ui/SectionNav";
import { Switch } from "@/components/ui/Switch";
import { TextInput } from "@/components/ui/TextInput";
import { useRememberedView } from "@/lib/viewMemory";
import { clampSplit, setSplit, useSplit } from "@/lib/paneSplit";
import { BatchItemsTable, type BatchRow } from "@/components/production/BatchItemsTable";
import { BatchFields, type BatchFieldsRow } from "@/components/production/BatchFields";
import { BatchActions } from "@/components/production/BatchActions";
import { BatchHistory } from "@/components/production/BatchHistory";
import { BatchRecipe } from "@/components/production/BatchRecipe";

type Pane = "info" | "ingredients" | "instructions" | "history";

/**
 * FOUR TABS, NOT TWO (Mark, 2026-09-09, with FileMaker's own tablet layout
 * beside it): Info · Ingredients · Instructions · History. "Previously made"
 * used to be Info's third column and the recipe's steps sat beside its
 * ingredients — the two widest things in the pane, and what stopped the split
 * fitting a portrait iPad. One thing per tab is what buys the width back.
 */
const PANE_SECTIONS = [
  { key: "info" as Pane, label: "Info" },
  { key: "ingredients" as Pane, label: "Ingredients" },
  { key: "instructions" as Pane, label: "Instructions" },
  { key: "history" as Pane, label: "History" },
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
  touch = false,
  crumbs,
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
  /** The tablet shell — see `BatchItemsTable`'s prop of the same name. */
  touch?: boolean;
  /**
   * The record's breadcrumb row, handed in so the tablet can put the SEARCH
   * BOX on the same line, right-aligned (Mark, 2026-09-09: "to save space").
   * The two live in different components — the crumbs are the server page's,
   * the search is this table's remembered state — so the page passes its row
   * down rather than this component reaching up. Desk callers pass nothing
   * and render their crumbs where they always did.
   */
  crumbs?: ReactNode;
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
  // The search, lifted out of the table so the tablet can draw it beside the
  // crumbs. Same remembered key the table uses on its own, so walking to the
  // next log keeps the term either way.
  const [term, setTerm] = useRememberedView("batch-items.search", "");
  const [hiddenRounds, setHiddenRounds] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  // The tablet opens with the pane at half the frame: at 768px tall a 42% pane
  // showed two fields and scrolled the rest (Mark, 2026-09-09). Only the
  // DEFAULT — a dragged split is remembered either way.
  const split = useSplit(SPLIT_NAME, touch ? 0.5 : DEFAULT_SPLIT);

  // THE SPLIT IS ALWAYS ON (Mark, 2026-09-09: "The sliding content view is
  // mandatory, but it gets disabled in portrait mode"). It switched to a
  // stacked page below `lg`, on the theory that a 1024px-wide pane was the
  // narrowest the three-column detail could hold — which was true, and is why
  // the pane is four tabs now rather than a page. `wide` survives as a constant
  // so the two arrangements' classes stay legible side by side.
  const wide = true;
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
    <>
      {crumbs ? (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">{crumbs}</div>
          <TextInput
            value={term}
            onValueChange={setTerm}
            placeholder="Search element, shift, batch…"
            aria-label="Search batches"
            className="w-64"
          />
        </div>
      ) : null}
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
          touch={touch}
          term={crumbs ? term : undefined}
          onTermChange={crumbs ? setTerm : undefined}
        />
      </div>

      <section
        // ONE margin class, not `mt-3` plus a conditional `mt-4`: Tailwind
        // resolves competing utilities by stylesheet order, not class-string
        // order, so having both makes the gap a coin toss.
        // NO BORDER ON THE TABLET (Mark, 2026-09-09: "it's eating space"). The
        // black bar above already says where the pane begins, and the frame
        // under it is pinned to the window, so a 1px rule plus 16px of inner
        // padding on every side was ~34px of a 768px screen saying nothing.
        // The desk keeps its frame.
        className={`${touch ? "" : "border border-ink"} ${
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
          <div className={`flex gap-5 ${touch ? "pt-3" : "p-4"} ${wide ? "min-h-0 flex-1" : ""}`}>
            {/* The tab column scrolls itself like the columns beside it: at
                the tablet's taller rows four tabs are 164px, which is more than
                a short pane holds, and a column that cannot scroll paints its
                last tab over the pane's own border. */}
            <div className={`min-h-0 shrink-0 overflow-y-auto ${touch ? "w-36" : "w-28"}`}>
              <SectionNav
                items={PANE_SECTIONS}
                value={pane}
                onSelect={setPane}
                ariaLabel="What to show about this batch"
                // Wide enough for INSTRUCTIONS on one line at either size (Mark,
                // 2026-09-09: "give more width or padding to the tabs").
                size={touch ? "lg" : "md"}
              />
            </div>

            {pane === "info" ? (
              // THE INFO TAB SCROLLS AS ONE (Mark, 2026-09-09: "why are photo,
              // notes and delete stuck in the pane when adjusting its size?").
              // It used to be three scrollers — each column filling the pane
              // and scrolling itself — because the HISTORY needed a column of
              // its own to fill (Mark, 2026-08-09). With the history on its own
              // tab there is nothing left to fill, and per-column scrolling
              // meant dragging the pane moved the fields while the photo, the
              // notes and Delete sat where they were. One scroller, and the
              // whole tab moves together; `fill` off on the fields for the same
              // reason.
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                <BatchFields
                  row={selected}
                  orgId={orgId}
                  operators={operators}
                  versions={
                    selected.element_id ? versionsByElement[selected.element_id] ?? [] : []
                  }
                  editable={editable}
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <BatchActions
                    batchId={selected.id}
                    elementName={selected.element_name}
                    batchNumber={selected.batch_number}
                    hasYield={selected.yield_count !== null || selected.yield_size !== null}
                    photoPath={selected.photo_path}
                    removable={removable}
                  />
                </div>
              </div>
            ) : pane === "history" ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
                <BatchHistory
                  elementId={selected.element_id}
                  locationId={locationId}
                  currentBatchId={selected.id}
                  fill={wide}
                  showSkipped={showSkipped}
                  onHiddenCount={setHiddenRounds}
                />
                {/* The history's filter, under the list it filters. NOT a
                    `<label>`: `ui/Switch` renders a button, and a label does not
                    forward its click to one — the caption would look associated
                    and do nothing. The words are their own button. */}
                <div className="flex shrink-0 items-center gap-2">
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
            ) : (
              // The recipe manages its own scroller, so this one doesn't — it
              // hands over a definite height and gets out of the way.
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <BatchRecipe
                  versionId={selected.recipe_version_id ?? selected.masterVersionId ?? null}
                  elementName={selected.element_name}
                  show={pane}
                  size={touch ? "lg" : "md"}
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
    </>
  );
}
