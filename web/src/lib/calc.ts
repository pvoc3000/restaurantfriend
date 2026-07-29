// Arithmetic in a numeric field: type "4*9*25", get 900 (Mark, 2026-07-29).
//
// The case that asked for it is par. A par is in base units, but you know the
// shape of the thing you're buying — 4 containers of 9 lbs, and you want 25
// cases — so entering it means doing 4 × 9 × 25 somewhere else and typing the
// answer. Now the field is the somewhere else.
//
// Deliberately NOT eval()/new Function(): that's arbitrary code execution on
// input, it breaks under a strict CSP, and it buys nothing over 60 lines for
// four operators. A library would be worse — mathjs is 150KB+ to add `*`.
//
// The grammar, smallest thing that covers the need:
//
//   expr    := term (('+' | '-') term)*
//   term    := factor (('*' | '/' | '×' | '÷') factor)*
//   factor  := ('+' | '-') factor | primary
//   primary := number | '(' expr ')'
//
// No exponent, no implicit multiplication ("2(3)"), no functions. Each of those
// is a way to be surprised by what a field stored, and none of them is the job.

/** Characters we quietly drop first — none can be ambiguous in this app. */
const NOISE = /[\s,$]/g;

/** Everything the grammar allows. Anything else fails as a typo, not a parse. */
const ALLOWED = /^[0-9.+\-*/×÷()]+$/;

/**
 * Evaluate a numeric field's contents. Returns null when the text isn't a
 * number or a calculation this understands — callers already have an error
 * path for that, and guessing would be worse than refusing.
 *
 * A plain number is a valid expression that evaluates to itself, so nothing
 * about typing "900" changes.
 */
export function evaluateNumeric(input: string): number | null {
  const s = input.replace(NOISE, "");
  if (s === "" || !ALLOWED.test(s)) return null;

  let i = 0;
  const peek = () => s[i];

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      const c = peek();
      if (c !== "+" && c !== "-") return left;
      i++;
      const right = parseTerm();
      if (right === null) return null;
      left = c === "+" ? left + right : left - right;
    }
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    for (;;) {
      const c = peek();
      if (c !== "*" && c !== "/" && c !== "×" && c !== "÷") return left;
      i++;
      const right = parseFactor();
      if (right === null) return null;
      left = c === "*" || c === "×" ? left * right : left / right;
    }
  }

  function parseFactor(): number | null {
    const c = peek();
    if (c === "+") {
      i++;
      return parseFactor();
    }
    if (c === "-") {
      i++;
      const value = parseFactor();
      return value === null ? null : -value;
    }
    return parsePrimary();
  }

  function parsePrimary(): number | null {
    if (peek() === "(") {
      i++;
      const value = parseExpr();
      if (value === null || peek() !== ")") return null;
      i++;
      return value;
    }
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (i === start) return null;
    // "1.2.3" arrives here as one token and Number() rejects it, which is the
    // answer we want.
    const n = Number(s.slice(start, i));
    return Number.isFinite(n) ? n : null;
  }

  const value = parseExpr();
  // Trailing junk means we understood a prefix and stopped — "4*9x" must fail
  // rather than quietly storing 36.
  if (value === null || i !== s.length) return null;
  // 1/0.
  if (!Number.isFinite(value)) return null;
  // Binary floats: 0.1+0.2 is 0.30000000000000004 and 12*16*453.59.../28.34...
  // lands a hair off 3072. Twelve significant digits is far past anything this
  // app stores (numeric(10,3) at most) and kills the artifacts.
  return Number(value.toPrecision(12));
}

/**
 * Does this text look like a calculation rather than a plain number? Drives the
 * live "= 900" hint and picks the error wording, so a fat-fingered number
 * doesn't get told the app can't do maths.
 *
 * A leading sign isn't a calculation; a minus anywhere else is.
 */
export function looksLikeExpression(input: string): boolean {
  const s = input.replace(NOISE, "");
  return /[+*/×÷()]/.test(s) || /.-/.test(s);
}
