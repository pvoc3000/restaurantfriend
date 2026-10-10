"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { ActiveToggle } from "@/components/catalog/ActiveToggle";
import { InlineValue } from "@/components/catalog/InlineValue";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BUTTON_CLASS } from "@/components/ui/buttons";
import { TextInput } from "@/components/ui/TextInput";
import { PickSet } from "@/components/ui/PickSet";
import { Checkbox } from "@/components/ui/Checkbox";
import { RowMenu } from "@/components/ui/RowMenu";
import { confirmDialog } from "@/lib/confirm";
import { mintTokenValue } from "@/lib/specialOrderSend";
import { entryShops } from "@/lib/blackoutDates";
import {
  FEED_LAYERS,
  feedCarriesOrders,
  feedLayersLabel,
  feedUrl,
  type CalendarSubscription,
  type FeedLink,
} from "@/lib/calendarFeeds";

type Shop = { id: string; code: string; name: string };

/** A subscription with its last-read time already said in the org's clock —
 *  formatted on the server, so the browser's timezone cannot disagree. */
export type SubscriptionRow = CalendarSubscription & { last_read: string | null };

/**
 * Settings → Integrations → Calendars: outside calendars coming IN, and the
 * app's own calendar going OUT (migrations 186 and 185).
 *
 * BOTH HALVES HANDLE A SECRET, and neither shows it again.
 *
 * An outside calendar's iCal address lets whoever holds it read that calendar,
 * so it is written through `set_calendar_subscription_url` into a table no
 * member can read, and this screen only ever knows that one has been set.
 *
 * A published feed's link lets whoever holds it read the feed, so the list is
 * visible to managers and owners only (185's policies) and a link is REVOKED
 * rather than edited: the layers and shops it carries were chosen when it was
 * handed out, and changing them under somebody's phone is a surprise.
 */
export function CalendarSettings({
  orgId,
  editable,
  shops,
  subscriptions,
  links,
  loadError,
}: {
  orgId: string;
  editable: boolean;
  shops: Shop[];
  subscriptions: SubscriptionRow[];
  links: FeedLink[];
  loadError: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<"subscription" | "link" | null>(null);
  const [addressFor, setAddressFor] = useState<SubscriptionRow | null>(null);

  if (loadError) {
    return (
      <p className="max-w-2xl text-[13px] text-accent">
        Could not load the calendars: {loadError}
        {/calendar_(subscriptions|feed_links)/.test(loadError)
          ? " — migrations 185 and 186 have not been applied yet."
          : ""}
      </p>
    );
  }

  function refresh(sub: SubscriptionRow) {
    setFailed(null);
    setNotice(null);
    startTransition(async () => {
      const { data, error } = await supabase.functions.invoke("calendar-sync", {
        body: { subscription_id: sub.id, force: true },
      });
      const result = ((data ?? {}) as { results?: { state: string; events?: number; error?: string }[] })
        .results?.[0];
      if (error || !result) setFailed(`Could not read ${sub.name}.`);
      else if (result.state === "error") setFailed(`${sub.name}: ${result.error}`);
      else setNotice(`${sub.name}: ${result.events ?? 0} events read.`);
      router.refresh();
    });
  }

  async function removeSubscription(sub: SubscriptionRow) {
    const ok = await confirmDialog({
      title: `Remove “${sub.name}”?`,
      body: "Its events come off the calendar. The outside calendar itself is not touched.",
      tone: "danger",
      confirmLabel: "Remove it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { error } = await supabase.from("calendar_subscriptions").delete().eq("id", sub.id);
      if (error) setFailed(error.message);
      router.refresh();
    });
  }

  async function copyLink(link: FeedLink) {
    setFailed(null);
    try {
      await navigator.clipboard.writeText(feedUrl(window.location.origin, link.token));
      setNotice(`Copied the address for “${link.label}”.`);
    } catch {
      setFailed("The browser would not copy it. Open the link's row and copy the address by hand.");
    }
  }

  async function revoke(link: FeedLink) {
    const ok = await confirmDialog({
      title: `Revoke “${link.label}”?`,
      body: "Every calendar subscribed to this address stops updating, and the address cannot be turned back on. Make a new link to replace it.",
      tone: "danger",
      confirmLabel: "Revoke it",
    });
    if (!ok) return;
    setFailed(null);
    startTransition(async () => {
      const { data, error } = await supabase
        .from("calendar_feed_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", link.id)
        .select("id");
      if (error) setFailed(error.message);
      else if (!data?.length) setFailed("The link was not revoked — the database refused it.");
      router.refresh();
    });
  }

  const subscriptionColumns: DataColumn<SubscriptionRow>[] = [
    {
      key: "active",
      label: "Active",
      width: 90,
      sortValue: (s) => (s.is_active ? 0 : 1),
      render: (s) => (
        <ActiveToggle
          table="calendar_subscriptions"
          id={s.id}
          active={s.is_active}
          control="switch"
          readOnly={!editable}
        />
      ),
    },
    {
      key: "name",
      label: "Calendar",
      width: 260,
      pinned: true,
      sortValue: (s) => s.name,
      render: (s) =>
        editable ? (
          <InlineValue table="calendar_subscriptions" id={s.id} column="name" value={s.name} nullable={false} />
        ) : (
          s.name
        ),
    },
    {
      key: "shops",
      label: "Shops",
      width: 150,
      sortValue: (s) => entryShops(s, shops),
      render: (s) => entryShops(s, shops),
    },
    {
      key: "read",
      label: "Last read",
      width: 190,
      sortValue: (s) => s.last_fetched_at ?? "",
      render: (s) =>
        s.last_read ? (
          <span className="tabular-nums">{s.last_read}</span>
        ) : (
          <span className="text-faint">Never</span>
        ),
    },
    {
      key: "status",
      label: "Status",
      width: 420,
      sortValue: (s) => s.last_error ?? "",
      render: (s) =>
        !s.has_url ? (
          <span className="bg-mark-fill px-1">No address set</span>
        ) : s.last_error ? (
          <span className="text-accent">{s.last_error}</span>
        ) : s.last_fetched_at ? (
          "Reading"
        ) : (
          <span className="text-muted">Not read yet</span>
        ),
    },
    ...(editable
      ? [
          {
            key: "menu",
            label: "",
            width: 48,
            align: "right" as const,
            render: (s: SubscriptionRow) => (
              <RowMenu
                label={`Actions for ${s.name}`}
                items={[
                  { label: "Refresh now", onSelect: () => refresh(s) },
                  { label: "Change address…", onSelect: () => setAddressFor(s) },
                  { label: "Remove", danger: true, onSelect: () => void removeSubscription(s) },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  const linkColumns: DataColumn<FeedLink>[] = [
    {
      key: "label",
      label: "Link",
      width: 240,
      pinned: true,
      sortValue: (l) => l.label,
      render: (l) => <span className={l.revoked_at ? "text-muted line-through" : ""}>{l.label}</span>,
    },
    {
      key: "carries",
      label: "Carries",
      width: 420,
      sortValue: (l) => feedLayersLabel(l.layers),
      render: (l) => feedLayersLabel(l.layers),
    },
    {
      key: "shops",
      label: "Shops",
      width: 150,
      sortValue: (l) => entryShops(l, shops),
      render: (l) => entryShops(l, shops),
    },
    {
      key: "names",
      label: "Customer names",
      width: 130,
      sortValue: (l) => (l.include_customer_names ? 0 : 1),
      render: (l) => (l.include_customer_names ? "Yes" : "No"),
    },
    {
      key: "status",
      label: "Status",
      width: 170,
      sortValue: (l) => l.revoked_at ?? "",
      render: (l) =>
        l.revoked_at ? (
          <span className="text-muted">Revoked {l.revoked_at.slice(0, 10)}</span>
        ) : (
          "Live"
        ),
    },
    {
      key: "menu",
      label: "",
      width: 48,
      align: "right",
      render: (l) =>
        l.revoked_at ? null : (
          <RowMenu
            label={`Actions for ${l.label}`}
            items={[
              { label: "Copy address", onSelect: () => void copyLink(l) },
              { label: "Revoke", danger: true, onSelect: () => void revoke(l) },
            ]}
          />
        ),
    },
  ];

  return (
    <div className="space-y-12">
      {(failed || notice) && (
        <p className="text-sm">
          {failed ? (
            <span className="text-accent">{failed}</span>
          ) : (
            <span className="bg-mark-fill px-1">{notice}</span>
          )}
        </p>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <SectionHeading count={subscriptions.length}>Calendars shown on the calendar</SectionHeading>
          {editable && (
            <button type="button" onClick={() => setAdding("subscription")} disabled={pending} className={BUTTON_CLASS}>
              Subscribe to a calendar
            </button>
          )}
        </div>
        <DataTable
          rows={subscriptions}
          columns={subscriptionColumns}
          rowKey={(s) => s.id}
          storageKey="rf.calendarSubscriptions.v1"
          empty={
            <p className="max-w-[70ch] text-sm text-muted">
              No outside calendars yet. Any calendar with an iCal address works. In Google
              Calendar it is under the calendar&rsquo;s settings, as &ldquo;Secret address in iCal
              format&rdquo;.
            </p>
          }
        />
      </section>

      {editable && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <SectionHeading count={links.filter((l) => !l.revoked_at).length}>
              Links that publish this calendar
            </SectionHeading>
            <button type="button" onClick={() => setAdding("link")} disabled={pending} className={BUTTON_CLASS}>
              New link
            </button>
          </div>
          <DataTable
            rows={links}
            columns={linkColumns}
            rowKey={(l) => l.id}
            storageKey="rf.calendarFeedLinks.v1"
            empty={
              <p className="max-w-[70ch] text-sm text-muted">
                No links yet. A link is an address a phone or desktop calendar subscribes to.
                Anyone holding it can read what it carries, so make one per person and revoke it
                when they no longer need it.
              </p>
            }
          />
        </section>
      )}

      {adding === "subscription" && (
        <SubscriptionDialog orgId={orgId} shops={shops} onClose={() => setAdding(null)} />
      )}
      {addressFor && (
        <SubscriptionDialog
          orgId={orgId}
          shops={shops}
          existing={addressFor}
          onClose={() => setAddressFor(null)}
        />
      )}
      {adding === "link" && <LinkDialog orgId={orgId} shops={shops} onClose={() => setAdding(null)} />}
    </div>
  );
}

/**
 * Subscribe to an outside calendar, or give an existing one a new address.
 *
 * Three steps behind one button, in the only order that works: the row (so
 * there is something to attach an address to), the address through the definer
 * function (so it never sits in a readable table), then a first read — because
 * "added" with nothing on the calendar looks exactly like "broken".
 */
function SubscriptionDialog({
  orgId,
  shops,
  existing,
  onClose,
}: {
  orgId: string;
  shops: Shop[];
  existing?: SubscriptionRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<string[]>(existing?.location_ids ?? []);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);

  const ready = name.trim() !== "" && /^(https|webcals?):\/\/\S+\.\S+/i.test(url.trim());

  function save() {
    if (!ready) return;
    setFailed(null);
    startTransition(async () => {
      let id = existing?.id ?? null;
      if (!id) {
        const { data, error } = await supabase
          .from("calendar_subscriptions")
          .insert({ org_id: orgId, name: name.trim(), location_ids: picked })
          .select("id")
          .single();
        if (error || !data) {
          setFailed(error?.message ?? "The calendar was not added.");
          return;
        }
        id = data.id as string;
      }
      const { error: urlError } = await supabase.rpc("set_calendar_subscription_url", {
        p_subscription_id: id,
        p_url: url.trim(),
      });
      if (urlError) {
        setFailed(urlError.message);
        router.refresh();
        return;
      }
      const { data: synced } = await supabase.functions.invoke("calendar-sync", {
        body: { subscription_id: id, force: true },
      });
      const result = ((synced ?? {}) as { results?: { state: string; error?: string }[] }).results?.[0];
      router.refresh();
      if (result?.state === "error") {
        // Saved, and said so: the row is in the list with this same sentence.
        setFailed(`Saved, but it could not be read: ${result.error}`);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog
      title={existing ? `New address for ${existing.name}` : "Subscribe to a calendar"}
      onClose={() => {
        if (!pending) onClose();
      }}
      busy={pending}
      width="max-w-2xl"
      onSubmit={ready && !pending ? save : undefined}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className={DIALOG_CANCEL_CLASS}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={!ready || pending} className={DIALOG_COMMIT_CLASS}>
            {pending ? "Reading…" : existing ? "Save and read" : "Subscribe"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {!existing && (
          <Field label="Name" required>
            <TextInput value={name} onValueChange={setName} aria-label="Calendar name" autoFocus className="w-full" />
          </Field>
        )}
        <Field label="iCal address" required>
          <TextInput
            value={url}
            onValueChange={setUrl}
            aria-label="iCal address"
            placeholder="https://… or webcal://…"
            autoFocus={Boolean(existing)}
            autoComplete="off"
            spellCheck={false}
            className="w-full"
          />
        </Field>
        {!existing && (
          <Field label="Shops">
            <PickSet
              options={shops.map((l) => ({ value: l.id, label: l.code, hint: l.name }))}
              value={picked}
              onChange={setPicked}
              allLabel="All shops"
              label="Which shops this calendar is about"
              noun="shops"
              boxed
            />
          </Field>
        )}
        <p className="max-w-[60ch] text-sm text-muted">
          The address is stored where nobody can read it back, so keep your own copy if you
          will need it again.
        </p>
        {failed && <p className="text-sm text-accent">{failed}</p>}
      </div>
    </Dialog>
  );
}

/** A new published link. Once made it shows its address, to copy. */
function LinkDialog({ orgId, shops, onClose }: { orgId: string; shops: Shop[]; onClose: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const [label, setLabel] = useState("");
  const [layers, setLayers] = useState<string[]>(["entries"]);
  const [picked, setPicked] = useState<string[]>([]);
  const [names, setNames] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ready = label.trim() !== "" && layers.length > 0;

  function create() {
    if (!ready) return;
    setFailed(null);
    const token = mintTokenValue();
    startTransition(async () => {
      const { error } = await supabase.from("calendar_feed_links").insert({
        org_id: orgId,
        token,
        label: label.trim(),
        layers,
        location_ids: picked,
        include_customer_names: names && feedCarriesOrders(layers),
      });
      if (error) {
        setFailed(error.message);
        return;
      }
      setMade(feedUrl(window.location.origin, token));
      router.refresh();
    });
  }

  async function copy() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made);
      setCopied(true);
    } catch {
      setFailed("The browser would not copy it — select the address and copy it by hand.");
    }
  }

  return (
    <Dialog
      title={made ? "Link made" : "New calendar link"}
      onClose={() => {
        if (!pending) onClose();
      }}
      busy={pending}
      width="max-w-2xl"
      onSubmit={!made && ready && !pending ? create : undefined}
      footer={
        made ? (
          <>
            <button type="button" onClick={onClose} className={DIALOG_CANCEL_CLASS}>
              Done
            </button>
            <button type="button" onClick={() => void copy()} className={DIALOG_COMMIT_CLASS}>
              {copied ? "Copied" : "Copy address"}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onClose} disabled={pending} className={DIALOG_CANCEL_CLASS}>
              Cancel
            </button>
            <button type="button" onClick={create} disabled={!ready || pending} className={DIALOG_COMMIT_CLASS}>
              {pending ? "Making…" : "Make link"}
            </button>
          </>
        )
      }
    >
      {made ? (
        <div className="space-y-4">
          <p className="break-all border border-ink bg-white px-3 py-2 font-mono text-[13px]">{made}</p>
          <p className="max-w-[60ch] text-sm text-muted">
            Add it to a calendar app as a subscription (Apple Calendar: File, New Calendar
            Subscription. Google Calendar: Other calendars, From URL). Google re-reads a
            subscribed calendar about twice a day.
          </p>
          {failed && <p className="text-sm text-accent">{failed}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          <Field label="Who or what it is for" required>
            <TextInput value={label} onValueChange={setLabel} aria-label="Link label" autoFocus className="w-full" />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-subtle">
              It carries <span className="text-accent">*</span>
            </legend>
            {FEED_LAYERS.map((l) => (
              <Checkbox
                key={l.key}
                checked={layers.includes(l.key)}
                onChange={(next) =>
                  setLayers((prev) => (next ? [...prev, l.key] : prev.filter((k) => k !== l.key)))
                }
              >
                {l.label}
              </Checkbox>
            ))}
          </fieldset>
          <Field label="Shops">
            <PickSet
              options={shops.map((l) => ({ value: l.id, label: l.code, hint: l.name }))}
              value={picked}
              onChange={setPicked}
              allLabel="All shops"
              label="Which shops the link is for"
              noun="shops"
              boxed
            />
          </Field>
          {feedCarriesOrders(layers) && (
            <Checkbox checked={names} onChange={setNames}>
              Include customer names on special orders
            </Checkbox>
          )}
          {failed && <p className="text-sm text-accent">{failed}</p>}
        </div>
      )}
    </Dialog>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}
