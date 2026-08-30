import { redirect } from "next/navigation";

/**
 * The master lists moved onto `/checklists` as a tab (Mark, 2026-08-30).
 *
 * A redirect shim rather than a deletion — `/location`'s and `/pay-periods`'
 * pattern — because this address is in the template record's breadcrumb, in
 * the `rf.nav` cookie for anyone who visited before the change, and in any link
 * already shared. The record itself keeps its own route at
 * `/checklist-templates/[id]`; only the LIST moved.
 *
 * No `loading.tsx` beside it: a redirect thrown during render never paints.
 */
export default function ChecklistTemplatesRedirect() {
  redirect("/checklists?view=templates");
}
