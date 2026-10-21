"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { BUTTON_CLASS } from "@/components/ui/buttons";
import { MenuButton } from "@/components/ui/MenuButton";
import { Switch } from "@/components/ui/Switch";
import { confirmDialog } from "@/lib/confirm";
import { useLatestWrite } from "@/lib/latestWrite";
import {
  addableKinds,
  DEFAULT_CALENDAR_DAYS,
  DEFAULT_LAYOUT,
  visibleWidgets,
  WIDGET_META,
  withActions,
  withDays,
  withMove,
  withoutWidget,
  withSpan,
  withStep,
  withTint,
  withWidget,
  type StartLayout,
  type WidgetAccess,
  type WidgetKind,
} from "@/lib/startLayout";
import { createClient } from "@/lib/supabase/client";
import type { TileKey } from "@/lib/tablet/landing";
import { useTileDrag } from "@/lib/tileDrag";

import { StartWidget } from "./StartWidget";
import { WidgetMenu } from "./WidgetMenu";
import { WidgetSettingsProvider } from "./widgetSettings";

/**
 * THE DESK START PAGE'S GRID (Mark, 2026-10-17: "choose which modules to
 * display and where … A page edit mode could allow the user to drag/move the
 * widgets around, add, remove them").
 *
 * The bodies arrive rendered from the server, one per widget the layout holds;
 * this places them, and in EDIT MODE (a `ui/Switch`, kept in the URL as
 * `?edit=1` — view state) lets them be dragged, resized, tinted, added and
 * removed.
 *
 * A TAP NEVER WAITS ON THE SERVER (`lib/latestWrite`): each change shows at
 * once and is saved behind, newest value only, through `set_my_start_layout`
 * (migration 207). The change is held here until the server's copy matches,
 * and put back if the save fails. Only an ADDED widget needs a refresh — its
 * body has never been fetched; a move, a width, a tint or a day count does not.
 */
export function StartGrid({
  heading,
  serverLayout,
  access,
  bodies,
  actionChoices,
}: {
  heading: ReactNode;
  /** The stored layout, already read (`readStartLayout`). */
  serverLayout: StartLayout;
  access: WidgetAccess;
  /** A body for each widget the server fetched. */
  bodies: Partial<Record<WidgetKind, ReactNode>>;
  /** The tablet tiles this role may put in an Actions widget. */
  actionChoices: { key: TileKey; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState(() => searchParams.get("edit") === "1");
  const [pending, setPending] = useState<StartLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // The held change is dropped once the server's copy says the same thing —
  // "adjust state during render", so there is no frame showing the old one.
  if (pending && JSON.stringify(pending) === JSON.stringify(serverLayout)) setPending(null);
  const layout = pending ?? serverLayout;
  const visible = visibleWidgets(layout, access);
  const visibleKinds = visible.map((w) => w.kind);

  // Whether ANY save in the current run added a widget whose body was never
  // fetched — the queue sends only the newest value, so the flag has to
  // outlive the value that set it.
  const refreshWanted = useRef(false);

  const save = useLatestWrite<StartLayout>(
    async (next) => {
      const supabase = createClient();
      // An untouched default is stored as NULL, so the person keeps following
      // the default as it changes.
      const isDefault = JSON.stringify(next) === JSON.stringify(DEFAULT_LAYOUT);
      const { error } = await supabase.rpc("set_my_start_layout", { p_layout: isDefault ? null : next });
      return error?.message ?? null;
    },
    (failure) => {
      if (failure) {
        setError(`Could not save the layout: ${failure}`);
        setPending(null);
        return;
      }
      if (refreshWanted.current) {
        refreshWanted.current = false;
        router.refresh();
      }
    },
  );
  function change(next: StartLayout) {
    setError(null);
    if (visibleWidgets(next, access).some((w) => !(w.kind in bodies))) refreshWanted.current = true;
    setPending(next);
    save(next);
  }

  function toggleEditing(next: boolean) {
    setEditing(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("edit", "1");
    else url.searchParams.delete("edit");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  async function reset() {
    const ok = await confirmDialog({
      title: "Reset the start page?",
      body: "Your widgets go back to the default arrangement, widths and colors.",
      confirmLabel: "Reset",
    });
    if (ok) change(DEFAULT_LAYOUT);
  }

  const { dragging, startTileDrag, indicatorRef, chipRef } = useTileDrag({
    gridRef,
    onDrop: (kind, target) => change(withMove(layout, kind, target)),
  });

  const addable = addableKinds(layout, access);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {heading}
        <div className="flex flex-wrap items-center gap-3">
          {editing && (
            <>
              {addable.length > 0 && (
                <MenuButton
                  label="Add a widget"
                  trigger="Add widget"
                  caret
                  align="right"
                  triggerClassName={BUTTON_CLASS}
                  items={addable.map((kind) => ({
                    label: WIDGET_META[kind].title,
                    onSelect: () => change(withWidget(layout, kind)),
                  }))}
                />
              )}
              <button type="button" onClick={() => void reset()} className={BUTTON_CLASS}>
                Reset to default
              </button>
            </>
          )}
          <Switch checked={editing} onChange={toggleEditing}>
            Edit layout
          </Switch>
        </div>
      </div>

      {error && <p className="text-sm text-accent">{error}</p>}

      {visible.length === 0 ? (
        <p className="text-sm text-muted">
          No widgets on this page. Turn on Edit layout and use Add widget to put some back.
        </p>
      ) : (
        <div ref={gridRef} className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((w, i) => {
            const meta = WIDGET_META[w.kind];
            const body = bodies[w.kind];
            return (
              <StartWidget
                key={w.kind}
                kind={w.kind}
                title={meta.title}
                href={meta.href}
                span={w.span}
                tint={w.tint}
                editing={editing}
                dimmed={dragging?.kind === w.kind}
                onGrip={(e) => startTileDrag(e, { kind: w.kind, label: meta.title })}
                menu={
                  <WidgetMenu
                    widget={w}
                    title={meta.title}
                    canStepEarlier={i > 0}
                    canStepLater={i < visible.length - 1}
                    onSpan={(span) => change(withSpan(layout, w.kind, span))}
                    onTint={(tint) => change(withTint(layout, w.kind, tint))}
                    onDays={(days) => change(withDays(layout, w.kind, days))}
                    onActions={(actions) => change(withActions(layout, w.kind, actions))}
                    actionChoices={actionChoices}
                    onStep={(step) => change(withStep(layout, w.kind, step, visibleKinds))}
                    onRemove={() => change(withoutWidget(layout, w.kind))}
                  />
                }
              >
                <WidgetSettingsProvider
                  value={{ span: w.span, days: w.days ?? DEFAULT_CALENDAR_DAYS, actions: w.actions ?? [] }}
                >
                  {body ?? <p className="text-sm text-muted">Loading…</p>}
                </WidgetSettingsProvider>
              </StartWidget>
            );
          })}
        </div>
      )}

      {/* Portalled to the body, like every drag overlay here. Both nodes are
          positioned per move through refs — no re-render. */}
      {dragging
        ? createPortal(
            <>
              <div ref={indicatorRef} style={{ display: "none" }} className="pointer-events-none fixed z-50 w-0.5 bg-ink" />
              <div
                ref={chipRef}
                style={{
                  left: dragging.x,
                  top: dragging.y,
                  transform: dragging.touch ? "translate(-50%, calc(-100% - 16px))" : "translate(14px, 18px)",
                }}
                className="pointer-events-none fixed z-50 border border-ink bg-white px-2 py-1 text-[12px] uppercase tracking-[0.08em]"
              >
                {dragging.label}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
