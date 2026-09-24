/**
 * The inquiry form's basket — special orders 4b (Mark, 2026-09-24): a customer
 * BUILDS the order out of regular donuts, minis, giant donuts and letters, with
 * prices shown, and the lead arrives carrying it as real lines.
 *
 * Pure, like `lib/inquiry`: nothing here touches the DB, React or the DOM, so
 * every rule is broken in a fixture rather than in front of a customer.
 *
 * ---------------------------------------------------------------------------
 * THE GATE IS MIGRATION 133, NOT THIS FILE
 * ---------------------------------------------------------------------------
 * `create_inquiry` re-validates and RE-PRICES everything sent from here — the
 * minimums, the letter characters, which items are on the menu, and every
 * price. This module exists so the customer is told beside the basket rather
 * than after a round trip. The two are kept in step BY HAND: the fixtures pin
 * this side and the Docker harness pins that one.
 *
 * It is still a LEAD (Mark: "it's a lead, not an order"), which is why every
 * total here is an ESTIMATE and is labelled one on the page.
 */

import { LETTER_CHARACTERS } from "./specialOrderLines";
import { DEFAULT_RUSH_TERMS, suggestedRushFee } from "./specialOrders";

/** The four things the form sells. `inquiry_category` in 132 decides which an
 *  item is: a Letter cut is a letter whatever its size; otherwise the size. */
export type InquiryCategory = "regular" | "mini" | "giant" | "letter";

export const INQUIRY_CATEGORIES: InquiryCategory[] = ["regular", "mini", "giant", "letter"];

/** One row of `inquiry_menu` — exactly the five fields it returns. */
export type InquiryMenuItem = {
  id: string;
  name: string;
  category: InquiryCategory;
  price: number;
  description: string | null;
};

export type InquiryMinimums = {
  regular: number;
  mini: number;
  mini_per_flavor: number;
  letter: number;
  giant: number;
};

/** `inquiry_menu`'s `rules`. */
export type InquiryRules = {
  minimums: InquiryMinimums;
  rush: { cutoff_business_days: number; minimum: number; rate: number };
  tax_rate: number | null;
  delivery_estimate: boolean;
  timezone: string;
};

/** What the page shows when `inquiry_menu` has nothing to say (a null org, a
 *  failed fetch). Zero minimums, so nothing is refused on a rule nobody set. */
export const EMPTY_RULES: InquiryRules = {
  minimums: { regular: 0, mini: 0, mini_per_flavor: 0, letter: 0, giant: 0 },
  rush: {
    cutoff_business_days: DEFAULT_RUSH_TERMS.cutoffBusinessDays,
    minimum: DEFAULT_RUSH_TERMS.minimum,
    rate: DEFAULT_RUSH_TERMS.rate,
  },
  tax_rate: null,
  delivery_estimate: false,
  timezone: "UTC",
};

/** `inquiry_menu`'s answer, read defensively — numeric columns arrive from
 *  PostgREST as strings often enough that a bare cast concatenates. */
export function readMenu(raw: unknown): { items: InquiryMenuItem[]; rules: InquiryRules } {
  const r = (raw ?? {}) as { items?: unknown; rules?: Record<string, unknown> };
  const num = (v: unknown, fallback: number) => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) ? x : fallback;
  };
  const items: InquiryMenuItem[] = Array.isArray(r.items)
    ? (r.items as Record<string, unknown>[])
        .filter((i) => INQUIRY_CATEGORIES.includes(i.category as InquiryCategory))
        .map((i) => ({
          id: String(i.id),
          name: String(i.name),
          category: i.category as InquiryCategory,
          price: num(i.price, 0),
          description: typeof i.description === "string" && i.description.trim() ? i.description : null,
        }))
    : [];
  const rules = r.rules ?? {};
  const m = (rules.minimums ?? {}) as Record<string, unknown>;
  const rush = (rules.rush ?? {}) as Record<string, unknown>;
  return {
    items,
    rules: {
      minimums: {
        regular: num(m.regular, 0),
        mini: num(m.mini, 0),
        mini_per_flavor: num(m.mini_per_flavor, 0),
        letter: num(m.letter, 0),
        giant: num(m.giant, 0),
      },
      rush: {
        cutoff_business_days: num(rush.cutoff_business_days, EMPTY_RULES.rush.cutoff_business_days),
        minimum: num(rush.minimum, EMPTY_RULES.rush.minimum),
        rate: num(rush.rate, EMPTY_RULES.rush.rate),
      },
      tax_rate: rules.tax_rate === null || rules.tax_rate === undefined ? null : num(rules.tax_rate, 0),
      delivery_estimate: rules.delivery_estimate === true,
      timezone: typeof rules.timezone === "string" ? rules.timezone : "UTC",
    },
  };
}

/* ==========================================================================
 * LETTERS
 * ========================================================================== */

/**
 * A message, as the letters it takes.
 *
 * Upper-cased; spaces and line breaks dropped (a space is not a donut); `<3`,
 * ♥ and ❤ all become the heart cut `<3`, which is how twelve years of orders
 * spell it. Anything else we cannot cut is reported ONCE per character, in the
 * order it first appears, so the page can say "we can't make @ or #".
 */
export function splitMessage(text: string): { characters: string[]; invalid: string[] } {
  const characters: string[] = [];
  const invalid: string[] = [];
  // U+FE0F / U+FE0E are presentation selectors riding on ❤ — not characters.
  const s = text.replace(/[︎️]/g, "");
  for (let i = 0; i < s.length; ) {
    if (s.startsWith("<3", i)) {
      characters.push("<3");
      i += 2;
      continue;
    }
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    i += ch.length;
    if (/\s/.test(ch)) continue;
    if (ch === "♥" || ch === "❤") {
      characters.push("<3");
      continue;
    }
    const up = ch.toUpperCase();
    if (LETTER_CHARACTERS.includes(up)) characters.push(up);
    else if (!invalid.includes(ch)) invalid.push(ch);
  }
  return { characters, invalid };
}

/**
 * One letters request: a message, the flavours for it, and how many sets.
 *
 * TWO WAYS TO SAY IT, because people do both (Mark): name the flavours and
 * let us "make it work", or choose a flavour per letter. `perLetter` false is
 * the first. `assign` is kept either way so switching modes does not lose what
 * somebody chose.
 */
export type LetterRequest = {
  /** The page's key for the request; never sent. */
  key: string;
  message: string;
  flavors: string[];
  perLetter: boolean;
  /** One flavour id (or null) per character of `message`, when `perLetter`. */
  assign: (string | null)[];
  sets: number;
};

export function newLetterRequest(key: string): LetterRequest {
  return { key, message: "", flavors: [], perLetter: false, assign: [], sets: 1 };
}

/**
 * Keep the per-letter choices lined up with the message as it is edited.
 *
 * By POSITION, which is the simple rule and the one a person expects when they
 * fix a typo at the end; a letter inserted mid-word shifts the choices after
 * it, and that is visible in the rows. Anything not in `flavors` any more
 * becomes null, and a new position takes the only flavour when there is one.
 */
export function alignAssign(
  assign: (string | null)[],
  length: number,
  flavors: string[],
  /** Fill an empty position with the ONLY flavour. True when pricing and
   *  sending, where one flavour is unambiguous; FALSE when storing what the
   *  customer chose — otherwise ticking a first flavour silently "chooses" it
   *  for every letter, and those choices outlive a second flavour being
   *  ticked (found in the browser, 2026-09-24). */
  fillSingle = true
): (string | null)[] {
  const only = fillSingle && flavors.length === 1 ? flavors[0] : null;
  const out: (string | null)[] = [];
  for (let i = 0; i < length; i++) {
    const prev = assign[i] ?? null;
    out.push(prev && flavors.includes(prev) ? prev : only);
  }
  return out;
}

/** A message as a customer reads it back: as typed, upper-cased, spaces
 *  kept, and every heart spelling shown as ♥ (it is `<3` in the data). */
export function displayMessage(message: string): string {
  return message
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/<3|❤/g, "♥")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** How many letter donuts a request makes. */
export function letterCount(req: Pick<LetterRequest, "message" | "sets">): number {
  return splitMessage(req.message).characters.length * Math.max(0, Math.floor(req.sets || 0));
}

/* ==========================================================================
 * THE BASKET
 * ========================================================================== */

export type Basket = {
  /** Donuts, minis and giants: item id → quantity. */
  qty: Record<string, number>;
  letters: LetterRequest[];
};

export const EMPTY_BASKET: Basket = { qty: {}, letters: [] };

/** A basket line as the summary shows it. `linked` false is a letter whose
 *  flavour we choose ("make it work"). */
export type BasketLine = {
  category: InquiryCategory;
  label: string;
  qty: number;
  unitPrice: number;
  total: number;
};

const cents = (x: number) => Math.round(x * 100) / 100;

/** Average of the chosen flavours' prices — how a "make it work" letter is
 *  estimated, and exactly how 133 prices the unlinked line it writes. */
export function averagePrice(ids: string[], byId: Map<string, InquiryMenuItem>): number {
  const prices = ids.map((id) => byId.get(id)?.price).filter((p): p is number => p !== undefined);
  if (prices.length === 0) return 0;
  return cents(prices.reduce((a, p) => a + p, 0) / prices.length);
}

/**
 * The basket as priced lines — what the summary lists and the estimate sums.
 *
 * Letters are GROUPED here (one row per flavour per request, plus one for the
 * letters left to us) because a summary of HAPPY BIRTHDAY as thirteen rows is
 * unreadable; the lead itself still gets one line per character (133), which
 * is what the decorator lays out from.
 */
export function basketLines(basket: Basket, menu: InquiryMenuItem[]): BasketLine[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const lines: BasketLine[] = [];
  for (const cat of ["regular", "mini", "giant"] as const) {
    for (const item of menu) {
      if (item.category !== cat) continue;
      const qty = Math.floor(basket.qty[item.id] ?? 0);
      if (qty <= 0) continue;
      const label = cat === "regular" ? item.name : `${item.name} (${cat === "mini" ? "Mini" : "Giant"})`;
      lines.push({ category: cat, label, qty, unitPrice: item.price, total: cents(qty * item.price) });
    }
  }
  for (const req of basket.letters) {
    const { characters } = splitMessage(req.message);
    const sets = Math.max(0, Math.floor(req.sets || 0));
    const flavors = req.flavors.filter((f) => byId.has(f));
    if (characters.length === 0 || sets === 0 || flavors.length === 0) continue;
    const word = displayMessage(req.message);
    const assign =
      req.perLetter || flavors.length === 1
        ? alignAssign(req.assign, characters.length, flavors)
        : characters.map(() => null);
    const counts = new Map<string | null, number>();
    for (const a of assign) counts.set(a, (counts.get(a) ?? 0) + 1);
    for (const [flavor, n] of counts) {
      const qty = n * sets;
      if (flavor) {
        const item = byId.get(flavor)!;
        lines.push({
          category: "letter",
          label: `“${word}” letters — ${item.name}`,
          qty,
          unitPrice: item.price,
          total: cents(qty * item.price),
        });
      } else {
        const unit = averagePrice(flavors, byId);
        lines.push({
          category: "letter",
          label: `“${word}” letters — ${flavors.map((f) => byId.get(f)!.name).join(" / ")}`,
          qty,
          unitPrice: unit,
          total: cents(qty * unit),
        });
      }
    }
  }
  return lines;
}

/** One reason the basket cannot be sent yet, worded for the customer. */
export type BasketProblem = { category: InquiryCategory; message: string };

/**
 * Everything wrong with the basket, in the order the page lists its cards.
 *
 * THE MINIMUMS (Mark, 2026-09-24): EACH CATEGORY THAT IS ORDERED MEETS ITS
 * OWN — 24 regulars; 24 minis in total and 6 of each flavour; 10 letters; 1
 * giant. A category left empty is never short, so a giant-only order is fine
 * and 12 regulars beside a giant is not. An EMPTY basket has no problems at
 * all: describing the order in words is still a complete inquiry.
 */
export function basketProblems(
  basket: Basket,
  menu: InquiryMenuItem[],
  minimums: InquiryMinimums
): BasketProblem[] {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const problems: BasketProblem[] = [];
  const total = (cat: InquiryCategory) =>
    menu.filter((m) => m.category === cat).reduce((a, m) => a + Math.max(0, Math.floor(basket.qty[m.id] ?? 0)), 0);

  const regular = total("regular");
  if (regular > 0 && regular < minimums.regular) {
    problems.push({
      category: "regular",
      message: `Donuts start at ${minimums.regular} — you have ${regular}.`,
    });
  }

  const mini = total("mini");
  if (mini > 0 && mini < minimums.mini) {
    problems.push({
      category: "mini",
      message: `Minis start at ${minimums.mini} in total — you have ${mini}.`,
    });
  }
  const shortMinis = menu.filter((m) => {
    const q = Math.floor(basket.qty[m.id] ?? 0);
    return m.category === "mini" && q > 0 && q < minimums.mini_per_flavor;
  });
  if (shortMinis.length > 0) {
    problems.push({
      category: "mini",
      message:
        `Minis are made at least ${minimums.mini_per_flavor} of a flavor — ` +
        shortMinis.map((m) => `${m.name} has ${Math.floor(basket.qty[m.id])}`).join(", ") +
        ".",
    });
  }

  const giant = total("giant");
  if (giant > 0 && giant < minimums.giant) {
    problems.push({ category: "giant", message: `Giant donuts start at ${minimums.giant}.` });
  }

  let letters = 0;
  for (const req of basket.letters) {
    const { characters, invalid } = splitMessage(req.message);
    if (invalid.length > 0) {
      problems.push({
        category: "letter",
        message: `We can’t make ${invalid.map((c) => `“${c}”`).join(", ")} as a letter — take ${
          invalid.length === 1 ? "it" : "them"
        } out, or tell us about it below.`,
      });
    }
    if (characters.length > 0 && req.flavors.filter((f) => byId.has(f)).length === 0) {
      problems.push({ category: "letter", message: `Choose at least one flavor for “${displayMessage(req.message)}”.` });
    }
    if (characters.length > 0) letters += characters.length * Math.max(0, Math.floor(req.sets || 0));
  }
  if (letters > 0 && letters < minimums.letter) {
    problems.push({
      category: "letter",
      message: `Letters start at ${minimums.letter} — you have ${letters}.`,
    });
  }
  return problems;
}

/** Is anything in the basket at all? */
export function basketIsEmpty(basket: Basket): boolean {
  return (
    Object.values(basket.qty).every((q) => !(q > 0)) &&
    basket.letters.every((r) => splitMessage(r.message).characters.length === 0)
  );
}

/* ==========================================================================
 * THE ESTIMATE
 * ========================================================================== */

export type InquiryEstimate = {
  subtotal: number;
  /** Null when the date is outside the rush window (or not chosen). */
  rushFee: number | null;
  /** Null when the shop's rate is unknown — the page says "added to the quote". */
  tax: number | null;
  /** Null when there is no delivery figure to add. */
  delivery: number | null;
  total: number;
};

/**
 * The estimated total, with `lib/specialOrders`' own arithmetic: the rush fee
 * is `suggestedRushFee` (the terms the quote prints), and delivery and rush
 * are NOT taxed, as `orderTotals` says and order 9885's invoice shows.
 */
export function estimateTotals(args: {
  lines: BasketLine[];
  rules: InquiryRules;
  eventDate: string | null;
  today: string;
  deliveryFee: number | null;
}): InquiryEstimate {
  const subtotal = cents(args.lines.reduce((a, l) => a + l.total, 0));
  const rushFee = suggestedRushFee(
    { event_date: args.eventDate || null, today: args.today, subtotal },
    {
      cutoffBusinessDays: args.rules.rush.cutoff_business_days,
      minimum: args.rules.rush.minimum,
      rate: args.rules.rush.rate,
    }
  );
  const tax = args.rules.tax_rate === null ? null : cents(subtotal * args.rules.tax_rate);
  const delivery = args.deliveryFee === null ? null : cents(args.deliveryFee);
  return {
    subtotal,
    rushFee,
    tax,
    delivery,
    total: cents(subtotal + (rushFee ?? 0) + (tax ?? 0) + (delivery ?? 0)),
  };
}

/* ==========================================================================
 * THE WIRE
 * ========================================================================== */

/**
 * `create_inquiry`'s `p_items` (133). Only what the gate reads — never a price,
 * which it resolves itself. Letters are sent as their CHARACTERS so the gate
 * validates the same cuts this file split; `assign` only in per-letter mode,
 * because its absence is how "make it work" is said.
 */
export function basketPayload(basket: Basket, menu: InquiryMenuItem[]): {
  lines: { item_id: string; qty: number }[];
  letters: { characters: string[]; flavors: string[]; assign: (string | null)[] | null; sets: number }[];
} {
  const ids = new Set(menu.map((m) => m.id));
  const letterIds = new Set(menu.filter((m) => m.category === "letter").map((m) => m.id));
  const lines = menu
    .filter((m) => m.category !== "letter")
    .map((m) => ({ item_id: m.id, qty: Math.floor(basket.qty[m.id] ?? 0) }))
    .filter((l) => l.qty > 0 && ids.has(l.item_id));
  const letters = basket.letters
    .map((r) => {
      const { characters } = splitMessage(r.message);
      const flavors = r.flavors.filter((f) => letterIds.has(f));
      return {
        characters,
        flavors,
        assign: r.perLetter ? alignAssign(r.assign, characters.length, flavors) : null,
        sets: Math.max(1, Math.floor(r.sets || 1)),
      };
    })
    .filter((r) => r.characters.length > 0 && r.flavors.length > 0);
  return { lines, letters };
}

/** "$1,234.50" — the page's one money format. */
export function money(x: number): string {
  return x.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Today in the org's zone, as the `YYYY-MM-DD` the rush rule compares. A
 *  public page has no session, so `lib/today` is out of reach — 058's reason
 *  for reading the zone off the org. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
