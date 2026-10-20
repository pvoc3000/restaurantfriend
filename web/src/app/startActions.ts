"use server";

import { WIDGET_ATTENTION, widgetAccess } from "@/components/start/widgets";
import { startContext } from "@/components/start/widgets/context";
import { getAppSession } from "@/lib/session";
import { readStartLayout, visibleWidgets } from "@/lib/startLayout";

/**
 * THE HOME BUTTON'S BADGE (Mark, 2026-10-20): how many things on YOUR start
 * page need somebody — the sum of the yellow counts on the widgets you have
 * placed and may open, at your working shop. Each widget answers from the same
 * summary its card draws (`WIDGET_ATTENTION`), so the number and the page
 * agree. Read-only. A widget whose queries fail adds nothing rather than
 * failing the badge; no working shop, or the tablet shell, is null — no badge.
 */
export async function startAttention(): Promise<number | null> {
  const session = await getAppSession();
  if (session.shell === "tablet") return null;
  const ctx = await startContext(session);
  if (!ctx) return null;
  const layout = readStartLayout(session.membership.start_layout);
  const counts = await Promise.all(
    visibleWidgets(layout, widgetAccess(ctx.role)).map(async (w) => {
      const count = WIDGET_ATTENTION[w.kind];
      if (!count) return 0;
      try {
        return await count(ctx);
      } catch {
        return 0;
      }
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}
