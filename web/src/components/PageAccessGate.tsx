"use client";

import { usePathname } from "next/navigation";

import { canReachPage, whoMayReachSentence } from "@/lib/pageAccess";
import { SECTIONS, resolveRoute } from "@/lib/nav";
import { ROLE_LABEL, type Role } from "@/lib/roles";

/**
 * The Page Permissions sheet applied to a typed URL.
 *
 * `sectionsForRole` keeps a hidden screen out of the MENU; this is what a role
 * meets if they reach it anyway — a bookmark, a link in an email, a colleague's
 * screen. Same table, so the two can never disagree about who may open what.
 *
 * It is a SENTENCE, not a redirect: a bounce to somewhere else reads as the
 * app being broken, where "this screen is open to managers and the owner"
 * says what happened and who to ask. It names the screen the way the menu
 * does, and names the reader's own role, which is the fact they most likely
 * did not know.
 *
 * This is the UI layer only. For the HR screens the database ALSO refuses the
 * rows (020, 028, 035 — the sheet's "Unreachable"); for everything else this
 * sentence is the whole of the gate, which Mark chose (2026-09-04) so that
 * changing who sees what is an edit to `lib/pageAccess` and a deploy, never a
 * migration.
 *
 * Client-side because it needs the pathname, which the (app) layout — a server
 * component — does not have; `InactiveLocationGate` beside it made the same
 * call for the same reason. The role is already on screen in the masthead.
 */
export function PageAccessGate({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (canReachPage(role, pathname)) return <>{children}</>;

  const at = resolveRoute(pathname);
  const section = at && SECTIONS.find((s) => s.slug === at.sectionSlug);
  const sub = section?.subs.find((s) => s.slug === at?.subSlug);

  return (
    <div className="max-w-2xl space-y-2">
      {section && (
        <p className="text-[12px] uppercase tracking-[0.12em] text-muted">{section.label}</p>
      )}
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        {sub?.label ?? "Not available"}
      </h1>
      <p className="text-sm text-muted">
        This screen is open to {whoMayReachSentence(pathname)}. You’re signed in as{" "}
        {ROLE_LABEL[role]}.
      </p>
    </div>
  );
}
