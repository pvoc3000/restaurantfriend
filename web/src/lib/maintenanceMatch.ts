/**
 * IS THIS ALREADY REPORTED? — the pure half of the tablet's Submit a
 * Maintenance Request (Mark, 2026-11-02: "do what it can to avoid duplicating
 * a request by a different user").
 *
 * A broken walk-in is noticed by every shift that opens it, and each of them
 * filing it is three requests for one repair — the manager calls the
 * refrigeration company three times, or closes two and loses what they said.
 * So the dialog lists what is already open at the shop, the likeliest first,
 * and offers "Same Problem" on each, which adds the person's words to THAT
 * request instead of making another.
 *
 * Deliberately crude and deliberately visible: nothing is ever refused here,
 * only ranked. A false match costs one glance; a hidden one costs a duplicate.
 * The person standing in front of the fryer decides.
 */

import type { TaskPriority } from "./facilityTasks";

export type OpenRequest = {
  id: string;
  title: string;
  details: string | null;
  equipment_id: string | null;
  equipment_name: string | null;
  shop_section_id: string | null;
};

export type RequestDraft = {
  title: string;
  details: string;
  equipment_id: string;
  equipment_name: string | null;
  shop_section_id: string;
};

/** Words that say nothing about WHICH thing is broken. */
const STOP = new Set([
  "the", "and", "for", "not", "isnt", "its", "has", "have", "was", "are", "but",
  "with", "from", "this", "that", "there", "our", "out", "again", "still",
  "very", "too", "any", "all", "off", "one", "two", "need", "needs", "needed",
  "please", "broken", "broke", "working", "work", "works", "fix", "fixed",
  "repair", "issue", "problem", "check", "looks", "seems", "won", "wont",
  "dont", "doesnt", "cant", "can", "will", "just", "keep", "keeps",
]);

/**
 * A word's rough root, so "leaking" meets "leaks" and "cooler" meets
 * "coolers". Crude on purpose — a suffix strip, not a stemmer: the list is
 * read by a person, and a stemmer's cleverness is invisible to them.
 */
function root(word: string): string {
  for (const suffix of ["ing", "ers", "ed", "es", "s"]) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/**
 * The distinct meaningful roots in some text. "Walk-in" is one word, and so
 * is "walk in" — a word followed by "in" or "up" is also offered run together
 * (walk-in, reach-in, pop-up), so how somebody spaced it doesn't decide
 * whether it matches.
 */
export function wordsOf(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const joined = (text ?? "").toLowerCase().replace(/['’]/g, "").replace(/-/g, "");
  const raw = joined.split(/[^a-z0-9]+/).filter(Boolean);
  raw.forEach((w, i) => {
    if (w.length >= 3 && !STOP.has(w)) out.add(root(w));
    const next = raw[i + 1];
    if ((next === "in" || next === "up") && w.length >= 3 && !STOP.has(w)) {
      out.add(root(w + next));
    }
  });
  return out;
}

/**
 * How alike a draft and an open request are. Same equipment is the strongest
 * signal there is (3) — two people choosing the dish machine are almost always
 * talking about the same fault. Same shelf is weak (1): a lot breaks in the
 * kitchen. Each shared word is 1, capped at 3 so a long details box cannot
 * outvote the equipment.
 */
export function matchScore(draft: RequestDraft, request: OpenRequest): number {
  let score = 0;
  if (draft.equipment_id && draft.equipment_id === request.equipment_id) score += 3;
  if (draft.shop_section_id && draft.shop_section_id === request.shop_section_id) score += 1;

  const mine = wordsOf(`${draft.title} ${draft.details} ${draft.equipment_name ?? ""}`);
  if (mine.size > 0) {
    const theirs = wordsOf(`${request.title} ${request.details ?? ""} ${request.equipment_name ?? ""}`);
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared += 1;
    score += Math.min(shared, 3);
  }
  return score;
}

/** At or above this a request is called a LIKELY match, and filing anyway is
 *  a button that says so. Same equipment alone gets there; so do two shared
 *  words and the same shelf, or three shared words. */
export const LIKELY_MATCH = 3;

/**
 * Every open request with its score, likeliest first; ties keep the order
 * given (newest first, as loaded). A draft with nothing in it scores
 * everything 0, which leaves the list as loaded — the browse view.
 */
export function rankOpenRequests<T extends OpenRequest>(
  draft: RequestDraft,
  open: readonly T[],
): { request: T; score: number }[] {
  return open
    .map((request, i) => ({ request, score: matchScore(draft, request), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ request, score }) => ({ request, score }));
}

const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2 };

/** A second report can raise a request's priority, never lower it: somebody
 *  calling it urgent is information, somebody calling it minor is not a
 *  reason to stop hurrying. */
export function raisedPriority(current: TaskPriority, reported: TaskPriority): TaskPriority {
  return PRIORITY_RANK[reported] > PRIORITY_RANK[current] ? reported : current;
}

/**
 * The request's details with a second report added at the end — who, when,
 * and what they said, so the manager reads every account in one place. With
 * no words of their own it still says they saw it: "it's still doing it" from
 * a second shift is worth knowing on its own.
 */
export function withAlsoReported(
  details: string | null,
  report: { name: string; date: string; note: string },
): string {
  const note = report.note.trim();
  const line = `Also reported by ${report.name} on ${report.date}${note ? `: ${note}` : "."}`;
  const before = (details ?? "").trimEnd();
  return before ? `${before}\n\n${line}` : line;
}
