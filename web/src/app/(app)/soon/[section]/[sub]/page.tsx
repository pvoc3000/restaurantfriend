import { notFound, redirect } from "next/navigation";

import { NotBuiltYet } from "@/components/NotBuiltYet";
import { findSection, findSub } from "@/lib/nav";

/**
 * The landing place for every menu item that isn't built. One route serves all
 * of them: the slugs come straight from lib/nav.ts, so a screen graduates by
 * getting a real href there — nothing here needs touching.
 */
export default async function SoonPage({
  params,
}: {
  params: Promise<{ section: string; sub: string }>;
}) {
  const { section: sectionSlug, sub: subSlug } = await params;

  const section = findSection(sectionSlug);
  const sub = section && findSub(section, subSlug);
  if (!section || !sub) notFound();

  // A hand-typed /soon/purchasing/vendors would otherwise claim a shipped
  // screen doesn't exist. Send it to the real one.
  if (sub.built) redirect(sub.href);

  // The section's generic label, not the active location's code: the tab
  // beside it already carries the code, and a stub isn't worth the round trip
  // to getAppSession() (the layout's call isn't cached).
  return <NotBuiltYet kicker={section.label} title={sub.label} />;
}
