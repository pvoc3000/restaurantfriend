import { redirect } from "next/navigation";

import { lockScreenMembers } from "@/app/deviceActions";
import { LockScreen } from "@/components/lock/LockScreen";

/**
 * The shared iPad's picker (migration 097). OUTSIDE both route groups, like
 * /login: it is reached signed out — after an idle lock there is no session —
 * and `proxy.ts` exempts it by name and sends a signed-out registered device
 * here instead of to /login.
 *
 * No `loading.tsx`: the one call below carries the device cookie and is fast,
 * and a redirect thrown during render never paints.
 */
export default async function LockPage() {
  const result = await lockScreenMembers();

  // No device cookie: this is not a shared iPad, so the password screen is
  // the right place. An unknown device (forgotten on /settings, or a
  // corrupt cookie) gets the same answer — the picker cannot offer anybody.
  if (!result.ok && result.reason !== "error") redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <LockScreen
        members={result.ok ? result.members : []}
        deviceName={result.ok ? result.deviceName : null}
      />
    </div>
  );
}
