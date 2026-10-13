// What a generated summary must satisfy before Valynce shows or stores it.
// A model's reply is untrusted: its shape, the report IDs it cites, the figures
// it writes and the claims it makes are all checked against the evidence bundle.
// A figure must belong to the report or category its sentence is about, and a
// finding must cite the reports and categories it names. These are guards on
// wording and traceability. They cannot prove that a sentence is true, which is
// why every summary is labelled as a draft.
import type { EvidenceBundle, EvidenceRecord } from './evidence.ts';

export interface SummaryFinding {
  /** A fact restates what the cited reports record. A hypothesis is a possible explanation to check. */
  kind: 'fact' | 'hypothesis';
  statement: string;
  /** NCR IDs from the evidence that the statement rests on. */
  recordIds: string[];
  /** Present when Valynce wrote the statement from the ranking, as in an offline summary. Absent when the model wrote it. */
  author?: 'valynce';
}

export interface AiSummary {
  overview: string;
  findings: SummaryFinding[];
  missingInformation: string[];
  nextSteps: string[];
}

export const SUMMARY_LIMITS = {
  overviewChars: 700,
  itemChars: 400,
  findings: 3,
  recordIdsPerFinding: 12,
  missingInformation: 5,
  nextSteps: 3,
} as const;

export type SummaryCheck = { ok: true; summary: AiSummary } | { ok: false; problems: string[] };

const FIGURE = /(\d[\d,]*(?:\.\d+)?)(\s*%|\s+percent\b)?/g;

interface Figure {
  value: number;
  /** Written as a percentage. A share is never accepted as a count or an amount, nor the reverse. */
  percent: boolean;
}

function figuresIn(text: string): Figure[] {
  const found: Figure[] = [];
  for (const match of text.matchAll(FIGURE)) {
    const value = Number(match[1]!.replace(/,/g, ''));
    if (Number.isFinite(value)) found.push({ value, percent: match[2] !== undefined });
  }
  return found;
}

function without(text: string, phrases: readonly string[]): string {
  let rest = text;
  for (const phrase of phrases) rest = rest.split(phrase).join(' ');
  return rest;
}

/** Figures one thing in the evidence states: a report, a category, or the analysis as a whole. */
class FigureSet {
  private readonly plain = new Set<number>();
  private readonly percent = new Set<number>();

  add(raw: string | number | null, percent = false): this {
    if (raw === null) return this;
    for (const figure of figuresIn(String(raw))) {
      const into = percent ? this.percent : this.plain;
      into.add(figure.value);
      // 85.00 in the evidence may be written 85.0 or 85; rounding to fewer decimals is the same figure.
      into.add(Math.round(figure.value * 10) / 10);
      into.add(Math.round(figure.value));
    }
    return this;
  }

  has(figure: Figure): boolean {
    return (figure.percent ? this.percent : this.plain).has(figure.value);
  }
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The phrases from `names` that `text` contains as whole words, longest first so "AE-10" is not found inside "AE-100". */
function named(text: string, names: readonly string[]): string[] {
  const found: string[] = [];
  let rest = text;
  for (const name of names) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`, 'gu');
    if (!pattern.test(rest)) continue;
    found.push(name);
    rest = rest.replace(pattern, ' ');
  }
  return found;
}

/**
 * Where each figure in the evidence belongs. A figure in a summary is accepted
 * only when it belongs to the analysis as a whole, to a category the sentence
 * names, or to a report the sentence names. A sentence that names no report is
 * read as being about the reports its entry names or cites.
 */
class EvidenceIndex {
  readonly ids: string[];
  readonly categoryNames: string[];
  private readonly records = new Map<string, EvidenceRecord>();
  private readonly general = new FigureSet();
  private readonly ofRecord = new Map<string, FigureSet>();
  private readonly ofCategory = new Map<string, FigureSet>();
  private readonly everyCategory = new FigureSet();

  constructor(bundle: EvidenceBundle, facts: readonly string[]) {
    const longestFirst = (a: string, b: string): number => b.length - a.length;
    this.ids = bundle.records.map((r) => r.id).sort(longestFirst);
    this.categoryNames = bundle.categories.map((c) => c.category).sort(longestFirst);

    const { coverage } = bundle;
    for (const n of [bundle.storedReports, bundle.populationReports, bundle.records.length, bundle.categories.length, coverage.rankedReports, coverage.notRecorded, coverage.costInAnotherOrNoCurrency]) {
      this.general.add(n);
    }
    for (const other of coverage.quantityInOtherUnits) this.general.add(other.reports);
    this.general.add(bundle.total).add(bundle.filters.search).add(bundle.filters.status);
    // The lines shown beside the summary, apart from the category lines, whose figures belong to their category.
    for (const line of facts) if (!/^\d+\. /.test(line)) this.general.add(without(line, [...this.ids, ...this.categoryNames]));

    for (const c of bundle.categories) {
      const figures = new FigureSet().add(c.rank).add(c.value).add(c.contributingReports).add(c.reportsInCategory).add(c.sharePercent, true).add(c.cumulativePercent, true);
      this.ofCategory.set(c.category, figures);
      this.everyCategory.add(c.rank).add(c.value).add(c.contributingReports).add(c.reportsInCategory).add(c.sharePercent, true).add(c.cumulativePercent, true);
    }
    for (const r of bundle.records) {
      this.records.set(r.id, r);
      // Text is searched without report IDs, so the digits of an ID are never a figure.
      this.ofRecord.set(r.id, new FigureSet().add(r.value).add(without(`${r.description ?? ''} ${r.reportedCause ?? ''}`, this.ids)));
    }
  }

  record(id: string): EvidenceRecord | undefined {
    return this.records.get(id);
  }

  /** Listed reports in a named category. "Uncategorized" is the reports that state none. */
  reportsIn(category: string, bundle: EvidenceBundle): EvidenceRecord[] {
    const uncategorized = bundle.categories.some((c) => c.category === category && c.uncategorized);
    return bundle.records.filter((r) => (uncategorized ? r.defectCategory === null : r.defectCategory === category));
  }

  /**
   * Figures in `text` that do not belong to anything it is about. `cited` are
   * the report IDs a finding rests on; other entries pass none.
   */
  strangers(text: string, cited: readonly string[]): number[] {
    const entryIds = [...new Set([...named(text, this.ids), ...cited])];
    const entryCategories = named(text, this.categoryNames);
    const found = new Set<number>();
    for (const sentence of sentences(text)) {
      let ids = named(sentence, this.ids);
      let categories = named(sentence, this.categoryNames);
      // A sentence that names no report ("It adds 4 units to Material.") is about the reports the entry names or cites.
      if (ids.length === 0) {
        ids = entryIds;
        if (categories.length === 0) categories = entryCategories;
      }
      const allowed: FigureSet[] = [this.general];
      for (const id of ids) allowed.push(this.ofRecord.get(id)!);
      for (const category of categories) allowed.push(this.ofCategory.get(category)!);
      // With nothing named anywhere, a ranking figure may be meant, but never one report's value.
      if (ids.length === 0 && categories.length === 0) allowed.push(this.everyCategory);
      // Names and dates of the things the sentence is about are not figures.
      const dates = ids.map((id) => this.records.get(id)?.openedOn).filter((date): date is string => typeof date === 'string');
      const rest = without(sentence, [...this.ids, ...dates, ...this.categoryNames]);
      for (const figure of figuresIn(rest)) if (!allowed.some((set) => set.has(figure))) found.add(figure.value);
    }
    return [...found];
  }
}

const NEGATION = /\b(no|not|never|cannot|can't|isn't|aren't|doesn't|don't|without|unverified|unconfirmed|unknown|whether|if|may|might|could|possibl[ey]|hypothes[ie]s|to (?:check|verify|confirm|determine|establish|find))\b/i;
const ROOT_CAUSE = /\broot[- ]causes?\b|\b(?:verified|confirmed|proven|established|definite|definitive|actual|true|real|underlying|primary|main)\s+causes?\b/i;
const CAUSAL_FACT = /\b(?:caused by|is caused|was caused|were caused|are caused|the cause (?:is|was)|because of|driven by|driv(?:es|er|ers|ing)|responsible for|results? from|stems? from|leads? to)\b/i;
const SAVINGS = /\b(?:savings?|could save|would save|will save|return on investment|ROI|payback)\b/i;
const RATE = /\b(?:defect rates?|reject(?:ion)? rates?|failure rates?|scrap rates?|ppm|dpmo|yield|percent defective)\b/i;

// "not a verified cause", "no root cause is recorded", "any verified cause analysis", "the root cause has not been found".
// The denial must reach the phrase within a few words and no comma, so "did not check the alloy, and the root cause is X" stays a claim.
const DENIED_BEFORE = /(?:\b(?:no|not|never|none|without|any|lacks?|lacking|missing|unverified|unconfirmed|rather than)|n't)(?:\s+[\p{L}\p{N}'-]+){0,4}\s+$/iu;
const DENIED_AFTER = /^\s*(?:analysis\s+)?(?:is|was|are|were|has|have|remains?)\s+(?:not|never|unknown|unverified|unconfirmed|missing|yet)\b/i;

// "the root cause is X", "X is the root cause".
const ASSERTED_AFTER = /^\s*(?:of\s+[^,.;]{1,60}\s+)?(?:is|was|are|were|being|lies|lay)\b/i;
const ASSERTED_BEFORE = /\b(?:is|was|are|were|as)\s+(?:the|a|an|its|their)\s+$/i;

/**
 * True unless every mention of a root or verified cause in the sentence is there
 * to say that none is known. An entry under missing information names what is
 * absent ("A verified cause for any of the reports"), so there a mention counts
 * only when it asserts one.
 */
function claimsRootCause(sentence: string, gap: boolean): boolean {
  for (const match of sentence.matchAll(new RegExp(ROOT_CAUSE.source, 'gi'))) {
    const before = sentence.slice(0, match.index);
    const after = sentence.slice(match.index + match[0].length);
    if (DENIED_BEFORE.test(before) || DENIED_AFTER.test(after)) continue;
    if (gap && !ASSERTED_AFTER.test(after) && !ASSERTED_BEFORE.test(before)) continue;
    return true;
  }
  return false;
}

const sentences = (text: string): string[] => text.split(/(?<=[.!?;])\s+|\n+/).filter((s) => s.trim() !== '');

/** Wording a summary must not use, whatever the reports say. */
function claimProblems(where: string, text: string, kind: 'overview' | 'fact' | 'hypothesis' | 'gap' | 'step'): string[] {
  const problems: string[] = [];
  for (const sentence of sentences(text)) {
    const hedged = NEGATION.test(sentence);
    if (!(hedged && kind !== 'fact') && claimsRootCause(sentence, kind === 'gap')) {
      problems.push(`${where} states or implies a root cause. Nothing in the evidence is a verified root cause; describe what the reports record instead.`);
    }
    if ((kind === 'fact' || kind === 'overview') && CAUSAL_FACT.test(sentence) && !/\breported cause\b/i.test(sentence)) {
      problems.push(`${where} makes a causal claim outside a hypothesis. A ranking shows where, not why. Restate it as what the reports record, or mark it as a hypothesis.`);
    }
    if (SAVINGS.test(sentence) && !(hedged && kind === 'gap')) {
      problems.push(`${where} estimates savings or a return. The evidence holds recorded costs only; do not estimate savings.`);
    }
    if (RATE.test(sentence) && !(hedged && kind !== 'fact')) {
      problems.push(`${where} gives or implies a defect rate. The evidence has no production quantities, so no rate can be calculated.`);
    }
  }
  return problems;
}

function textField(raw: unknown, where: string, limit: number, problems: string[]): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    problems.push(`${where} must be non-empty text.`);
    return '';
  }
  const text = raw.trim();
  if (text.length > limit) problems.push(`${where} is ${text.length} characters; the limit is ${limit}.`);
  return text;
}

function textList(raw: unknown, where: string, max: number, problems: string[]): string[] {
  if (!Array.isArray(raw)) {
    problems.push(`${where} must be a list.`);
    return [];
  }
  if (raw.length > max) problems.push(`${where} has ${raw.length} entries; the limit is ${max}.`);
  return raw.map((entry, index) => textField(entry, `${where} entry ${index + 1}`, SUMMARY_LIMITS.itemChars, problems));
}

/**
 * Checks a model's reply against the evidence it was given. Returns the clean
 * summary, or every problem found in words a repair request can pass back.
 */
export function validateSummary(raw: unknown, bundle: EvidenceBundle, facts: readonly string[]): SummaryCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, problems: ['The reply is not a JSON object.'] };
  const input = raw as Record<string, unknown>;
  const problems: string[] = [];
  const known = ['overview', 'findings', 'missingInformation', 'nextSteps'];
  for (const key of Object.keys(input)) if (!known.includes(key)) problems.push(`Unexpected field "${key}".`);

  const index = new EvidenceIndex(bundle, facts);
  const idSet = new Set(index.ids);

  const overview = textField(input.overview, 'The overview', SUMMARY_LIMITS.overviewChars, problems);

  const findings: SummaryFinding[] = [];
  if (!Array.isArray(input.findings)) {
    problems.push('findings must be a list.');
  } else {
    if (input.findings.length > SUMMARY_LIMITS.findings) problems.push(`findings has ${input.findings.length} entries; the limit is ${SUMMARY_LIMITS.findings}.`);
    for (const [index, entry] of input.findings.entries()) {
      const where = `Finding ${index + 1}`;
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        problems.push(`${where} is not an object.`);
        continue;
      }
      const finding = entry as Record<string, unknown>;
      for (const key of Object.keys(finding)) if (!['kind', 'statement', 'recordIds'].includes(key)) problems.push(`${where} has an unexpected field "${key}".`);
      const kind = typeof finding.kind === 'string' ? finding.kind.toLowerCase() : '';
      if (kind !== 'fact' && kind !== 'hypothesis') problems.push(`${where} must have kind "fact" or "hypothesis".`);
      const statement = textField(finding.statement, `${where} statement`, SUMMARY_LIMITS.itemChars, problems);
      const cited: string[] = [];
      if (!Array.isArray(finding.recordIds) || finding.recordIds.length === 0) {
        problems.push(`${where} must cite at least one report ID from the evidence.`);
      } else {
        if (finding.recordIds.length > SUMMARY_LIMITS.recordIdsPerFinding) {
          problems.push(`${where} cites ${finding.recordIds.length} reports; the limit is ${SUMMARY_LIMITS.recordIdsPerFinding}.`);
        }
        for (const id of finding.recordIds) {
          if (typeof id !== 'string' || !idSet.has(id.trim())) problems.push(`${where} cites "${String(id).slice(0, 60)}", which is not a report ID in the evidence.`);
          else if (!cited.includes(id.trim())) cited.push(id.trim());
        }
      }
      findings.push({ kind: kind === 'hypothesis' ? 'hypothesis' : 'fact', statement, recordIds: cited });
    }
  }

  const missingInformation = textList(input.missingInformation, 'missingInformation', SUMMARY_LIMITS.missingInformation, problems);
  const nextSteps = textList(input.nextSteps, 'nextSteps', SUMMARY_LIMITS.nextSteps, problems);

  // Wording.
  problems.push(...claimProblems('The overview', overview, 'overview'));
  for (const [index, finding] of findings.entries()) problems.push(...claimProblems(`Finding ${index + 1}`, finding.statement, finding.kind));
  for (const [index, text] of missingInformation.entries()) problems.push(...claimProblems(`missingInformation entry ${index + 1}`, text, 'gap'));
  for (const [index, text] of nextSteps.entries()) problems.push(...claimProblems(`nextSteps entry ${index + 1}`, text, 'step'));

  // Citations: a finding must cite the reports and categories it is about.
  for (const [position, finding] of findings.entries()) {
    const where = `Finding ${position + 1}`;
    const uncited = named(finding.statement, index.ids).filter((id) => !finding.recordIds.includes(id));
    if (uncited.length > 0) problems.push(`${where} names ${uncited.slice(0, 5).join(', ')} in its statement without citing ${uncited.length === 1 ? 'it' : 'them'}. Cite every report the statement is about.`);
    // In a selected-category request the other categories' reports were not sent, so they cannot be cited.
    const about = named(finding.statement, index.categoryNames).filter((category) => index.reportsIn(category, bundle).length > 0);
    // One is enough: "Labeling is tied with Material" may rest on the Labeling reports alone.
    if (about.length > 0 && !about.some((category) => index.reportsIn(category, bundle).some((r) => finding.recordIds.includes(r.id)))) {
      problems.push(`${where} is about ${about.join(' and ')} but cites no report in ${about.length === 1 ? 'that category' : 'those categories'}. Cite a report the statement rests on, or do not name the category.`);
    }
    const statesCause = sentences(finding.statement).some((sentence) => /\breported causes?\b/i.test(sentence) && !NEGATION.test(sentence));
    if (statesCause && finding.recordIds.length > 0 && !finding.recordIds.some((id) => index.record(id)?.reportedCause != null)) {
      problems.push(`${where} speaks of a reported cause, but none of the reports it cites has one. Cite the report whose reported cause is meant.`);
    }
  }

  // Figures: every number written must belong to what its sentence is about.
  const written: [string, string, readonly string[]][] = [
    ['The overview', overview, []],
    ...findings.map((f, i): [string, string, readonly string[]] => [`Finding ${i + 1}`, f.statement, f.recordIds]),
    ...missingInformation.map((t, i): [string, string, readonly string[]] => [`missingInformation entry ${i + 1}`, t, []]),
    ...nextSteps.map((t, i): [string, string, readonly string[]] => [`nextSteps entry ${i + 1}`, t, []]),
  ];
  for (const [where, text, cited] of written) {
    const strangers = index.strangers(text, cited);
    if (strangers.length > 0) {
      problems.push(
        `${where} contains ${strangers.length === 1 ? 'a figure' : 'figures'} (${strangers.slice(0, 5).join(', ')}) that the evidence does not give for the report or category that sentence is about. ` +
          'Remove it, or copy the figure exactly from that report or category.',
      );
    }
  }

  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  return { ok: true, summary: { overview, findings, missingInformation, nextSteps } };
}
