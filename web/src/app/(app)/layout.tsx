import { AppHeader } from "@/components/AppHeader";
import { getAppSession } from "@/lib/session";

// Everything inside the (app) route group is signed-in + location-scoped.
//
// `panel` is the parallel slot for detail slide-overs: in-app navigation to
// /items/[id] or /vendors/[id] is intercepted into it (see @panel), floating
// the detail over the page you're on instead of replacing it. Hard loads and
// deep links still render the dedicated pages; the slot falls back to null.
export default async function AppLayout({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  const session = await getAppSession();

  return (
    <>
      <AppHeader session={session} />
      <main className="flex-1 px-12 py-8">{children}</main>
      {panel}
    </>
  );
}
