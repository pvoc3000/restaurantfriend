import type { createClient } from "@/lib/supabase/client";

/**
 * The signed-in member's own employee id, which is who a new batch is
 * "prepared by" (Mark, 2026-09-16: the operator "should be set automatically
 * to whoever is logged in").
 *
 * Through 080's `my_employee_id` definer, because `employees` READ is
 * owner/admin (020) and a supervisor logging a batch cannot look themselves
 * up. Null when the login has no HR record, and on any error — a missing
 * operator is a field somebody can fill on the record, where a failed batch
 * would be a lost one, so this never blocks the write it serves.
 */
export async function currentOperatorId(
  supabase: ReturnType<typeof createClient>,
  orgId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_employee_id", { p_org_id: orgId });
  if (error) return null;
  return (data as string | null) ?? null;
}
