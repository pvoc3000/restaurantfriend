import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/session";

// A compatibility shim, nothing more. `/location` was the singular, id-less
// location screen until 2026-08-01; it's now `/locations/[id]`, reached from
// the list. This keeps old links, bookmarks and anything still pointing here
// working, and costs nothing — getAppSession is React-cached, and a redirect
// thrown during render never paints. Delete it whenever it stops earning its
// keep.
export default async function LegacyLocationPage() {
  const session = await getAppSession();
  redirect(
    session.activeLocation ? `/locations/${session.activeLocation.id}` : "/locations"
  );
}
