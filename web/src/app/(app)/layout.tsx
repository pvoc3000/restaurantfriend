import { AppHeader } from "@/components/AppHeader";
import { getAppSession } from "@/lib/session";

// Everything inside the (app) route group is signed-in + location-scoped.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAppSession();

  return (
    <>
      <AppHeader session={session} />
      <main className="flex-1 px-4 py-6">{children}</main>
    </>
  );
}
