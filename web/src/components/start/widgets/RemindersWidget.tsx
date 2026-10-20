import { GuideRequests } from "@/components/purchasing/GuideRequests";
import { Reminders } from "@/components/purchasing/Reminders";
import { fetchDueReminders, fetchOpenRequests } from "@/lib/guideBands";
import { canReachPage } from "@/lib/pageAccess";
import { canResolveRequests, canWriteCatalog } from "@/lib/roles";

import type { StartContext } from "./shared";

/**
 * REMINDERS — the order guide's two bands in one widget (Mark, 2026-10-17:
 * "purchase requests can be folded into the reminders widget"): due reminders
 * and open purchase requests. The guide's own components, so dismissing, "Add
 * reminder" and the request ⋯ menu behave exactly as on the guide; an item name
 * links to its record, there being no walk to jump down.
 *
 * Each half keeps its own gate (`/order-guide`, `/purchase-requests`). Reminders
 * are "due" against TODAY, where the guide uses the walked date. Side by side
 * from two columns, stacked at one.
 */
export async function RemindersWidget(ctx: StartContext) {
  const mayRemind = canReachPage(ctx.role, "/order-guide");
  const mayRequest = canReachPage(ctx.role, "/purchase-requests");
  const [reminders, requests] = await Promise.all([
    mayRemind ? fetchDueReminders(ctx.supabase, ctx.shop.id, ctx.today) : null,
    mayRequest ? fetchOpenRequests(ctx.supabase, ctx.shop.id) : null,
  ]);
  const canWrite = canWriteCatalog(ctx.role);
  const nothing = (reminders?.length ?? 0) === 0 && (requests?.length ?? 0) === 0;

  return (
    <div className="space-y-3">
      {nothing && <p className="text-sm text-muted">Nothing due, and no open requests.</p>}
      {/* Each band draws nothing when it is empty — except Reminders, which
          leaves its "Add reminder" link for a writer. */}
      {(!nothing || (reminders && canWrite)) && (
        <div className="grid gap-4 @xl:grid-cols-2 @xl:items-start">
          {reminders && (
            <Reminders
              reminders={reminders}
              guideDate={ctx.today}
              locationId={ctx.shop.id}
              orgId={ctx.orgId}
              canWrite={canWrite}
            />
          )}
          {requests && (
            <GuideRequests requests={requests} userId={ctx.session.userId} canResolve={canResolveRequests(ctx.role)} />
          )}
        </div>
      )}
    </div>
  );
}

/** What Reminders adds to the Home button's badge: reminders due and requests
 *  still open, each under its own gate — both are waiting on somebody. */
export async function remindersAttention(ctx: StartContext): Promise<number> {
  const [reminders, requests] = await Promise.all([
    canReachPage(ctx.role, "/order-guide") ? fetchDueReminders(ctx.supabase, ctx.shop.id, ctx.today) : [],
    canReachPage(ctx.role, "/purchase-requests") ? fetchOpenRequests(ctx.supabase, ctx.shop.id) : [],
  ]);
  return reminders.length + requests.length;
}
