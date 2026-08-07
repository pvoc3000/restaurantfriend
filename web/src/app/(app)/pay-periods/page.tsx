import { redirect } from "next/navigation";

// A compatibility shim, nothing more. `/pay-periods` was a list of all 178
// fortnights until 2026-08-06; its only job was choosing one, which the period
// picker on the Timesheets screen does. This keeps old links and bookmarks
// working, and costs nothing — a redirect thrown during render never paints,
// which is also why there is no `loading.tsx` beside it. Delete it whenever it
// stops earning its keep. (`/location` is the precedent.)
export default async function LegacyPayPeriodsPage() {
  redirect("/timesheets");
}
