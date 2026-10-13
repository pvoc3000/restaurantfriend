import { cookies } from "next/headers";

import {
  DEADLINE_COOKIE,
  DEVICE_COOKIE,
  deadlineFor,
  serializeDeadline,
} from "@/lib/sharedDevice";
import { createClient } from "@/lib/supabase/server";

/**
 * THE SHARED iPAD'S HEARTBEAT — `POST /device-touch` (2026-10-13).
 *
 * `IdleLock` calls this when somebody touches the screen, at most once a
 * minute, and it moves the device's lock time forward in an httpOnly cookie
 * that `proxy.ts` checks on every request. That check is the server's half of
 * the idle lock: a page load is refused once the time has passed, whether or
 * not any JavaScript ran to notice.
 *
 * A route handler and not a server action because a server action that sets a
 * cookie makes Next render the calling page again, and this runs every minute
 * under whatever screen is open.
 *
 * It cannot revive a session that is already past its time: it is not exempt
 * in `proxy.ts`, so that request is locked before it arrives here. Only a PIN
 * unlock starts a new clock.
 *
 * The time is the SERVER's clock, so an iPad with the wrong time is neither
 * locked out nor left open.
 */
export async function POST(request: Request) {
  const jar = await cookies();
  if (!jar.has(DEVICE_COOKIE)) return new Response(null, { status: 204 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const body = (await request.json().catch(() => null)) as { extended?: unknown } | null;

  jar.set(
    DEADLINE_COOKIE,
    serializeDeadline(user.id, deadlineFor(Date.now(), body?.extended === true)),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // Kept across a Safari restart, which is exactly when it is needed.
      maxAge: 365 * 24 * 60 * 60,
    }
  );
  return new Response(null, { status: 204 });
}
