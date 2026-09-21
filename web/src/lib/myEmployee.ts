import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * WHICH EMPLOYEE AM I? — the signed-in member's own employee row, by id.
 *
 * Through 080's `my_employee_id` definer, because `employees` READ is
 * owner/admin (020) and a supervisor cannot look themselves up: the row carries
 * a home address and a date of birth. The function answers only for its caller
 * — there is no id parameter, so it cannot be turned into a lookup — on the
 * reasoning that knowing who YOU are is not a privilege.
 *
 * **NULL IS A REAL ANSWER, not a failure.** `employees.user_id` is nullable, so
 * an app user with no HR record simply has no employee to be; every column this
 * feeds is nullable and has a picker on the record. It returns null on error
 * too, deliberately: a missing operator or order-taker is a field somebody can
 * fill in afterwards, where a refused write would be work thrown away, so this
 * never blocks the write it serves.
 *
 * It lived in `components/production/currentOperator` until 2026-09-21, when
 * the special-order create path became its second reader — which is exactly
 * what 080's own header predicted: "`special_orders.taken_by` can seed itself
 * from the same call whenever that is picked up."
 */
export async function myEmployeeId(
  supabase: SupabaseClient,
  orgId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_employee_id", { p_org_id: orgId });
  if (error) return null;
  return (data as string | null) ?? null;
}
