"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { PickList } from "@/components/ui/PickList";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";
import {
  expenseAccountFor,
  qboVendorId,
  splitAccountName,
  type AccountingRef,
} from "@/lib/quickbooks";

/**
 * How one vendor talks to QuickBooks: which QBO vendor it is, and which account
 * its bills post to.
 *
 * TWO THINGS ON ONE BLOCK because they are the same question asked twice — you
 * come here to say "BakeMark is this vendor in QuickBooks, and its bills are
 * Baker Items COGs". Splitting them would mean two trips to the same record.
 *
 * ITS OWN COMPONENT rather than two more rows in `VendorFields`, because both
 * pickers need lists fetched from QuickBooks and that block is a pure field
 * grid over `InlineValue`. Same reason `AccountingSettings` is not part of the
 * settings page's other blocks.
 *
 * THE ACCOUNT IS AN OVERRIDE (migration 082). Empty means the org default from
 * Settings → Accounting, which is what the field says when nothing is set —
 * never a blank, because a blank reads as nothing happening rather than as
 * inheritance.
 */

type Choice = { id: string; name: string; leaf?: string; depth?: number; type?: string };

export type VendorAccountingRow = {
  id: string;
  name: string;
  external_ref: AccountingRef | null;
  expense_account_ref: string | null;
  expense_account_name: string | null;
};

export function VendorAccounting({
  vendor,
  orgDefault,
  schemaError,
}: {
  vendor: VendorAccountingRow;
  /** `accounting_connections.bill_expense_account_ref/_name`, read on the
   *  server. Null when QuickBooks is not connected at all. */
  orgDefault: { ref: string | null; name: string | null } | null;
  /** Set when the columns migration 082 adds are not there yet. The block says
   *  so in the Postgres error's own words rather than rendering empty pickers,
   *  which would read as QuickBooks having nothing to offer. */
  schemaError: string | null;
}) {
  const supabase = createClient();

  const [mappedId, setMappedId] = useState<string | null>(qboVendorId(vendor.external_ref));
  const [accountRef, setAccountRef] = useState(vendor.expense_account_ref);
  const [accountName, setAccountName] = useState(vendor.expense_account_name);
  const [qboVendors, setQboVendors] = useState<Choice[] | null>(null);
  const [accounts, setAccounts] = useState<Choice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = orgDefault !== null;

  // Both lists in one pass, like the settings block. A picker that has to be
  // told to load reads as broken until you find the button that loads it.
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      const [v, a] = await Promise.all([
        supabase.functions.invoke("qbo-sync", { body: { mode: "vendors" } }),
        supabase.functions.invoke("qbo-sync", { body: { mode: "accounts" } }),
      ]);
      if (cancelled) return;
      if (v.data?.vendors) setQboVendors(v.data.vendors as Choice[]);
      if (a.data?.accounts) setAccounts(a.data.accounts as Choice[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, supabase]);

  async function write(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { data, error: writeError } = await supabase
      .from("vendors")
      .update(patch)
      .eq("id", vendor.id)
      .select("id");
    setBusy(false);
    if (writeError) {
      setError(writeError.message);
      return false;
    }
    // Row count, not the absence of an error: below purchaser+ the policy
    // matches nothing, PostgREST reports success, and the screen would show a
    // saved value the database never took.
    if (!data || data.length === 0) {
      setError("That wasn't saved — changing a vendor is open to purchasers and above.");
      return false;
    }
    return true;
  }

  async function pickVendor(next: string) {
    const chosen = qboVendors?.find((v) => v.id === next) ?? null;
    // The whole `qbo` branch, so an id can never outlive what it was chosen as.
    const ref: AccountingRef = chosen ? { qbo: { id: chosen.id } } : {};
    if (await write({ external_ref: ref })) setMappedId(chosen?.id ?? null);
  }

  async function pickAccount(next: string) {
    const chosen = accounts?.find((a) => a.id === next) ?? null;
    if (
      await write({
        expense_account_ref: chosen?.id ?? null,
        // A SNAPSHOT (082): renaming the account in QuickBooks must not rewrite
        // what this record says it posts to.
        expense_account_name: chosen?.name ?? null,
      })
    ) {
      setAccountRef(chosen?.id ?? null);
      setAccountName(chosen?.name ?? null);
    }
  }

  /**
   * The options, and — until QuickBooks answers — the ONE option we already
   * know about.
   *
   * A `PickList` with a value and no matching option renders the raw value, so
   * for the second or two before the accounts arrive the field read "80": an
   * internal QuickBooks id, on a screen, where an account name belongs. The
   * snapshot `_name` migration 082 stores exists precisely so we never have to
   * show an id, and this is the first thing that needed it.
   */
  const accountOptions = (
    accounts ??
    (accountRef ? [{ id: accountRef, name: accountName ?? accountRef }] : [])
  ).map((a) => {
    const { parent, leaf } = splitAccountName(a.name);
    // The leaf reads as the label and its parent as the group, so
    // "Baker Items COGs" is never mistaken for a top-level account and every
    // child is filed under its own parent.
    return {
      value: a.id,
      label: leaf,
      hint: (a as Choice).type,
      group: parent ?? "Top level",
    };
  });

  const resolved = expenseAccountFor(
    { expense_account_ref: accountRef, expense_account_name: accountName },
    orgDefault
  );
  const inherited = resolved?.source === "org";

  return (
    <section className="space-y-3">
      <SectionHeading>QuickBooks</SectionHeading>

      {schemaError ? (
        <p className="max-w-2xl text-[13px] text-muted">
          {schemaError} — migration 082 has not been applied yet.
        </p>
      ) : !connected ? (
        <p className="max-w-2xl text-[13px] text-muted">
          QuickBooks is not connected. Connect it in Settings → Accounting to map
          this vendor and choose where its bills post.
        </p>
      ) : (
        <>
          <dl className="grid max-w-2xl grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
            <dt className="text-subtle">Vendor</dt>
            <dd>
              <PickList
                variant="field"
                boxed={BOXED_FIELDS}
                ariaLabel="Which QuickBooks vendor this is"
                disabled={busy}
                // Held back until the list can NAME it: with no snapshot to
                // fall back on, a value with no matching option would render
                // the bare QuickBooks vendor id.
                value={qboVendors ? mappedId : null}
                options={(qboVendors ?? []).map((v) => ({ value: v.id, label: v.name }))}
                placeholder={
                  qboVendors ? "Not linked" : mappedId ? "Reading QuickBooks…" : "Not linked"
                }
                onPick={(next) => void pickVendor(next)}
                clearable
                clearLabel="Not linked"
                panelMinWidth={320}
              />
            </dd>

            <dt className="text-subtle">Bills post to</dt>
            <dd className="space-y-1">
              <PickList
                variant="field"
                boxed={BOXED_FIELDS}
                ariaLabel="Expense account this vendor's bills post to"
                disabled={busy}
                value={accountRef}
                options={accountOptions}
                placeholder={
                  accounts
                    ? inherited
                      ? `${splitAccountName(resolved?.name).leaf || "Org default"} (default)`
                      : "Choose an account"
                    : "Reading QuickBooks…"
                }
                onPick={(next) => void pickAccount(next)}
                clearable
                clearLabel="Use the default"
                panelMinWidth={340}
              />
              {/* Say which level answered. Without it an inherited account and a
                  chosen one look identical, and changing the org default would
                  silently move this vendor's bills. */}
              {resolved && (
                <p className="text-[11px] text-faint">
                  {inherited
                    ? `Using the org default${resolved.name ? ` — ${resolved.name}` : ""}`
                    : resolved.name ?? resolved.ref}
                </p>
              )}
              {!resolved && accounts && (
                <p className="text-[11px] text-mark-ink">
                  No account set here or in Settings → Accounting, so bills cannot
                  be sent yet.
                </p>
              )}
            </dd>
          </dl>

          {!mappedId && qboVendors && (
            <p className="max-w-2xl text-[13px] text-muted">
              Bills for {vendor.name} cannot be sent until this is linked to a
              QuickBooks vendor. We never create one — pick it here, or add it in
              QuickBooks first.
            </p>
          )}
        </>
      )}

      {error && <p className="max-w-2xl text-[13px] text-accent">{error}</p>}
    </section>
  );
}
