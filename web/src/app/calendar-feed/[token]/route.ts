import { createAnonClient } from "@/lib/supabase/anon";
import { buildCalendar, readFeed } from "@/lib/ics";

/**
 * THE PUBLISHED CALENDAR — `/calendar-feed/<token>` (migration 185).
 *
 * The app's first route handler, because it is the first thing here that is
 * not a page: a calendar app fetches it, signed out, and wants text/calendar.
 * `proxy.ts` exempts the prefix for the same reason it exempts `/q/` and
 * `/pay/` — and what makes that sound is the same too: this reaches ONE
 * definer function, `calendar_feed_by_token`, which reads one link row and
 * returns only the layers and shops that link names.
 *
 * A token that is unknown, short or revoked is a 404 with no body, the same
 * answer for all three.
 *
 * `.ics` on the end is accepted and ignored (`/calendar-feed/<token>.ics`):
 * some calendar apps will not subscribe to a URL without it.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token: raw } = await context.params;
  const token = raw.replace(/\.ics$/i, "");

  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc("calendar_feed_by_token", { p_token: token });
  const feed = error ? null : readFeed(data);
  if (!feed) return new Response(null, { status: 404 });

  const body = buildCalendar({
    name: feed.label,
    timeZone: feed.timeZone,
    items: feed.items,
    now: Date.now(),
    origin: new URL(request.url).origin,
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calendar.ics"',
      // The token is a secret in the URL: never cached by anything shared.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
