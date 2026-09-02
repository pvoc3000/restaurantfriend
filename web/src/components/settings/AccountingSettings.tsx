"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeQbo } from "@/lib/qboClient";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { PickList } from "@/components/ui/PickList";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "@/components/ui/buttons";
import { confirmDialog, splitConfirmMessage } from "@/lib/confirm";

/**
 * The QuickBooks Online connection.
 *
 * A CLIENT component, unlike the two settings blocks beside it: those edit
 * `orgs.settings` through `InlineValue`, where Connect, Disconnect and
 * Reconnect are commands and the status has to be fetched at all.
 *
 * NOTHING HERE READS A TOKEN, and it could not: migration 081 gave
 * `accounting_connections` zero policies, so the row is invisible to every
 * authenticated user. What this shows comes from
 * `accounting_connection_status()`, which returns the realm, the status and the
 * dates and never the credentials.
 *
 * The account and item are written through `qbo-sync`'s `set_defaults` for the
 * same reason — that table has no policies, so a direct update would change
 * nothing and report success.
 */

export type AccountingStatus = {
  provider: string;
  status: string;
  realm_id: string | null;
  environment: string;
  bill_expense_account_ref: string | null;
  bill_expense_account_name: string | null;
  invoice_item_ref: string | null;
  invoice_item_name: string | null;
  tax_code_ref: string | null;
  tax_code_name: string | null;
  refresh_token_expires_at: string | null;
  connected_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
};

type Choice = { id: string; name: string; type?: string };

const STATUS_WORD: Record<string, string> = {
  pending: "Not finished",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Needs attention",
};

/** Short codes from `qbo-oauth`'s redirect, in the words a person can act on. */
const CALLBACK_REASON: Record<string, string> = {
  expired: "That connection link had already been used or had expired. Try again.",
  incomplete: "QuickBooks sent us back without everything we needed. Try again.",
  exchange_failed: "QuickBooks refused the connection. Check the app's keys and try again.",
  not_saved: "QuickBooks connected but the result could not be saved. Try again.",
  lookup_failed: "The connection could not be looked up. Try again.",
  access_denied: "The connection was cancelled in QuickBooks.",
};

function usDate(iso: string | null): string | null {
  if (!iso) return null;
  // Date-only slice, not `new Date()`: west of Greenwich that prints yesterday.
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
}

export function AccountingSettings({
  orgId,
  editable,
  initialStatus,
}: {
  orgId: string;
  editable: boolean;
  /** Read on the server by `accounting_connection_status()`. Seeded rather than
   *  fetched here: the two settings blocks beside this one take their data as a
   *  prop, and an effect that fetches on mount is both a flash of "Checking…"
   *  and the `set-state-in-effect` lint. Handlers re-read it explicitly. */
  initialStatus: AccountingStatus | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const params = useSearchParams();

  const [status, setStatus] = useState<AccountingStatus | null>(initialStatus);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Choice[] | null>(null);
  const [items, setItems] = useState<Choice[] | null>(null);
  const [taxCodes, setTaxCodes] = useState<Choice[] | null>(null);
  const [environment, setEnvironment] = useState(initialStatus?.environment ?? "sandbox");

  const callback = params.get("quickbooks");
  const remapped = params.get("remapped") === "1";
  const callbackReason = params.get("reason");

  /** Re-read after a write. Called from handlers, never from an effect. */
  const loadStatus = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("accounting_connection_status", {
      p_org: orgId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const row = Array.isArray(data) ? (data[0] as AccountingStatus | undefined) : undefined;
    setStatus(row ?? null);
    if (row?.environment) setEnvironment(row.environment);
  }, [orgId, supabase]);

  const call = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      const { data, message } = await invokeQbo(supabase, body);
      if (message) setError(message);
      return data;
    },
    [supabase]
  );

  const connected = status?.status === "connected";

  // Everything the connected state needs, in one pass. The company name proves
  // the connection actually works, which a stored row does not; the accounts
  // fill the picker, which is the only thing left to set. Two round trips on a
  // screen nobody opens twice a month, against a control that otherwise reads
  // as broken until you notice a button beside it.
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    void (async () => {
      const [meta, accts, its, codes] = await Promise.all([
        invokeQbo(supabase, { mode: "meta" }),
        invokeQbo(supabase, { mode: "accounts" }),
        invokeQbo(supabase, { mode: "items" }),
        invokeQbo(supabase, { mode: "tax_codes" }),
      ]);
      if (cancelled) return;
      if (its.data?.items) setItems(its.data.items as Choice[]);
      if (codes.data?.tax_codes) setTaxCodes(codes.data.tax_codes as Choice[]);
      // Same rule as the vendor block: a dropped failure here leaves a picker
      // with no options and no reason, which reads as nothing being wrong.
      const failure = meta.message ?? accts.message ?? its.message ?? codes.message;
      if (failure) setError(failure);
      if (meta.data?.company_name) setCompany(meta.data.company_name as string);
      if (accts.data?.accounts) setAccounts(accts.data.accounts as Choice[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, supabase]);

  async function connect() {
    setBusy("connect");
    setError(null);
    const res = await call({ mode: "authorize_url", environment });
    setBusy(null);
    if (!res?.url) return;
    // The current window, not a popup: this is a navigation the person asked
    // for, and `window.open` after an await is silently blocked anyway.
    window.location.href = res.url as string;
  }

  async function disconnect() {
    const ok = await confirmDialog({
      ...splitConfirmMessage(
        "Disconnect QuickBooks?\n\nNothing already in QuickBooks changes. This app " +
          "stops being able to send anything until it is connected again."
      ),
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!ok) return;
    setBusy("disconnect");
    setError(null);
    const res = await call({ mode: "disconnect" });
    setBusy(null);
    if (!res) return;
    setCompany(null);
    setAccounts(null);
    await loadStatus();
    router.refresh();
  }

  async function setDefault(kind: "bill" | "item" | "tax", choice: Choice | null) {
    setBusy("defaults");
    setError(null);
    const patch =
      kind === "bill"
        ? {
            bill_expense_account_ref: choice?.id ?? null,
            bill_expense_account_name: choice?.name ?? null,
          }
        : kind === "item"
          ? {
              invoice_item_ref: choice?.id ?? null,
              invoice_item_name: choice?.name ?? null,
            }
          : { tax_code_ref: choice?.id ?? null, tax_code_name: choice?.name ?? null };
    const res = await call({ mode: "set_defaults", ...patch });
    setBusy(null);
    if (res) await loadStatus();
  }

  const expiry = usDate(status?.refresh_token_expires_at ?? null);

  return (
    <section className="space-y-4">
      <SectionHeading>Accounting</SectionHeading>

      <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
        Approved vendor bills are sent to QuickBooks Online as Bills, so they are
        on the books and can be paid there. Nothing is collected or emailed by
        QuickBooks — this app keeps sending its own documents.
      </p>

      {callback === "connected" && (
        <p className="max-w-2xl bg-mark-fill px-2 py-1 text-[13px] text-ink">
          {remapped
            ? "QuickBooks is connected to a different company, so the expense " +
              "account here and every vendor's own mapping were cleared — their " +
              "ids belonged to the old company file. Set them again below and on " +
              "each vendor."
            : "QuickBooks is connected."}
        </p>
      )}
      {callback === "error" && (
        <p className="max-w-2xl bg-mark-fill px-2 py-1 text-[13px] text-ink">
          {CALLBACK_REASON[callbackReason ?? ""] ??
            "QuickBooks did not finish connecting. Try again."}
        </p>
      )}

      <dl className="max-w-[min(42rem,max(24rem,50%))] space-y-3 text-[13px]">
          <div className="flex items-baseline justify-between gap-6">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Status
            </dt>
            <dd className="text-ink">
              {status ? (STATUS_WORD[status.status] ?? status.status) : "Not connected"}
              {status?.environment === "sandbox" && connected ? " · sandbox" : ""}
            </dd>
          </div>

          {connected && (
            <>
              <div className="flex items-baseline justify-between gap-6">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Company
                </dt>
                <dd className="text-ink">{company ?? status?.realm_id ?? "—"}</dd>
              </div>
              {expiry && (
                <div className="flex items-baseline justify-between gap-6">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Sign-in expires
                  </dt>
                  {/* 100 days unused kills it, and a connection that dies
                      quietly is one nobody reconnects until the morning they
                      need it. */}
                  <dd className="text-ink">{expiry} unless it is used</dd>
                </div>
              )}
            </>
          )}

          {status?.last_error && (
            <div className="flex items-baseline justify-between gap-6">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                Last problem
              </dt>
              <dd className="text-ink">{status.last_error}</dd>
            </div>
          )}
      </dl>

      {connected && (
        <div className="max-w-[min(42rem,max(24rem,50%))] space-y-3 border-t border-hairline pt-4">
          <p className="text-[13px] text-muted">
            Each bill is sent as one line at its total, against this account.
          </p>
          <div className="flex items-baseline justify-between gap-6">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Expense account
            </span>
            <PickList
              variant="field"
              boxed
              ariaLabel="Expense account bills post to"
              disabled={!editable || busy !== null}
              value={status?.bill_expense_account_ref ?? null}
              placeholder={accounts ? "Choose an account" : "Reading QuickBooks…"}
              options={(accounts ?? []).map((a) => ({
                value: a.id,
                label: a.name,
                hint: a.type,
              }))}
              onPick={(next) =>
                void setDefault("bill", accounts?.find((a) => a.id === next) ?? null)
              }
              panelMinWidth={320}
            />
          </div>
        </div>
      )}

      {connected && (
        <div className="max-w-[min(42rem,max(24rem,50%))] space-y-3 border-t border-hairline pt-4">
          <p className="text-[13px] text-muted">
            A customer invoice is sent as its net amount under this item, and
            QuickBooks works out the sales tax from this code — it will not
            accept ours.
          </p>
          <div className="flex items-baseline justify-between gap-6">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Invoice item
            </span>
            <PickList
              variant="field"
              boxed
              ariaLabel="Item customer invoices are sent under"
              disabled={!editable || busy !== null}
              value={status?.invoice_item_ref ?? null}
              placeholder={items && items.length === 0 ? "No items in QuickBooks" : "Choose an item"}
              options={(items ?? []).map((i) => ({ value: i.id, label: i.name, hint: i.type }))}
              onPick={(next) => void setDefault("item", items?.find((i) => i.id === next) ?? null)}
              panelMinWidth={320}
            />
          </div>
          <div className="flex items-baseline justify-between gap-6">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              Tax code
            </span>
            <PickList
              variant="field"
              boxed
              ariaLabel="Tax code customer invoices are sent under"
              disabled={!editable || busy !== null}
              value={status?.tax_code_ref ?? null}
              placeholder={
                taxCodes && taxCodes.length === 0
                  ? "No tax codes in QuickBooks"
                  : "Choose a tax code"
              }
              options={(taxCodes ?? []).map((t) => ({ value: t.id, label: t.name }))}
              onPick={(next) => void setDefault("tax", taxCodes?.find((t) => t.id === next) ?? null)}
              panelMinWidth={320}
            />
          </div>
        </div>
      )}

      {error && <p className="max-w-2xl text-[13px] text-accent">{error}</p>}

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          {!connected && (
            <PickList
              variant="field"
              boxed
              ariaLabel="Which QuickBooks environment"
              value={environment}
              options={[
                { value: "sandbox", label: "Sandbox", hint: "a test company" },
                { value: "production", label: "Production", hint: "the real books" },
              ]}
              onPick={setEnvironment}
              disabled={busy !== null}
            />
          )}
          <button
            type="button"
            className={connected ? BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
            disabled={busy !== null}
            onClick={() => void connect()}
          >
            {busy === "connect"
              ? "Opening QuickBooks…"
              : connected
                ? "Reconnect"
                : "Connect to QuickBooks"}
          </button>
          {status && status.status !== "disconnected" && (
            <button
              type="button"
              className={DANGER_BUTTON_CLASS}
              disabled={busy !== null}
              onClick={() => void disconnect()}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
