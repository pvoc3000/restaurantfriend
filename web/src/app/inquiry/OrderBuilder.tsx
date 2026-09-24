"use client";

import { useMemo, useState } from "react";

import {
  alignAssign,
  newLetterRequest,
  unassignedLetters,
  money,
  splitMessage,
  type Basket,
  type BasketLine,
  type BasketProblem,
  type InquiryCategory,
  type InquiryEstimate,
  type InquiryMenuItem,
  type InquiryMinimums,
  type LetterRequest,
} from "@/lib/inquiryOrder";

/**
 * BUILD YOUR ORDER — special orders 4b (Mark, 2026-09-24).
 *
 * Four cards, one per thing the form sells, each opening a list of flavours
 * with prices. It is OPTIONAL and it sits ABOVE the description box, never
 * instead of it: most of this shop's work is custom, and the box is where
 * everything this can't model still goes.
 *
 * The page's public dress, not the app's parts table (see `InquiryForm`'s
 * header): raw controls, `h-12`, 16px text so iOS Safari does not zoom on
 * focus, and native `<select>`s, which on a phone are the platform's wheel.
 */

const TITLES: Record<InquiryCategory, { title: string; unit: string; units: string }> = {
  regular: { title: "Donuts", unit: "donut", units: "donuts" },
  mini: { title: "Mini donuts", unit: "mini", units: "minis" },
  giant: { title: "Giant donuts", unit: "giant donut", units: "giant donuts" },
  letter: { title: "Donut letters", unit: "letter", units: "letters" },
  extra: { title: "Extras", unit: "extra", units: "extras" },
};

/**
 * The stepper's step. Minis come at least six of a flavour, so + goes by six;
 * regular donuts are ordered by the half dozen often enough that the same step
 * saves taps. A giant is one at a time. The number box takes ANY quantity —
 * the step is a convenience, never a rule.
 */
const STEP: Record<Exclude<InquiryCategory, "letter">, number> = { regular: 6, mini: 6, giant: 1, extra: 1 };

/** A letters request's React key — never sent, only has to be unique here. */
let keySeq = 0;
const nextKey = () => `letters-${++keySeq}`;

/** Long lists get a filter box; four giants do not need one. */
const FILTER_FROM = 12;

export function OrderBuilder({
  menu,
  basket,
  onChange,
  minimums,
}: {
  menu: InquiryMenuItem[];
  basket: Basket;
  onChange: (next: Basket) => void;
  minimums: InquiryMinimums;
}) {
  const [open, setOpen] = useState<Set<InquiryCategory>>(new Set());

  const byCategory = useMemo(() => {
    const m = new Map<InquiryCategory, InquiryMenuItem[]>();
    for (const item of menu) m.set(item.category, [...(m.get(item.category) ?? []), item]);
    return m;
  }, [menu]);

  function toggle(cat: InquiryCategory) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
    // Opening Letters for the first time starts a message rather than showing
    // an empty panel with an "Add" button — the first thing you do there.
    if (cat === "letter" && basket.letters.length === 0) {
      onChange({ ...basket, letters: [newLetterRequest(nextKey())] });
    }
  }

  function setQty(id: string, qty: number) {
    onChange({ ...basket, qty: { ...basket.qty, [id]: Math.max(0, Math.min(2000, Math.floor(qty) || 0)) } });
  }

  function countOf(cat: InquiryCategory): number {
    if (cat === "letter") {
      return basket.letters.reduce(
        (a, r) => a + splitMessage(r.message).characters.length * Math.max(0, Math.floor(r.sets || 0)),
        0
      );
    }
    return (byCategory.get(cat) ?? []).reduce((a, m) => a + (basket.qty[m.id] ?? 0), 0);
  }

  function minimumText(cat: InquiryCategory): string {
    if (cat === "extra") return "";
    if (cat === "mini") {
      return `${minimums.mini} minimum, ${minimums.mini_per_flavor} per flavor`;
    }
    const n = minimums[cat];
    if (n <= 1) return cat === "giant" ? "Order just one if you like" : "";
    return `${n} minimum`;
  }

  // EXTRAS LAST (Mark, 2026-09-24: "a section at the end of the inquiry form
  // for misc items like catering platters, utensils") — migration 134.
  const categories = (["regular", "mini", "giant", "letter", "extra"] as const).filter(
    (c) => (byCategory.get(c) ?? []).length > 0
  );

  return (
    <section className="space-y-3" aria-labelledby="build-heading">
      <div className="space-y-1">
        <h2 id="build-heading" className="text-[12px] uppercase tracking-[0.12em] text-subtle">
          Build your order
        </h2>
        <p className="text-[14px] leading-relaxed text-muted">
          Choose what you’d like and we’ll quote it. Would you rather describe it?
          Skip to the box below.
        </p>
      </div>

      {categories.map((cat) => {
        const items = byCategory.get(cat) ?? [];
        const count = countOf(cat);
        const isOpen = open.has(cat);
        const priced = items.filter((i) => !i.quoted);
        const from = priced.length ? Math.min(...priced.map((i) => i.price)) : null;
        const min = minimumText(cat);
        const subtitle =
          cat === "extra"
            ? "Platters, utensils and more"
            : `from ${money(from ?? 0)} each${min ? ` · ${min}` : ""}`;
        return (
          <div key={cat} className="border border-ink">
            <button
              type="button"
              onClick={() => toggle(cat)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-100"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold uppercase tracking-[0.04em]">
                  {TITLES[cat].title}
                </span>
                <span className="block text-[13px] text-muted">{subtitle}</span>
              </span>
              {count > 0 && (
                <span className="shrink-0 bg-ink px-2 py-0.5 text-[13px] font-semibold tabular-nums text-white">
                  {count}
                </span>
              )}
              <span aria-hidden className="shrink-0 text-[18px] leading-none">
                {isOpen ? "−" : "+"}
              </span>
            </button>

            {isOpen &&
              (cat === "letter" ? (
                <LettersPanel
                  flavors={items}
                  requests={basket.letters}
                  onChange={(letters) => onChange({ ...basket, letters })}
                />
              ) : (
                <FlavorList
                  items={items}
                  qty={basket.qty}
                  step={STEP[cat]}
                  unit={TITLES[cat].units}
                  onQty={setQty}
                />
              ))}
          </div>
        );
      })}
    </section>
  );
}

/* ==========================================================================
 * Donuts, minis and giants
 * ========================================================================== */

function FlavorList({
  items,
  qty,
  step,
  unit,
  onQty,
}: {
  items: InquiryMenuItem[];
  qty: Record<string, number>;
  step: number;
  unit: string;
  onQty: (id: string, qty: number) => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = filterItems(items, filter);
  return (
    <div className="border-t border-ink">
      {items.length >= FILTER_FROM && (
        <div className="border-b border-hairline px-4 py-3">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a flavor"
            aria-label={`Find a flavor among the ${unit}`}
            className="h-12 w-full border border-ink px-3 text-[16px] outline-none focus:border-2"
          />
        </div>
      )}
      <ul className="max-h-[28rem] divide-y divide-hairline overflow-y-auto">
        {shown.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[16px] leading-snug">{item.name}</div>
              <div className="text-[14px] tabular-nums text-muted">
                {item.quoted ? "Priced in your quote" : `${money(item.price)} each`}
              </div>
              {item.description && (
                <p className="mt-1 text-[13px] leading-snug text-muted">{item.description}</p>
              )}
            </div>
            <Stepper
              value={qty[item.id] ?? 0}
              step={step}
              // The SIZE is in the name, because Angry Samoa is on three of
              // these lists and a screen reader otherwise hears three identical
              // "How many Angry Samoa" boxes.
              label={`${item.name} ${unit}`}
              onChange={(n) => onQty(item.id, n)}
            />
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-4 py-3 text-[14px] text-muted">
            Nothing matches “{filter}”. Tell us about it in the box below.
          </li>
        )}
      </ul>
    </div>
  );
}

function filterItems(items: InquiryMenuItem[], filter: string): InquiryMenuItem[] {
  const f = filter.trim().toLowerCase();
  if (!f) return items;
  return items.filter(
    (i) => i.name.toLowerCase().includes(f) || (i.description ?? "").toLowerCase().includes(f)
  );
}

function Stepper({
  value,
  step,
  label,
  onChange,
}: {
  value: number;
  step: number;
  label: string;
  onChange: (n: number) => void;
}) {
  // Down to the step below rather than by the step, so 8 → 6 → 0 rather than
  // 8 → 2: a stepper that lands on a quantity nobody asked for is a bug report.
  const down = value <= 0 ? 0 : value % step === 0 ? value - step : value - (value % step);
  const up = value - (value % step) + step;
  return (
    <div className="flex shrink-0 items-center border border-ink">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, down))}
        disabled={value <= 0}
        aria-label={`Fewer ${label}`}
        className="h-12 w-11 text-[20px] leading-none transition-colors hover:bg-neutral-100 disabled:opacity-35"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={2000}
        value={value === 0 ? "" : value}
        placeholder="0"
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`How many ${label}`}
        className="h-12 w-14 border-x border-ink text-center text-[16px] tabular-nums outline-none [appearance:textfield] focus:bg-neutral-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(up)}
        aria-label={`More ${label}`}
        className="h-12 w-11 text-[20px] leading-none transition-colors hover:bg-neutral-100"
      >
        +
      </button>
    </div>
  );
}

/* ==========================================================================
 * Letters
 * ========================================================================== */

/**
 * LETTERS TAKE A MESSAGE, NOT A LETTER AT A TIME (Mark, 2026-09-24: "Some will
 * give us the words and flavors and ask us to make it work. Others will specify
 * down to the letter."). So: type the message, tick the flavours, and we work
 * out which letter is which — or turn on "choose a flavor for each letter" and
 * say so yourself. Either way the lead gets a line per letter, in order.
 */
function LettersPanel({
  flavors,
  requests,
  onChange,
}: {
  flavors: InquiryMenuItem[];
  requests: LetterRequest[];
  onChange: (next: LetterRequest[]) => void;
}) {
  function update(key: string, patch: Partial<LetterRequest>) {
    onChange(
      requests.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        const { characters } = splitMessage(next.message);
        return { ...next, assign: alignAssign(next.assign, characters.length, next.flavors, false) };
      })
    );
  }

  return (
    <div className="space-y-4 border-t border-ink px-4 py-4">
      {requests.map((req, i) => (
        <LetterRequestEditor
          key={req.key}
          index={i}
          count={requests.length}
          req={req}
          flavors={flavors}
          onChange={(patch) => update(req.key, patch)}
          onRemove={() => onChange(requests.filter((r) => r.key !== req.key))}
        />
      ))}
      <button
        type="button"
        onClick={() => onChange([...requests, newLetterRequest(nextKey())])}
        className="h-12 w-full border border-ink text-[14px] font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-neutral-100"
      >
        {requests.length === 0 ? "Add a message" : "Add another message"}
      </button>
    </div>
  );
}

function LetterRequestEditor({
  index,
  count,
  req,
  flavors,
  onChange,
  onRemove,
}: {
  index: number;
  count: number;
  req: LetterRequest;
  flavors: InquiryMenuItem[];
  onChange: (patch: Partial<LetterRequest>) => void;
  onRemove: () => void;
}) {
  const [filter, setFilter] = useState("");
  const { characters, invalid } = splitMessage(req.message);
  const byId = new Map(flavors.map((f) => [f.id, f]));
  const chosen = req.flavors.filter((f) => byId.has(f));
  const left = unassignedLetters(req, new Set(chosen));
  const shown = filterItems(flavors, filter);

  function toggleFlavor(id: string) {
    onChange({
      flavors: chosen.includes(id) ? chosen.filter((f) => f !== id) : [...chosen, id],
    });
  }

  return (
    <div className="space-y-4">
      {count > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-[0.12em] text-subtle">
            Message {index + 1}
          </span>
          <button
            type="button"
            onClick={onRemove}
            className="text-[13px] uppercase tracking-[0.06em] text-muted underline underline-offset-2 hover:text-ink"
          >
            Remove
          </button>
        </div>
      )}

      <label className="block space-y-1.5">
        <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
          1. Your message
        </span>
        <input
          type="text"
          value={req.message}
          autoCapitalize="characters"
          autoComplete="off"
          onChange={(e) => onChange({ message: e.target.value })}
          className="h-12 w-full border border-ink px-3 text-[16px] uppercase tracking-[0.08em] outline-none focus:border-2"
        />
        <span className="block text-[13px] text-muted">
          {characters.length > 0
            ? `${characters.length} ${characters.length === 1 ? "letter" : "letters"} — spaces are free. Letters, numbers, ♥ ! ? & + and - all work.`
            : "Letters, numbers, ♥ ! ? & + and - all work. Spaces are free."}
        </span>
        {invalid.length > 0 && (
          <span className="block text-[13px] text-accent">
            We can’t make {invalid.map((c) => `“${c}”`).join(", ")} — take{" "}
            {invalid.length === 1 ? "it" : "them"} out, or tell us about it below.
          </span>
        )}
      </label>

      <div className="space-y-1.5">
        <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
          2. Flavors
        </span>
        {chosen.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {chosen.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => toggleFlavor(id)}
                  aria-label={`Remove ${byId.get(id)!.name}`}
                  className="flex items-center gap-2 border border-ink bg-ink px-3 py-1.5 text-[14px] text-white"
                >
                  {byId.get(id)!.name}
                  <span aria-hidden>×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <span className="block text-[13px] text-muted">
          {chosen.length > 1
            ? "Pick as many as you like — then choose which letter is which below."
            : "Pick one for the whole message, or several to mix them."}
        </span>
        <div className="border border-ink">
          {flavors.length >= FILTER_FROM && (
            <div className="border-b border-hairline p-2">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find a flavor"
                aria-label="Find a letter flavor"
                className="h-12 w-full border border-ink px-3 text-[16px] outline-none focus:border-2"
              />
            </div>
          )}
          <ul className="max-h-64 divide-y divide-hairline overflow-y-auto">
            {shown.map((f) => {
              const on = chosen.includes(f.id);
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => toggleFlavor(f.id)}
                    aria-pressed={on}
                    className={
                      "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors " +
                      (on ? "bg-neutral-100" : "hover:bg-neutral-100")
                    }
                  >
                    <span
                      aria-hidden
                      className={
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center border border-ink text-[13px] " +
                        (on ? "bg-ink text-white" : "bg-white")
                      }
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] leading-snug">{f.name}</span>
                      {f.description && (
                        <span className="block text-[13px] leading-snug text-muted">{f.description}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[14px] tabular-nums text-muted">{money(f.price)}</span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="px-3 py-2.5 text-[14px] text-muted">Nothing matches “{filter}”.</li>
            )}
          </ul>
        </div>
      </div>

      {/* STEP 3 — A FLAVOR FOR EVERY LETTER (Mark, 2026-09-24: "force the user
          to set the flavor for each letter … type the phrase, choose the
          flavors, then set the flavors for each letter"). One flavor is every
          letter's and needs no choosing; with two or more, each row starts
          empty and the basket will not send until every one is set. */}
      {characters.length > 0 && chosen.length > 0 && (
        <div className="space-y-3">
          <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
            3. A flavor for each letter
          </span>
          {chosen.length === 1 ? (
            <p className="text-[14px] text-muted">
              Every letter will be {byId.get(chosen[0])!.name}. Choose another flavor above to
              mix them.
            </p>
          ) : (
            <>
              <p className="text-[14px] text-muted">
                {left === 0
                  ? "Every letter has a flavor."
                  : `${left} of ${characters.length} still to choose.`}
              </p>
              {/* A SHORTCUT, NOT A DEFAULT: it fills every letter at once so a
                  twenty-letter message is one pick and a few changes, and it is
                  only ever the customer's own choice. */}
              <label className="flex items-center gap-3">
                <span className="shrink-0 text-[14px]">Set every letter to</span>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) onChange({ assign: characters.map(() => e.target.value) });
                  }}
                  className="h-12 min-w-0 flex-1 border border-ink bg-white px-2 text-[16px] outline-none focus:border-2"
                >
                  <option value="">Choose…</option>
                  {chosen.map((id) => (
                    <option key={id} value={id}>
                      {byId.get(id)!.name}
                    </option>
                  ))}
                </select>
              </label>
              <ol className="divide-y divide-hairline border border-ink">
                {characters.map((ch, i) => {
                  const value = req.assign[i] ?? "";
                  return (
                    <li key={i} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-10 shrink-0 text-center text-[22px] font-bold">
                        {/* U+FE0E: text presentation, so Apple devices draw a
                            glyph rather than a red emoji heart (CLAUDE.md, ♥/★). */}
                        {ch === "<3" ? "♥\uFE0E" : ch}
                      </span>
                      <select
                        value={value}
                        onChange={(e) => {
                          const next = [...alignAssign(req.assign, characters.length, chosen, false)];
                          next[i] = e.target.value || null;
                          onChange({ assign: next });
                        }}
                        aria-label={`Flavor for letter ${i + 1}, ${ch === "<3" ? "heart" : ch}`}
                        className={
                          "h-12 min-w-0 flex-1 border bg-white px-2 text-[16px] outline-none focus:border-2 " +
                          (value ? "border-ink" : "border-accent text-muted")
                        }
                      >
                        <option value="" disabled>
                          Choose a flavor
                        </option>
                        {chosen.map((id) => (
                          <option key={id} value={id}>
                            {byId.get(id)!.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}

      <label className="block space-y-1.5">
        <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
          How many sets?
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={50}
          value={req.sets}
          onChange={(e) => onChange({ sets: Math.max(1, Math.min(50, Math.floor(Number(e.target.value)) || 1)) })}
          className="h-12 w-24 border border-ink px-3 text-[16px] tabular-nums outline-none focus:border-2"
        />
        <span className="block text-[13px] text-muted">
          2 makes the whole message twice.
        </span>
      </label>
    </div>
  );
}

/* ==========================================================================
 * The summary
 * ========================================================================== */

export type DeliveryQuote =
  | { status: "none" }
  | { status: "needs_address" }
  | { status: "loading" }
  | { status: "ok"; fee: number; miles: number }
  | { status: "outside" }
  | { status: "unavailable" };

/**
 * YOUR ORDER — the lines, the problems and the ESTIMATE. Every total is called
 * an estimate because it is one (Mark: "it's a lead, not an order"): custom
 * work, changes and the final delivery price are confirmed by the quote.
 */
export function BasketSummary({
  lines,
  problems,
  showProblems,
  estimate,
  delivery,
}: {
  lines: BasketLine[];
  problems: BasketProblem[];
  showProblems: boolean;
  estimate: InquiryEstimate;
  delivery: DeliveryQuote;
}) {
  if (lines.length === 0 && problems.length === 0) return null;
  return (
    <section className="space-y-3 border-2 border-ink p-4" aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="text-[12px] uppercase tracking-[0.12em] text-subtle">
        Your order
      </h2>

      {lines.length > 0 && (
        <ul className="space-y-1.5">
          {lines.map((l, i) => (
            <li key={i} className="flex items-baseline gap-3 text-[15px]">
              <span className="w-10 shrink-0 text-right tabular-nums">{l.qty}×</span>
              <span className="min-w-0 flex-1 leading-snug">{l.label}</span>
              <span className="shrink-0 tabular-nums">
                {l.quoted ? "in your quote" : money(l.total)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {problems.length > 0 && (
        <ul className={`space-y-1 text-[14px] ${showProblems ? "text-accent" : "text-muted"}`}>
          {problems.map((p, i) => (
            <li key={i}>{p.message}</li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <dl className="space-y-1 border-t border-hairline pt-3 text-[15px]">
          <Money label="Subtotal" value={money(estimate.subtotal)} />
          {estimate.rushFee !== null && (
            <Money label="Rush fee (under two business days)" value={money(estimate.rushFee)} />
          )}
          <Money
            label="Sales tax"
            value={estimate.tax === null ? "added to your quote" : money(estimate.tax)}
          />
          {delivery.status !== "none" && (
            <Money
              label={delivery.status === "ok" ? `Delivery (${delivery.miles.toFixed(1)} mi)` : "Delivery"}
              value={
                delivery.status === "ok"
                  ? money(delivery.fee)
                  : delivery.status === "loading"
                    ? "working it out…"
                    : delivery.status === "needs_address"
                      ? "enter your address"
                      : delivery.status === "outside"
                        ? "we’ll quote it"
                        : "added to your quote"
              }
            />
          )}
          <div className="flex items-baseline justify-between gap-3 pt-1 text-[17px] font-semibold">
            <dt>Estimated total</dt>
            <dd className="tabular-nums">{money(estimate.total)}</dd>
          </div>
        </dl>
      )}

      {lines.some((l) => l.quoted) && (
        <p className="text-[13px] text-muted">Plus the extras priced in your quote.</p>
      )}

      {lines.length > 0 && (
        <p className="text-[13px] leading-relaxed text-muted">
          This is an estimate. Your quote confirms the final price, including any custom
          work.
        </p>
      )}
    </section>
  );
}

function Money({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}
