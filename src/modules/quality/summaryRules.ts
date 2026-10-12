// What a generated summary must satisfy before Valynce shows or stores it.
// A model's reply is untrusted: its shape, the report IDs it cites, the figures
// it writes and the claims it makes are all checked against the evidence bundle.
// These checks are guards on wording and traceability. They cannot prove that a
// sentence is true, which is why every summary is labelled as a draft.
import type { EvidenceBundle } from './evidence.ts';

export interface SummaryFinding {
  /** A fact restates what the cited reports record. A hypothesis is a possible explanation to check. */
  kind: 'fact' | 'hypothesis';
  statement: string;
  /** NCR IDs from the evidence that the statement rests on. */
  recordIds: string[];
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

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map((token) => Number(token.replace(/,/g, ''))).filter(Number.isFinite);
}

function without(text: string, phrases: readonly string[]): string {
  let rest = text;
  for (const phrase of phrases) rest = rest.split(phrase).join(' ');
  return rest;
}

/** Every number written anywhere in the evidence, apart from the digits inside report IDs. */
function evidenceNumbers(bundle: EvidenceBundle, facts: readonly string[], ids: readonly string[]): Set<number> {
  const strings: string[] = [...facts];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value);
    else if (typeof value === 'number') strings.push(String(value));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) if (key !== 'id') collect(inner);
    }
  };
  collect(bundle);
  const found = new Set<number>();
  for (const text of strings) {
    for (const n of numbersIn(without(text, ids))) {
      found.add(n);
      // 85.00 in the evidence may be written 85.0 or 85; rounding to fewer decimals is the same figure.
      found.add(Math.round(n * 10) / 10);
      found.add(Math.round(n));
    }
  }
  return found;
}

const NEGATION = /\b(no|not|never|cannot|can't|isn't|aren't|doesn't|don't|without|unverified|unconfirmed|unknown|whether|if|may|might|could|possibl[ey]|hypothes[ie]s|to (?:check|verify|confirm|determine|establish|find))\b/i;
const ROOT_CAUSE = /\broot[- ]causes?\b|\b(?:verified|confirmed|proven|established|definite|definitive|actual|true|real|underlying|primary|main)\s+causes?\b/i;
const CAUSAL_FACT = /\b(?:caused by|is caused|was caused|were caused|are caused|the cause (?:is|was)|because of|driven by|driv(?:es|er|ers|ing)|responsible for|results? from|stems? from|leads? to)\b/i;
const SAVINGS = /\b(?:savings?|could save|would save|will save|return on investment|ROI|payback)\b/i;
const RATE = /\b(?:defect rates?|reject(?:ion)? rates?|failure rates?|scrap rates?|ppm|dpmo|yield|percent defective)\b/i;

const sentences = (text: string): string[] => text.split(/(?<=[.!?;])\s+|\n+/).filter((s) => s.trim() !== '');

/** Wording a summary must not use, whatever the reports say. */
function claimProblems(where: string, text: string, kind: 'overview' | 'fact' | 'hypothesis' | 'gap' | 'step'): string[] {
  const problems: string[] = [];
  for (const sentence of sentences(text)) {
    const hedged = NEGATION.test(sentence);
    if (ROOT_CAUSE.test(sentence) && !(hedged && kind !== 'fact')) {
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

  const ids = bundle.records.map((r) => r.id).sort((a, b) => b.length - a.length);
  const idSet = new Set(ids);

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

  // Figures: every number written must already be in the evidence.
  const allowed = evidenceNumbers(bundle, facts, ids);
  const written: [string, string][] = [
    ['The overview', overview],
    ...findings.map((f, i): [string, string] => [`Finding ${i + 1}`, f.statement]),
    ...missingInformation.map((t, i): [string, string] => [`missingInformation entry ${i + 1}`, t]),
    ...nextSteps.map((t, i): [string, string] => [`nextSteps entry ${i + 1}`, t]),
  ];
  for (const [where, text] of written) {
    const strangers = [...new Set(numbersIn(without(text, ids)).filter((n) => !allowed.has(n)))];
    if (strangers.length > 0) {
      problems.push(`${where} contains ${strangers.length === 1 ? 'a figure' : 'figures'} not found in the evidence (${strangers.slice(0, 5).join(', ')}). Remove it, or use a figure exactly as the evidence gives it.`);
    }
  }

  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  return { ok: true, summary: { overview, findings, missingInformation, nextSteps } };
}
