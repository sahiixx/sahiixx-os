// paperless-ngx-inspired matching engine, minus the training set. Rules are
// applied against the OCR text on ingest (and re-applied on reextract) to
// auto-classify documents: keyword (any/all words), regex, or fuzzy
// (inline Levenshtein — no rapidfuzz dep). First-match-wins for `type`; all
// matching `tag` rules accumulate. This runs BEFORE the LLM extract so a
// confident keyword match can pre-set the type and save a round-trip.

export type MatchAlgorithm = "keyword" | "regex" | "fuzzy";
export type MatchTarget = "type" | "tag";

export interface MatchingRule {
  id?: number;
  algorithm: MatchAlgorithm;
  expression: string; // "offer letter" | regex source | "fuzzy:deposit~2"
  target: MatchTarget;
  targetValue: string; // doc_type value when target==="type"; tag string when target==="tag"
  createdAt?: Date | null;
}

export interface MatchResult {
  type?: string; // a docTypeEnum value, if a type-target rule matched
  tags: string[]; // accumulated tag-target rule values
}

/** Apply all rules to `text`; returns the first matched `type` + all matched tags. */
export function applyRules(text: string, rules: MatchingRule[]): MatchResult {
  const lower = text.toLowerCase();
  let type: string | undefined;
  const tags: string[] = [];
  for (const r of rules) {
    if (type && r.target === "type") continue; // first type wins
    if (!matches(lower, r)) continue;
    if (r.target === "type") type = r.targetValue;
    else if (!tags.includes(r.targetValue)) tags.push(r.targetValue);
  }
  return { type, tags };
}

function matches(lowerText: string, rule: MatchingRule): boolean {
  try {
    if (rule.algorithm === "keyword") return matchKeyword(lowerText, rule.expression);
    if (rule.algorithm === "regex") return matchRegex(lowerText, rule.expression);
    if (rule.algorithm === "fuzzy") return matchFuzzy(lowerText, rule.expression);
  } catch {
    return false; // a bad regex/fuzzy expression shouldn't break ingest
  }
  return false;
}

/**
 * Keyword matching, paperless-style. Prefix operator controls the combine mode:
 *   "any offer letter"  → ANY of {offer, letter} present (OR)
 *   "all offer letter"  → ALL of {offer, letter} present (AND)
 * No prefix defaults to ALL (the common "phrase-ish" intent). Words are split
 * on whitespace and matched as substrings (case-insensitive) so multi-word
 * terms like "offer to purchase" work without stemming.
 */
function matchKeyword(lowerText: string, expr: string): boolean {
  const trimmed = expr.trim().toLowerCase();
  if (!trimmed) return false;
  const m = trimmed.match(/^(any|all)\s+(.*)$/);
  const mode = m ? m[1] : "all";
  const body = m ? m[2] : trimmed;
  const words = body.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const present = (w: string) => lowerText.includes(w);
  return mode === "any" ? words.some(present) : words.every(present);
}

/** Regex match (case-insensitive by default; honor (?-i) to opt out). */
function matchRegex(lowerText: string, expr: string): boolean {
  const re = new RegExp(expr, "i");
  return re.test(lowerText);
}

/**
 * Fuzzy match. Expression syntax: "term~threshold" (e.g. "deposit~2") or just
 * "term" (default threshold 2). Matches if ANY whitespace-delimited token in
 * the text is within `threshold` Levenshtein edits of `term`. Threshold scales
 * with term length so short words don't match everything.
 */
function matchFuzzy(lowerText: string, expr: string): boolean {
  const m = expr.match(/^([^~]+)(?:~(\d+))?$/);
  if (!m) return false;
  const term = m[1].toLowerCase();
  let threshold = m[2] ? Number(m[2]) : 2;
  if (threshold < 0 || Number.isNaN(threshold)) threshold = 2;
  const tokens = lowerText.split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    // skip tokens much shorter than the term — can't be a meaningful match
    if (Math.abs(tok.length - term.length) > threshold + 2) continue;
    if (levenshtein(tok, term) <= threshold) return true;
  }
  return false;
}

/** Iterative Levenshtein with a single rolling row — O(m*n) time, O(min) space. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}