import type { PostingShop, QboJournalEntry } from "./salesPosting";

/**
 * THE MONTHLY LABOR SPLIT — pure (migration 205).
 *
 * Gusto posts each payroll with every person's cost on the one shop (Class)
 * they are assigned to. This builds ONE journal entry per month that takes the
 * month's labor out of wherever it landed and puts it back in proportion to
 * each shop's share of the hours worked (Mark, 2026-10-14, "option 1").
 *
 * REVERSE, THEN RE-SPLIT. For each labor account, every (Class, Location)
 * bucket it was posted to is credited away and each shop is debited its share,
 * with both of the shop's refs. Netted per bucket, so a bucket that already
 * carries a shop's exact refs moves only the difference. Doing it this way
 * rather than as a delta between shops is what makes it right in BOTH
 * dimensions: Gusto sets a Class and no Location, so a "DF01 class, no
 * location" bucket has to be emptied, not adjusted. Every account nets to zero,
 * so total labor never changes — only which shop carries it.
 *
 * Money is integer cents throughout; QuickBooks' dollars appear only at the
 * payload edge.
 */

export const LABOR_DOC_PREFIX = "LABOR-";

/** One line of a QuickBooks journal entry, as `find_journal_entries` returns it. */
export type LaborEntryLine = {
  posting: string;
  amount: number;
  account_ref: string | null;
  account_name: string | null;
  class_ref?: string | null;
  class_name: string | null;
  department_ref?: string | null;
  department_name: string | null;
};

export type LaborEntry = {
  id: string;
  doc_number: string | null;
  txn_date: string;
  lines: LaborEntryLine[];
};

export type LaborAccount = { ref: string; name: string | null };

export type LaborShop = PostingShop & { id: string };

/** Labor on one account, at one (Class, Location). Signed cents: a debit — an
 *  expense — is positive. */
export type PoolBucket = {
  accountRef: string;
  accountName: string | null;
  classRef: string | null;
  className: string | null;
  departmentRef: string | null;
  departmentName: string | null;
  cents: number;
};

export type HoursRow = { location_id: string | null; hours: number };

export type ShopShare = {
  shop: LaborShop;
  hours: number;
  /** 0–1. */
  share: number;
};

export type Shares =
  | { ok: true; shares: ShopShare[]; totalHours: number; unassignedHours: number }
  | { ok: false; refusals: string[] };

export type LaborLine = {
  posting: "Debit" | "Credit";
  cents: number;
  accountRef: string;
  accountName: string | null;
  classRef: string | null;
  className: string | null;
  departmentRef: string | null;
  departmentName: string | null;
  description: string;
};

/** Per account, where the labor sits now and where it would sit after. */
export type AccountMove = {
  accountRef: string;
  accountName: string | null;
  totalCents: number;
  /** By shop id; `other` is labor on no shop's Class, or on a Class that is
   *  no shop's. */
  current: Record<string, number>;
  target: Record<string, number>;
};

export type SharesSnapshot = {
  shops: { location_id: string; code: string; hours: number; share: number }[];
  pool_cents: number;
};

export type LaborBuild =
  | {
      ok: true;
      mode: "create" | "update";
      docNumber: string;
      txnDate: string;
      lines: LaborLine[];
      moves: AccountMove[];
      poolCents: number;
      debits: number;
      warnings: string[];
      hash: string;
      snapshot: SharesSnapshot;
      /** Null when every account is already split by hours and there is
       *  nothing to post — QuickBooks refuses an entry with no lines. */
      body: QboJournalEntry | null;
    }
  | { ok: false; refusals: string[] };

export type LaborPostingRef = {
  qbo?: {
    id?: string;
    sync_token?: string;
    doc_number?: string | null;
    journal_hash?: string;
  };
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** `2026-09-01` → `LABOR-2026-09`. */
export function laborDocNumber(month: string): string {
  return `${LABOR_DOC_PREFIX}${month.slice(0, 7)}`;
}

export function isLaborDocNumber(doc: string | null | undefined): boolean {
  return Boolean(doc && doc.trim().startsWith(LABOR_DOC_PREFIX));
}

/** `2026-09-01` → `2026-09-30`. UTC arithmetic, so no time zone can move it. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `2026-09-01` → `September 2026`. */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** `2026-09-17` → `2026-09-01`. */
export function monthOf(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** The first of each month from `from` to `to` inclusive, newest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = monthOf(to).split("-").map(Number);
  const stop = monthOf(from);
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}-01`;
    if (key < stop) break;
    out.push(key);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which accounts are labor
// ---------------------------------------------------------------------------

/** A QuickBooks account as the `accounts` action returns it: `name` is the
 *  FullyQualifiedName, "Employee Payroll:Payroll Tax". */
export type QboAccount = { id: string; name: string };

/**
 * A CHOSEN ACCOUNT COVERS ITSELF AND EVERY ACCOUNT UNDER IT. QuickBooks lets a
 * parent hold postings of its own — Gusto posts payroll tax straight to
 * "Payroll Tax", which also has a sub-account (Mark, 2026-10-14) — so neither
 * "leaves only" nor "parents only" is right; the branch is. A chosen account
 * QuickBooks no longer lists is kept as itself. `qbo-sync` expands the same
 * way before it trusts a line.
 */
export function expandLaborAccounts(chosen: readonly LaborAccount[], all: readonly QboAccount[]): LaborAccount[] {
  const out = new Map<string, LaborAccount>();
  for (const c of chosen) {
    const self = all.find((a) => a.id === c.ref);
    out.set(c.ref, { ref: c.ref, name: self?.name ?? c.name });
    if (!self) continue;
    for (const a of all) {
      if (a.name.startsWith(`${self.name}:`)) out.set(a.id, { ref: a.id, name: a.name });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

function bucketKey(account: string, klass: string | null, dept: string | null): string {
  return `${account}|${klass ?? ""}|${dept ?? ""}`;
}

/**
 * Every line on a labor account, summed per (account, Class, Location). Our
 * own `LABOR-` entry is left out — it is the thing being rebuilt, and counting
 * it would make the split chase its own tail. Buckets that net to zero are
 * dropped.
 */
export function poolFromEntries(entries: readonly LaborEntry[], accounts: readonly LaborAccount[]): PoolBucket[] {
  const wanted = new Map(accounts.map((a) => [a.ref, a]));
  const buckets = new Map<string, PoolBucket>();
  for (const e of entries) {
    if (isLaborDocNumber(e.doc_number)) continue;
    for (const l of e.lines) {
      if (!l.account_ref || !wanted.has(l.account_ref)) continue;
      const sign = l.posting === "Debit" ? 1 : l.posting === "Credit" ? -1 : 0;
      if (sign === 0) continue;
      const klass = l.class_ref ?? null;
      const dept = l.department_ref ?? null;
      const key = bucketKey(l.account_ref, klass, dept);
      let b = buckets.get(key);
      if (!b) {
        b = {
          accountRef: l.account_ref,
          accountName: wanted.get(l.account_ref)?.name ?? l.account_name,
          classRef: klass,
          className: l.class_name,
          departmentRef: dept,
          departmentName: l.department_name,
          cents: 0,
        };
        buckets.set(key, b);
      }
      b.cents += sign * Math.round(Number(l.amount) * 100);
    }
  }
  return [...buckets.values()]
    .filter((b) => b.cents !== 0)
    .sort(
      (a, b) =>
        (a.accountName ?? a.accountRef).localeCompare(b.accountName ?? b.accountRef) ||
        (a.className ?? "").localeCompare(b.className ?? "") ||
        (a.departmentName ?? "").localeCompare(b.departmentName ?? "")
    );
}

// ---------------------------------------------------------------------------
// The shares
// ---------------------------------------------------------------------------

function hoursText(h: number): string {
  return h.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function percentText(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * Each shop's share of the month's hours. A shop with hours and no QuickBooks
 * Class or Location is REFUSED by name rather than dropped — dropping it would
 * hand its labor to the other shops, which is the error this whole feature
 * exists to correct. Hours on no shop at all are left out and counted, so the
 * screen can say how many.
 */
export function sharesFromHours(rows: readonly HoursRow[], shops: readonly LaborShop[]): Shares {
  const byId = new Map(shops.map((s) => [s.id, s]));
  const hoursBy = new Map<string, number>();
  let unassigned = 0;
  for (const r of rows) {
    const h = Number(r.hours) || 0;
    if (!r.location_id || !byId.has(r.location_id)) {
      unassigned += h;
      continue;
    }
    hoursBy.set(r.location_id, (hoursBy.get(r.location_id) ?? 0) + h);
  }

  const refusals: string[] = [];
  const present = [...hoursBy].filter(([, h]) => h > 0);
  for (const [id, h] of present) {
    const shop = byId.get(id)!;
    const missing = [
      shop.qbo_class_ref ? null : "class",
      shop.qbo_location_ref ? null : "location",
    ].filter(Boolean);
    if (missing.length) {
      refusals.push(
        `${shop.code} has ${hoursText(h)} hours but no QuickBooks ${missing.join(" or ")}. Set ${missing.length === 1 ? "it" : "them"} on the shop’s record.`
      );
    }
  }
  const total = present.reduce((s, [, h]) => s + h, 0);
  if (total <= 0) refusals.push("No hours were worked at any shop this month.");
  if (refusals.length) return { ok: false, refusals };

  const shares = present
    .map(([id, h]) => ({ shop: byId.get(id)!, hours: h, share: h / total }))
    .sort((a, b) => a.shop.code.localeCompare(b.shop.code));
  return { ok: true, shares, totalHours: total, unassignedHours: unassigned };
}

/**
 * `cents` split by hours, LARGEST REMAINDER, so the parts always add back to
 * the whole to the cent. Ties go to the shop listed first. Works on a negative
 * total (a month of more credits than debits) by splitting its size.
 */
export function splitCents(cents: number, shares: readonly ShopShare[]): number[] {
  const sign = cents < 0 ? -1 : 1;
  const whole = Math.abs(cents);
  const totalHours = shares.reduce((s, x) => s + x.hours, 0);
  if (shares.length === 0 || totalHours <= 0) return shares.map(() => 0);
  const exact = shares.map((x) => (whole * x.hours) / totalHours);
  const floors = exact.map(Math.floor);
  let left = whole - floors.reduce((s, x) => s + x, 0);
  const order = exact
    .map((e, i) => ({ i, rem: e - floors[i] }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((f) => sign * f);
}

// ---------------------------------------------------------------------------
// The entry
// ---------------------------------------------------------------------------

/** FNV-1a both ways over the canonical JSON — `journalHash`'s method, for the
 *  same job: "did anything change", not secrecy. */
export function laborHash(input: { docNumber: string; txnDate: string; lines: readonly LaborLine[] }): string {
  const canonical = JSON.stringify({
    d: input.docNumber,
    t: input.txnDate,
    l: input.lines.map((l) => [l.posting, l.cents, l.accountRef, l.classRef, l.departmentRef]),
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let g = 0x9747b28c;
  for (let i = canonical.length - 1; i >= 0; i--) {
    g ^= canonical.charCodeAt(i);
    g = Math.imul(g, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + g.toString(16).padStart(8, "0");
}

function amount(cents: number): number {
  return Number((Math.abs(cents) / 100).toFixed(2));
}

/** Which shop a bucket counts as on screen: its Class first (what Gusto
 *  sets), else its Location. */
function shopOfBucket(b: PoolBucket, shops: readonly ShopShare[]): string {
  const byClass = b.classRef ? shops.find((s) => s.shop.qbo_class_ref === b.classRef) : undefined;
  if (byClass) return byClass.shop.id;
  const byDept = b.departmentRef ? shops.find((s) => s.shop.qbo_location_ref === b.departmentRef) : undefined;
  return byDept ? byDept.shop.id : "other";
}

export function buildLaborJournalEntry(input: {
  /** The first of the month. */
  month: string;
  pool: readonly PoolBucket[];
  shares: Shares;
  existing: LaborPostingRef | null;
  orgName?: string | null;
}): LaborBuild {
  const { month, pool, shares } = input;
  const refusals: string[] = [];
  if (!shares.ok) refusals.push(...shares.refusals);
  if (pool.length === 0) {
    refusals.push(
      "No labor was found in this month’s QuickBooks journal entries. Check that Gusto has synced the month’s payrolls and that the labor accounts are chosen under Settings → Integrations → QuickBooks."
    );
  }
  if (!shares.ok || refusals.length) return { ok: false, refusals };

  const docNumber = laborDocNumber(month);
  const txnDate = lastDayOfMonth(month);
  const warnings: string[] = [];
  if (shares.unassignedHours > 0) {
    warnings.push(`${hoursText(shares.unassignedHours)} hours belong to no shop and are left out of the split.`);
  }

  // Per account: the total, and the signed amount per (Class, Location) that
  // takes it from where it is to where the hours say.
  const accounts = new Map<string, PoolBucket[]>();
  for (const b of pool) {
    const list = accounts.get(b.accountRef) ?? [];
    list.push(b);
    accounts.set(b.accountRef, list);
  }

  const lines: LaborLine[] = [];
  const moves: AccountMove[] = [];
  let poolCents = 0;
  for (const [accountRef, buckets] of accounts) {
    const accountName = buckets[0].accountName;
    const total = buckets.reduce((s, b) => s + b.cents, 0);
    // LABOR CANNOT BE NOTHING OR LESS. An account that nets to zero or below in
    // the month's journal entries is one whose cost arrives some other way — a
    // bill or a check, which this does not read — and whose journal entries
    // are somebody's hand reclass of that cost. Splitting it would undo the
    // reclass and leave the bill on no shop (Mark's January 2026: Workers Comp
    // netting to $0.00, Medical to −$817.02). Left alone, and said.
    if (total <= 0) {
      warnings.push(
        `${accountName ?? accountRef} is left out: its journal entries net to ${total === 0 ? "zero" : "less than zero"}, ` +
          "so its cost is paid by bill or check, which this split cannot see. Take it off the labor accounts."
      );
      continue;
    }
    poolCents += total;
    const parts = splitCents(total, shares.shares);

    const net = new Map<string, Omit<LaborLine, "posting" | "cents" | "description"> & { cents: number; shopId: string | null }>();
    const slot = (klass: string | null, kName: string | null, dept: string | null, dName: string | null, shopId: string | null) => {
      const key = bucketKey(accountRef, klass, dept);
      let s = net.get(key);
      if (!s) {
        s = { accountRef, accountName, classRef: klass, className: kName, departmentRef: dept, departmentName: dName, cents: 0, shopId };
        net.set(key, s);
      }
      if (shopId && !s.shopId) s.shopId = shopId;
      return s;
    };
    for (const b of buckets) slot(b.classRef, b.className, b.departmentRef, b.departmentName, null).cents -= b.cents;
    shares.shares.forEach((s, i) => {
      slot(s.shop.qbo_class_ref, s.shop.qbo_class_name, s.shop.qbo_location_ref, s.shop.qbo_location_name, s.shop.id).cents += parts[i];
    });

    const current: Record<string, number> = {};
    for (const b of buckets) {
      const k = shopOfBucket(b, shares.shares);
      current[k] = (current[k] ?? 0) + b.cents;
    }
    const target: Record<string, number> = {};
    shares.shares.forEach((s, i) => (target[s.shop.id] = parts[i]));
    moves.push({ accountRef, accountName, totalCents: total, current, target });

    for (const s of net.values()) {
      if (s.cents === 0) continue;
      const share = s.shopId ? shares.shares.find((x) => x.shop.id === s.shopId) : undefined;
      const where = [s.className ?? "no class", s.departmentName ?? "no location"].join(" / ");
      lines.push({
        posting: s.cents > 0 ? "Debit" : "Credit",
        cents: Math.abs(s.cents),
        accountRef: s.accountRef,
        accountName: s.accountName,
        classRef: s.classRef,
        className: s.className,
        departmentRef: s.departmentRef,
        departmentName: s.departmentName,
        description: share
          ? `Labor by hours · ${share.shop.code} ${percentText(share.share)}`
          : `Labor by hours · out of ${where}`,
      });
    }
  }

  lines.sort(
    (a, b) =>
      (a.accountName ?? a.accountRef).localeCompare(b.accountName ?? b.accountRef) ||
      (a.posting === b.posting ? 0 : a.posting === "Credit" ? -1 : 1) ||
      (a.className ?? "").localeCompare(b.className ?? "")
  );

  const debits = lines.filter((l) => l.posting === "Debit").reduce((s, l) => s + l.cents, 0);
  const credits = lines.filter((l) => l.posting === "Credit").reduce((s, l) => s + l.cents, 0);
  if (debits !== credits) {
    // Unreachable by construction; refuse rather than plug if it ever is.
    return { ok: false, refusals: [`The entry does not balance (debits ${debits}, credits ${credits}, in cents).`] };
  }

  const snapshot: SharesSnapshot = {
    shops: shares.shares.map((s) => ({ location_id: s.shop.id, code: s.shop.code, hours: s.hours, share: s.share })),
    pool_cents: poolCents,
  };
  const hash = laborHash({ docNumber, txnDate, lines });
  const id = input.existing?.qbo?.id?.trim();
  const syncToken = input.existing?.qbo?.sync_token?.trim();
  const mode: "create" | "update" = id && syncToken ? "update" : "create";

  if (lines.length === 0) {
    warnings.push("Every labor account is already split by hours, so there is nothing to post.");
  }

  const orgName = (input.orgName ?? "").trim();
  const body: QboJournalEntry | null =
    lines.length === 0
      ? null
      : {
          ...(mode === "update" ? { Id: id, SyncToken: syncToken, sparse: false } : {}),
          DocNumber: docNumber,
          TxnDate: txnDate,
          PrivateNote:
            `Labor split by hours worked · ${month.slice(0, 7)} · ` +
            shares.shares.map((s) => `${s.shop.code} ${hoursText(s.hours)} h (${percentText(s.share)})`).join(" · ") +
            (orgName ? ` · ${orgName}` : ""),
          Line: lines.map((l) => ({
            DetailType: "JournalEntryLineDetail" as const,
            Amount: amount(l.cents),
            Description: l.description,
            JournalEntryLineDetail: {
              PostingType: l.posting,
              AccountRef: { value: l.accountRef, ...(l.accountName ? { name: l.accountName } : {}) },
              ...(l.classRef ? { ClassRef: { value: l.classRef, ...(l.className ? { name: l.className } : {}) } } : {}),
              ...(l.departmentRef
                ? { DepartmentRef: { value: l.departmentRef, ...(l.departmentName ? { name: l.departmentName } : {}) } }
                : {}),
            },
          })),
        };

  return { ok: true, mode, docNumber, txnDate, lines, moves, poolCents, debits, warnings, hash, snapshot, body };
}

// ---------------------------------------------------------------------------
// The state of a month, for the list
// ---------------------------------------------------------------------------

export type LaborPostingState = "unposted" | "posted" | "failed";

export function laborPostingState(row: { external_ref: LaborPostingRef | null; post_error: string | null } | null): LaborPostingState {
  if (!row) return "unposted";
  if (row.post_error) return "failed";
  return row.external_ref?.qbo?.id ? "posted" : "unposted";
}
