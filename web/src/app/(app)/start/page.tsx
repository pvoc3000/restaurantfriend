import { Landing } from "@/components/tablet/Landing";
import { getAppSession } from "@/lib/session";
import { tilesForRole } from "@/lib/tablet/landing";

/**
 * THE TABLET SHELL'S HOME — a page of actions rather than a menu (Mark,
 * 2026-09-09). Reachable under either shell (a desk browser can look at it),
 * but only the tablet's `/` lands here and only the tablet bar has a Home
 * button pointing at it.
 */
export default async function StartPage() {
  const session = await getAppSession();
  const groups = tilesForRole(session.membership.role);

  return (
    <div className="space-y-8">
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        {session.activeLocation?.code ?? session.orgName}
      </h1>
      <Landing groups={groups} state={{}} />
    </div>
  );
}
