"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineValue } from "@/components/catalog/InlineValue";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Switch } from "@/components/ui/Switch";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { useLatestWrite } from "@/lib/latestWrite";
import { ROLE_LABEL } from "@/lib/roles";
import { readSalesRunSettings, type SalesRun } from "@/lib/salesRun";

type Settings = Record<string, unknown>;

export type RunMember = { user_id: string; display_name: string | null; role: string };

/**
 * THE MORNING SALES RUN'S SETTINGS (Mark, 2026-10-29) — `sales-nightly`, which
 * syncs from Square, posts to QuickBooks and emails the summary at 7 AM.
 *
 * Two choices and nothing else:
 *   · whether it runs — `orgs.settings.sales_automation.enabled`, off until
 *     somebody turns it on;
 *   · which member it signs in as — `bot_user_id`. The run does what the Sales
 *     screen does, AS a member, so every permission check applies to it
 *     unchanged and its posts carry that member's name. A member of its own,
 *     made for the purpose, keeps "who posted this" honest.
 *
 * WHO GETS THE EMAIL IS NOT A SETTING: the owner and managers, by role — the
 * shift report's rule, so there is no list to forget a leaver on. Stated here
 * so nobody looks for the box.
 */
export function MorningRunSettings({
  orgId,
  settings,
  editable,
  members,
  lastRun,
  timeZone,
}: {
  orgId: string;
  settings: Settings;
  editable: boolean;
  /** Purchasers and above — the roles that may sync and post. */
  members: RunMember[];
  /** The latest run of any kind, test runs included. */
  lastRun: SalesRun | null;
  timeZone: string;
}) {
  const router = useRouter();
  const current = readSalesRunSettings(settings);
  const [enabled, setEnabled] = useState(current.enabled);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // The settings column is rewritten whole (PostgREST cannot `jsonb_set`), so
  // the document is read fresh first rather than taken from the page's props,
  // which may be a minute old.
  const saveEnabled = useLatestWrite<boolean>(
    async (next) => {
      const supabase = createClient();
      const { data: org, error: readErr } = await supabase.from("orgs").select("settings").eq("id", orgId).maybeSingle();
      if (readErr || !org) return readErr?.message ?? "the org could not be read";
      const doc = structuredClone((org.settings ?? {}) as Settings);
      const block = (doc.sales_automation && typeof doc.sales_automation === "object" ? doc.sales_automation : {}) as Settings;
      doc.sales_automation = { ...block, enabled: next };
      const { data, error: writeErr } = await supabase.from("orgs").update({ settings: doc }).eq("id", orgId).select("id");
      if (writeErr) return writeErr.message;
      return data && data.length ? null : "not saved";
    },
    (failure) => {
      if (failure) {
        setError(failure);
        setEnabled(readSalesRunSettings(settings).enabled);
      }
      router.refresh();
    }
  );

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    const supabase = createClient();
    const { data, error: fnError } = await supabase.functions.invoke("sales-nightly", { body: { dry_run: true } });
    let message: string;
    if (fnError) {
      message = fnError.message;
      try {
        const parsed = await (fnError as { context?: Response }).context?.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        /* keep the SDK's message */
      }
    } else {
      const r = (data ?? {}) as { emailed?: boolean; email_error?: string | null };
      message = r.emailed ? "Sent. Nothing was synced or posted." : `Not sent: ${r.email_error ?? "unknown reason"}`;
    }
    setTestResult(message);
    setTesting(false);
    router.refresh();
  }

  const options = members
    .slice()
    .sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""))
    .map((m) => ({
      value: m.user_id,
      label: m.display_name ?? "(no name)",
      hint: ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role,
    }));
  const bot = members.find((m) => m.user_id === current.botUserId);

  const when = lastRun
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(lastRun.finished_at ?? lastRun.started_at))
    : null;
  const lastWords = !lastRun
    ? "never"
    : `${when} · ${lastRun.dry_run ? "test" : lastRun.trigger === "cron" ? "7 AM" : "Run Now"} · ${
        lastRun.status === "ok"
          ? "all posted"
          : lastRun.status === "running"
            ? "running"
            : `${lastRun.problems.length} ${lastRun.problems.length === 1 ? "issue" : "issues"}`
      }`;

  const row = "grid grid-cols-[10rem_1fr] items-baseline gap-x-6";
  const term = "text-xs font-semibold uppercase tracking-[0.08em] text-muted";

  return (
    <section className="space-y-4">
      <SectionHeading>Morning Sales Run</SectionHeading>

      <dl className="max-w-[min(42rem,max(24rem,50%))] space-y-3">
        <div className={row}>
          <dt className={term}>Runs at 7 AM</dt>
          <dd>
            <Switch
              checked={enabled}
              disabled={!editable}
              label="Run the morning sales run at 7 AM"
              onChange={(next) => {
                setError(null);
                setEnabled(next);
                saveEnabled(next);
              }}
            />
          </dd>
        </div>

        <div className={row}>
          <dt className={term}>Signs in as</dt>
          <dd>
            {editable ? (
              <InlineValue
                table="orgs"
                id={orgId}
                column="bot_user_id"
                jsonColumn="settings"
                jsonPath={["sales_automation", "bot_user_id"]}
                jsonDocument={settings}
                value={current.botUserId}
                kind="pick"
                clearable
                options={options}
                boxed
                placeholder="Choose a member"
                emptyClassName="text-accent"
                ariaLabel="The member the morning run signs in as"
              />
            ) : (
              <span className="text-sm">{bot?.display_name ?? "—"}</span>
            )}
          </dd>
        </div>

        <div className={row}>
          <dt className={term}>Emails</dt>
          <dd className="text-sm">The owner and managers</dd>
        </div>

        <div className={row}>
          <dt className={term}>Last run</dt>
          <dd className="text-sm">{lastWords}</dd>
        </div>
      </dl>

      {error ? <p className="text-sm text-accent">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={BUTTON_CLASS} onClick={sendTest} disabled={testing}>
          {testing ? "Sending…" : "Send a Test Email"}
        </button>
        {testResult ? <span className="text-sm">{testResult}</span> : null}
      </div>

      <p className="max-w-xl text-sm text-muted">
        The schedule and its secret are set up once — see <code>docs/quickbooks-sales-setup.md</code>.
      </p>
    </section>
  );
}
