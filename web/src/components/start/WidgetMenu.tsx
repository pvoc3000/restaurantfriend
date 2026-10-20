"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { RowMenu, type RowMenuItem } from "@/components/ui/RowMenu";
import { MENU_PANEL_CLASS, useAnchoredPanel } from "@/lib/anchoredPanel";
import {
  CALENDAR_DAYS,
  DEFAULT_CALENDAR_DAYS,
  START_TINTS,
  type CalendarDays,
  type PlacedWidget,
  type Span,
  type TintKey,
} from "@/lib/startLayout";

/**
 * A WIDGET'S CORNER MENU — everything that affects this widget alone (Mark,
 * 2026-10-17: "a small button in the upper right hand corner of each one"),
 * shown only in edit mode. `ui/RowMenu`, so it is the app's one ⋯ menu: verbs,
 * nothing ticked, the current width disabled and labelled rather than checked,
 * Remove last.
 *
 * Colour… opens a swatch panel on `useAnchoredPanel`, anchored to the same ⋯,
 * so it portals and closes on scroll, Escape and an outside click like every
 * other panel here.
 */
export function WidgetMenu({
  widget,
  title,
  canStepEarlier,
  canStepLater,
  onSpan,
  onTint,
  onDays,
  onStep,
  onRemove,
}: {
  widget: PlacedWidget;
  title: string;
  canStepEarlier: boolean;
  canStepLater: boolean;
  onSpan: (span: Span) => void;
  onTint: (tint: TintKey | null) => void;
  onDays: (days: CalendarDays) => void;
  onStep: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  const close = useCallback(() => setPicking(false), []);
  const box = useAnchoredPanel({ open: picking, triggerRef: anchorRef, panelRef, align: "right", onClose: close });

  const widths: RowMenuItem[] = ([1, 2, 3] as const).map((span) => ({
    label: span === 1 ? "1 column wide" : `${span} columns wide`,
    hint: widget.span === span ? "Now" : undefined,
    disabled: widget.span === span,
    onSelect: () => onSpan(span),
  }));
  const days = widget.days ?? DEFAULT_CALENDAR_DAYS;
  const dayItems: RowMenuItem[] =
    widget.kind === "calendar"
      ? CALENDAR_DAYS.map((n) => ({
          label: `Show ${n} days`,
          hint: days === n ? "Now" : undefined,
          disabled: days === n,
          onSelect: () => onDays(n),
        }))
      : [];

  return (
    <span ref={anchorRef} className="inline-block">
      <RowMenu
        label={`Settings for ${title}`}
        items={[
          ...widths,
          { label: "Colour…", onSelect: () => setPicking(true) },
          ...dayItems,
          { label: "Move earlier", disabled: !canStepEarlier, onSelect: () => onStep(-1) },
          { label: "Move later", disabled: !canStepLater, onSelect: () => onStep(1) },
          { label: "Remove", hint: "Add it back from Add widget", danger: true, onSelect: onRemove },
        ]}
      />
      {picking &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Colour for ${title}`}
            style={{ top: box.top, left: box.left, transform: "translateX(-100%)" }}
            className={`${MENU_PANEL_CLASS} flex gap-2 p-3`}
          >
            {[{ key: null, label: "White", fill: "bg-white" }, ...START_TINTS].map((t) => {
              const current = widget.tint === t.key;
              return (
                <button
                  key={t.key ?? "none"}
                  type="button"
                  aria-label={t.label}
                  aria-pressed={current}
                  title={t.label}
                  onClick={() => {
                    setPicking(false);
                    onTint(t.key as TintKey | null);
                  }}
                  className={`h-8 w-8 border border-ink ${t.fill} ${
                    current ? "outline outline-2 outline-offset-2 outline-ink" : "hover:outline hover:outline-1 hover:outline-offset-2 hover:outline-ink"
                  }`}
                />
              );
            })}
          </div>,
          document.body,
        )}
    </span>
  );
}
