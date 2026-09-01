import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Calling `qbo-sync` and getting the real sentence back.
 *
 * TWO THINGS EVERY CALL SITE HAS TO GET RIGHT, and both were got wrong once.
 *
 * (1) The SDK reports only "Edge Function returned a non-2xx status code"
 * unless you reach into `FunctionsHttpError.context` and re-parse the body,
 * where the actual message lives. `SyncFromSquare` learned this first; without
 * it every carefully worded `QboError` — the one naming the wrong environment's
 * keys, the one carrying Intuit's own `intuit_tid` — is invisible.
 *
 * (2) A call made from an EFFECT is the one most likely to have its error
 * dropped, because there is no button to put a message next to and the empty
 * result still renders. Both settings and vendor blocks did exactly that: a
 * failure left a picker with no options and no explanation, which reads as
 * QuickBooks having nothing to offer rather than as something being wrong.
 * That is why this returns a `message` rather than a thrown error — an effect
 * can hold it in state without a try/catch.
 */
export async function invokeQbo(
  supabase: SupabaseClient,
  body: Record<string, unknown>
): Promise<{ data: Record<string, unknown> | null; message: string | null }> {
  const { data, error } = await supabase.functions.invoke("qbo-sync", { body });
  if (!error) return { data: (data ?? {}) as Record<string, unknown>, message: null };

  let message = error.message;
  try {
    const ctx = (error as { context?: Response }).context;
    const parsed = await ctx?.json();
    if (parsed?.error) message = parsed.error as string;
  } catch {
    /* keep the generic message */
  }

  // The gateway refuses a stale session before the function runs, and its own
  // wording ("Invalid JWT") means nothing to somebody looking at a vendor
  // record. Say what it actually is.
  if (/invalid jwt|unauthorized/i.test(message)) {
    message = "Your sign-in has expired — reload the page and try again.";
  }

  return { data: null, message };
}
