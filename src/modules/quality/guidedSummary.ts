// The shorter summary used with the small offline model. Testing showed that
// Qwen3 1.7B cannot be relied on for the full summary: it misstated rankings,
// invented amounts and repeated instructions found in report text. So here the
// figures, the ranked finding, the missing information and the suggested checks
// are written by this file from the evidence, and the model is asked for two
// things only: a plain overview, and one sentence per leading category on what
// its reports describe. It is not given figures or reported causes, and its
// sentences may contain neither. Every part still passes validateSummary.
import type { EvidenceBundle, EvidenceCategory, EvidenceRecord } from './evidence.ts';
import { SUMMARY_LIMITS, validateSummary } from './summaryRules.ts';
import type { SummaryCheck, SummaryFinding } from './summaryRules.ts';

/** The most reports one offline request may carry. Set from tests with the real model; see docs/REFERENCE.md. */
export const LOCAL_MAX_RECORDS = 40;
/** The longest evidence text, in characters, an offline request may carry. A longer selection is refused, never cut. */
export const LOCAL_MAX_PROMPT_CHARS = 12_000;
export const GUIDED_LIMITS = { overviewChars: 320, themeChars: 280, recordIdsPerTheme: 6 } as const;

export interface GuidedTheme {
  /** The field of the model's reply that holds this theme. */
  key: 'first' | 'second';
  category: string;
  rank: number;
  /** The listed reports in the category. The model may cite only these for it. */
  ids: string[];
}

/** Everything about a guided summary that does not come from the model. */
export interface GuidedPlan {
  themes: GuidedTheme[];
  /** Reports whose description reads as instructions to a model. Their text is not given to the offline model. */
  withheld: string[];
  /** Written from the ranking. */
  finding: SummaryFinding;
  missingInformation: string[];
  nextSteps: string[];
}

const group = (digits: string): string => {
  const [whole, fraction] = digits.split('.');
  return whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
};
const count = (n: number, one: string, many = `${one}s`): string => `${group(String(n))} ${n === 1 ? one : many}`;
const POSITIONS = ['first', 'second', 'third'];

function inCategory(bundle: EvidenceBundle, category: EvidenceCategory): EvidenceRecord[] {
  return bundle.records.filter((r) => (category.uncategorized ? r.defectCategory === null : r.defectCategory === category.category));
}

function amount(bundle: EvidenceBundle, value: string): string {
  if (bundle.metric.key === 'cost') return `$${group(value)}`;
  if (bundle.metric.key === 'quantity') return `${group(value)} ${bundle.metric.unit}`;
  return count(Number(value), 'report');
}

/** The ranked finding, written from the category's own figures and citing the reports behind them. */
function rankedFinding(bundle: EvidenceBundle, category: EvidenceCategory): SummaryFinding {
  const listed = inCategory(bundle, category);
  const valued = listed.filter((r) => r.value !== null).sort((a, b) => Number(b.value) - Number(a.value));
  const cited = (valued.length > 0 ? valued : listed).slice(0, SUMMARY_LIMITS.recordIdsPerFinding);
  const position = POSITIONS[category.rank - 1] ?? `in position ${category.rank}`;
  const metric = bundle.metric.key === 'cost' ? 'recorded cost (USD)' : bundle.metric.key === 'quantity' ? `affected quantity in ${bundle.metric.unit}` : 'number of reports';
  // The share exactly as the evidence gives it, two decimals: rounding it again here could differ from the evidence by a tenth.
  const share = category.sharePercent === null ? '' : `, ${category.sharePercent}% of the total`;
  let statement = `${category.category} is ranked ${position} by ${metric}: ${amount(bundle, category.value)}${share}`;
  statement +=
    bundle.metric.key === 'count'
      ? '.'
      : `, from ${group(String(category.contributingReports))} of its ${count(category.reportsInCategory, 'report')}.`;
  if ((valued.length > 0 ? valued : listed).length > cited.length) statement += ' The reports with the largest values are cited.';
  statement += ' The ranking shows where this is recorded, not why.';
  return { kind: 'fact', statement, recordIds: cited.map((r) => r.id), author: 'valynce' };
}

// Text addressed to a model rather than describing a defect. The small model
// follows such text too readily, so a description that matches is kept from it
// and the summary says so. This is a short heuristic, not a guarantee.
const INSTRUCTION_LIKE =
  /\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:previous|prior|above|earlier|all|your|these|the)\b[^.]{0,20}\b(?:rules?|instructions?|prompts?|guidelines?)\b|\bsystem prompt\b|\byou (?:are|must|should|will) (?:now )?(?:an? |the )?(?:ai|assistant|model|chatbot)\b|\b(?:state|say|write|respond|reply|output|answer)\b[^.]{0,30}\b(?:that the|the word|only with|exactly)\b/i;

export const looksLikeInstructions = (text: string | null): boolean => text !== null && INSTRUCTION_LIKE.test(text);

/** Decides what the model is asked about and writes everything else. */
export function planGuided(bundle: EvidenceBundle): GuidedPlan {
  const withReports = bundle.categories.filter((c) => inCategory(bundle, c).length > 0);
  const focus = withReports.slice(0, bundle.recordsCover === 'selected_category_only' ? 1 : 2);
  const themes: GuidedTheme[] = focus.map((c, index) => ({
    key: index === 0 ? 'first' : 'second',
    category: c.category,
    rank: c.rank,
    ids: inCategory(bundle, c).map((r) => r.id),
  }));

  const { coverage } = bundle;
  const what = bundle.metric.key === 'cost' ? 'cost' : 'quantity';
  const missing: string[] = [];
  if (coverage.notRecorded > 0) {
    missing.push(`${count(coverage.notRecorded, 'report')} in this analysis ${coverage.notRecorded === 1 ? 'has' : 'have'} no ${what} recorded. That value is unknown: it is not ranked and not counted as zero.`);
  }
  if (coverage.costInAnotherOrNoCurrency > 0) {
    missing.push(`${count(coverage.costInAnotherOrNoCurrency, 'report')} ${coverage.costInAnotherOrNoCurrency === 1 ? 'has' : 'have'} a cost in another currency or with no currency stated. It is left out of the USD ranking and is not converted.`);
  }
  for (const other of coverage.quantityInOtherUnits) {
    missing.push(`${count(other.reports, 'report')} ${other.reports === 1 ? 'records' : 'record'} a quantity in ${other.unit}. It is ranked separately and is not added to this ranking.`);
  }
  const withheld = bundle.records.filter((r) => looksLikeInstructions(r.description)).map((r) => r.id);
  if (withheld.length > 0) {
    missing.unshift(
      `The description of ${withheld.slice(0, 6).join(', ')}${withheld.length > 6 ? ' and others' : ''} reads as instructions rather than a defect, so the offline model was not given that text. Open ${withheld.length === 1 ? 'the report' : 'those reports'} to read it.`,
    );
  }
  if (bundle.categories.some((c) => c.uncategorized)) missing.push('Some reports state no defect category. They are ranked together as Uncategorized.');
  if (bundle.recordsCover === 'selected_category_only') missing.push('Only the reports in the selected category were read. The other categories are known from the ranking alone.');
  missing.push('No production quantities are recorded, so no defect rate can be calculated.');

  const steps = ['Open the cited reports and compare each sentence above with what the report records.'];
  if (coverage.notRecorded + coverage.costInAnotherOrNoCurrency > 0 && bundle.metric.key !== 'count') {
    steps.push(`Check whether a ${what} exists for the reports that are not in the ranking.`);
  }
  steps.push('Where a report states a cause, check whether it was verified before relying on it.');

  return {
    themes,
    withheld,
    finding: rankedFinding(bundle, focus[0] ?? bundle.categories[0]!),
    missingInformation: missing.slice(0, SUMMARY_LIMITS.missingInformation),
    nextSteps: steps.slice(0, SUMMARY_LIMITS.nextSteps),
  };
}

/**
 * Checks the model's short reply and, when it passes, returns the whole summary:
 * the model's overview and themes together with the parts written here.
 */
export function validateGuided(raw: unknown, bundle: EvidenceBundle, facts: readonly string[], plan: GuidedPlan): SummaryCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, problems: ['The reply is not a JSON object.'] };
  const input = raw as Record<string, unknown>;
  const problems: string[] = [];
  const expected = ['overview', ...plan.themes.map((t) => t.key)];
  for (const key of Object.keys(input)) if (!expected.includes(key)) problems.push(`Unexpected field "${key}".`);

  if (typeof input.overview === 'string' && input.overview.trim().length > GUIDED_LIMITS.overviewChars) {
    problems.push(`The overview is ${input.overview.trim().length} characters; the limit is ${GUIDED_LIMITS.overviewChars}.`);
  }
  const themes: SummaryFinding[] = [];
  for (const theme of plan.themes) {
    const where = `"${theme.key}"`;
    const entry = input[theme.key];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`${where} must be an object with "statement" and "recordIds".`);
      continue;
    }
    const { statement, recordIds } = entry as Record<string, unknown>;
    if (typeof statement === 'string' && statement.trim().length > GUIDED_LIMITS.themeChars) {
      problems.push(`The ${where} statement is ${statement.trim().length} characters; the limit is ${GUIDED_LIMITS.themeChars}.`);
    }
    const ids = Array.isArray(recordIds) ? recordIds.filter((id): id is string => typeof id === 'string').map((id) => id.trim()) : [];
    if (ids.length > GUIDED_LIMITS.recordIdsPerTheme) problems.push(`${where} cites ${ids.length} reports; the limit is ${GUIDED_LIMITS.recordIdsPerTheme}.`);
    const outside = ids.filter((id) => !theme.ids.includes(id));
    if (outside.length > 0) problems.push(`${where} is about ${theme.category} but cites ${outside.slice(0, 5).join(', ')}, which ${outside.length === 1 ? 'is not a report' : 'are not reports'} in that category.`);
    themes.push({ kind: 'fact', statement: typeof statement === 'string' ? statement : '', recordIds: ids });
  }

  // Two rules for the small model's own sentences, on top of the usual ones: no
  // figures or ids at all, and nothing about causes. Both failed often enough in
  // testing that refusing them outright is simpler than judging each case.
  const own: [string, string, string[]][] = [
    ['The overview', typeof input.overview === 'string' ? input.overview : '', []],
    ...themes.map((t, i): [string, string, string[]] => [`The "${plan.themes[i]!.key}" statement`, t.statement, t.recordIds]),
  ];
  for (const [where, text, cited] of own) {
    // Naming a report the statement cites is harmless; any other digit is a figure or an id it should not have.
    const rest = [...cited].sort((a, b) => b.length - a.length).reduce((left, id) => left.split(id).join(' '), text);
    if (/\d/.test(rest)) problems.push(`${where} contains a number, or a report id it does not cite. Write no numbers in a sentence.`);
    if (/\bcause[sd]?\b|\bbecause\b|\bdue to\b/i.test(text)) problems.push(`${where} speaks of a cause. Describe only the problems the reports record.`);
  }

  // The same checks as any summary, over the whole of it: wording, citations and figures.
  const whole = validateSummary(
    { overview: input.overview, findings: [{ kind: 'fact', statement: plan.finding.statement, recordIds: plan.finding.recordIds }, ...themes], missingInformation: plan.missingInformation, nextSteps: plan.nextSteps },
    bundle,
    facts,
  );
  if (!whole.ok) {
    // Finding 1 is the one written here; the model's themes follow it.
    for (const problem of whole.problems) {
      problems.push(problem.replace(/^Finding (\d+)/, (_, n: string) => (plan.themes[Number(n) - 2] ? `The "${plan.themes[Number(n) - 2]!.key}" statement` : `Finding ${n}`)));
    }
  }
  if (problems.length > 0 || !whole.ok) return { ok: false, problems: [...new Set(problems)] };
  const [, ...checked] = whole.summary.findings;
  return { ok: true, summary: { ...whole.summary, findings: [plan.finding, ...checked] } };
}
