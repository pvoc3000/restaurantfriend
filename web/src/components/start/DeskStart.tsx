import type { ReactNode } from "react";

import type { AppSession } from "@/lib/session";
import { readStartLayout, visibleWidgets, type WidgetKind } from "@/lib/startLayout";
import { serverTimeZone, todayInTimeZone } from "@/lib/today";

import { NewDayBackLink } from "./NewDayBackLink";
import { StartGrid } from "./StartGrid";
import { WIDGET_BODY, widgetAccess } from "./widgets";
import { startContext } from "./widgets/context";
import { longDate } from "./widgets/shared";

/**
 * THE DESK START PAGE (Mark, 2026-09-17: "Let's make one for the desktop
 * too, and navigate to it when logging in").
 *
 * SINCE 2026-10-20 A PAGE OF WIDGETS each person arranges for themselves
 * (Mark: "choose which modules to display and where to display them"): which
 * ones, in what order, how wide, what tint — `org_members.start_layout`
 * (migration 207), read by `lib/startLayout`. A person who never edits it sees
 * the page as it was. The arranging is `StartGrid`'s; this is the server half.
 *
 * SCOPED TO THE WORKING SHOP (Mark, 2026-09-17, the same day — it shipped
 * whole-org for an hour). That makes every count agree with the list it links
 * to, since the purchase order, invoice and shift report lists follow the
 * working shop too. Special orders count the shop as either the pickup shop or
 * the kitchen; paperwork counts the staff whose MAIN location it is.
 *
 * READ-ONLY and fetched in one wave — and only for the widgets this person has
 * placed, so a page of four widgets costs four widgets' queries. A widget that
 * fails costs its own tile a sentence rather than the page, and a widget a role
 * may not open is not fetched at all (`widgetAccess`, from `lib/pageAccess`).
 */
export async function DeskStart({ session }: { session: AppSession }) {
  const role = session.membership.role;
  const timeZone = session.orgSettings.timezone ?? serverTimeZone();
  const today = todayInTimeZone(timeZone);
  const shop = session.activeLocation;

  const heading = (
    // Only the TITLE changed (Mark, 2026-09-17: "Welcome to <org name>!");
    // the route and the tablet page are still Start.
    <div>
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        {session.orgName ? `Welcome to ${session.orgName}!` : "Welcome!"}
      </h1>
      <p className="mt-1 text-[12px] uppercase tracking-[0.12em] text-subtle">
        {shop ? `${shop.code} · ` : ""}
        {longDate(today)}
      </p>
      {/* A new day sent this tab here from last night's page (lib/newDay). */}
      <div className="mt-2 empty:hidden">
        <NewDayBackLink />
      </div>
    </div>
  );

  if (!shop) {
    return (
      <div className="space-y-10">
        {heading}
        <p className="text-sm text-muted">Pick a location to see how it is doing.</p>
      </div>
    );
  }

  const layout = readStartLayout(session.membership.start_layout);
  const access = widgetAccess(role);
  const ctx = await startContext(session);
  if (!ctx) return null;

  const placed = visibleWidgets(layout, access).map((w) => w.kind);
  const rendered = await Promise.all(
    placed.map(async (kind): Promise<[WidgetKind, ReactNode]> => {
      try {
        return [kind, await WIDGET_BODY[kind](ctx)];
      } catch (e) {
        // A throw, not a refused query (those come back as a sentence from the
        // widget itself): still only this tile's problem.
        return [kind, <p key={kind} className="text-sm text-accent">Could not load: {(e as Error).message}</p>];
      }
    }),
  );

  return (
    <StartGrid heading={heading} serverLayout={layout} access={access} bodies={Object.fromEntries(rendered)} />
  );
}

