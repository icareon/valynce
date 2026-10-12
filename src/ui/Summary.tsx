// The optional AI summary: what would be sent, the confirmation, and the result.
// Nothing here sends data on its own. A request leaves this computer only after
// the user presses "Send and generate" for the analysis then on screen.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisScope } from '../modules/quality/evidence.ts';
import type { SummaryCheckResponse, SummaryRecord } from '../server/contract.ts';
import { ApiError, checkSummary, generateSummary, removeSummary } from './api.ts';
import { formatWhole, plural } from './format.ts';

type Mode = 'closed' | 'confirm' | 'sending' | 'failed';

export interface SummaryControl {
  check: SummaryCheckResponse | null;
  mode: Mode;
  failure: { message: string; problems: string[] } | null;
  open: () => void;
  cancel: () => void;
  send: () => void;
  discard: () => void;
}

/** Waits a little longer than the backend's own limit, so its explanation arrives first. */
const CLIENT_GRACE_MS = 15_000;

/**
 * Keeps the summary state in step with the analysis on screen. Whenever the
 * scope or the stored reports change it asks the local backend what a summary
 * would send and whether the stored one still matches. That question stays on
 * this computer.
 */
export function useSummary(scope: AnalysisScope, dataKey: unknown, enabled: boolean): SummaryControl {
  const [check, setCheck] = useState<SummaryCheckResponse | null>(null);
  const [mode, setMode] = useState<Mode>('closed');
  const [failure, setFailure] = useState<SummaryControl['failure']>(null);
  const scopeKey = JSON.stringify(scope);
  const latestScope = useRef(scopeKey);
  latestScope.current = scopeKey;
  const sending = useRef(false);

  const refresh = useCallback(async (key: string) => {
    try {
      const result = await checkSummary({ scope: JSON.parse(key) as AnalysisScope });
      // An answer for an analysis that is no longer on screen is dropped.
      if (latestScope.current === key) setCheck(result);
    } catch {
      if (latestScope.current === key) setCheck(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void refresh(scopeKey), 150);
    return () => clearTimeout(timer);
  }, [enabled, scopeKey, dataKey, refresh]);

  const send = async () => {
    if (sending.current || check === null || !check.request.ok || check.provider === null) return;
    sending.current = true;
    setMode('sending');
    setFailure(null);
    try {
      await generateSummary(
        { scope: JSON.parse(scopeKey) as AnalysisScope, fingerprint: check.request.fingerprint, confirmed: true },
        AbortSignal.timeout(check.limits.timeoutSeconds * 1000 + CLIENT_GRACE_MS),
      );
      setMode('closed');
    } catch (cause) {
      const timedOut = cause instanceof DOMException && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      setFailure({
        message: timedOut
          ? 'The summary took too long and was abandoned. Nothing was saved.'
          : cause instanceof Error
            ? cause.message
            : String(cause),
        problems: cause instanceof ApiError ? cause.problems : [],
      });
      setMode('failed');
    }
    sending.current = false;
    await refresh(latestScope.current);
  };

  return {
    check,
    mode,
    failure,
    open: () => {
      if (mode !== 'sending') setMode('confirm');
    },
    cancel: () => {
      if (mode !== 'sending') setMode('closed');
    },
    send: () => void send(),
    discard: () => {
      const id = check?.latest?.id;
      if (id === undefined) return;
      void removeSummary(id)
        .catch(() => undefined)
        .then(() => refresh(latestScope.current));
    },
  };
}

const list = (items: readonly string[]): string => items.join(', ');

function Confirm({ control }: { control: SummaryControl }) {
  const { check } = control;
  if (check === null) return <p className="summary-text">Checking what would be sent…</p>;

  if (check.provider === null) {
    return (
      <>
        <p className="summary-text">
          No AI provider is configured, so nothing can be sent. Everything else in Valynce works without one.
        </p>
        <p className="summary-text">
          To turn summaries on, copy <code>.env.example</code> to <code>.env</code> in the Valynce folder, set{' '}
          <code>ANTHROPIC_API_KEY</code> to your own key, and restart Valynce. The key stays in that file on this computer.
        </p>
        <div className="button-row">
          <button type="button" className="btn" onClick={control.cancel}>
            Close
          </button>
        </div>
      </>
    );
  }

  if (!check.request.ok) {
    return (
      <>
        <p className="summary-text">{check.request.message}</p>
        <div className="button-row">
          <button type="button" className="btn" onClick={control.cancel}>
            Close
          </button>
        </div>
      </>
    );
  }

  const { disclosure } = check.request;
  return (
    <>
      <p className="summary-text">
        This sends the data listed below from this computer to <strong>{check.provider.name}</strong>, an external AI
        provider. Nothing is sent until you choose Send and generate, and nothing is sent again unless you ask.
      </p>
      <dl className="summary-facts">
        <dt>Provider and model</dt>
        <dd>
          {check.provider.name}, <span className="mono">{check.provider.model}</span>, at{' '}
          <span className="mono">{check.provider.host}</span>
        </dd>
        <dt>Reports</dt>
        <dd>
          {plural(disclosure.recordCount, 'report')} (the limit is {formatWhole(check.limits.records)})
        </dd>
        <dt>Sent for each report</dt>
        <dd>{list(disclosure.fieldsSent)}</dd>
        <dt>Also sent</dt>
        <dd>
          The ranking of {plural(disclosure.categoryCount, 'category', 'categories')} with totals, shares and coverage
          counts, and the search text and status filter in use
        </dd>
        <dt>Not sent</dt>
        <dd>{list(disclosure.fieldsWithheld)}</dd>
      </dl>
      <p className="summary-text">
        Descriptions and reported causes are sent as written. If they contain names or part numbers, those are sent too.
        {disclosure.shortenedTexts > 0 &&
          ` ${plural(disclosure.shortenedTexts, 'report')} ${disclosure.shortenedTexts === 1 ? 'has' : 'have'} text longer than ${formatWhole(check.limits.textChars)} characters, which is sent shortened and marked as such.`}
      </p>
      <div className="button-row">
        <button type="button" className="btn btn-primary" onClick={control.send}>
          Send and generate
        </button>
        <button type="button" className="btn" onClick={control.cancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Result(props: {
  record: SummaryRecord;
  outdated: boolean;
  busy: boolean;
  /** NCR IDs that are still stored. */
  stored: ReadonlySet<string>;
  onOpenRecord: (ncrNumber: string) => void;
  onAgain: () => void;
  onDiscard: () => void;
}) {
  const { record, outdated } = props;
  const { summary } = record;
  return (
    <div className="summary-result">
      <div className="summary-head">
        <h3 className="section-title" id="summary-result-title">
          Summary <span className="tag">AI-generated draft</span>
        </h3>
        <p className="summary-meta">
          {record.provider} · {record.model} · generated {when.format(new Date(record.createdAt))} ·{' '}
          {plural(record.recordIds.length, 'report')} sent
        </p>
      </div>

      {outdated && (
        <p className="summary-outdated" role="status">
          <strong>Outdated.</strong> The reports, filters or metric have changed since this summary was generated. It
          describes the analysis stated below, not the one now on screen. Generate it again to replace it.
        </p>
      )}

      <h4 className="summary-label">Analysis scope and figures, computed by Valynce</h4>
      <ul className="summary-list summary-scope">
        {record.facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>

      <h4 className="summary-label">Overview</h4>
      <p className="summary-text summary-overview">{summary.overview}</p>

      <h4 className="summary-label">Findings</h4>
      {summary.findings.length === 0 ? (
        <p className="summary-text">The model reported no findings.</p>
      ) : (
        <ol className="summary-findings">
          {summary.findings.map((finding, index) => (
            <li key={index}>
              <span className="tag">{finding.kind === 'fact' ? 'From the reports' : 'Hypothesis, not verified'}</span>
              <p className="summary-text">{finding.statement}</p>
              <p className="summary-cites">
                <span>Supporting reports:</span>
                {finding.recordIds.map((id) =>
                  props.stored.has(id) ? (
                    <button key={id} type="button" className="cite" onClick={() => props.onOpenRecord(id)} aria-label={`Open report ${id}`}>
                      {id}
                    </button>
                  ) : (
                    <span key={id} className="cite is-gone" title="This report is no longer stored">
                      {id} (no longer stored)
                    </span>
                  ),
                )}
              </p>
            </li>
          ))}
        </ol>
      )}

      {summary.missingInformation.length > 0 && (
        <>
          <h4 className="summary-label">Missing information</h4>
          <ul className="summary-list">
            {summary.missingInformation.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}

      {summary.nextSteps.length > 0 && (
        <>
          <h4 className="summary-label">Suggested checks</h4>
          <ul className="summary-list">
            {summary.nextSteps.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}

      <p className="summary-note">
        A model wrote the overview, findings, missing information and suggested checks from the data listed under scope.
        It can be wrong. Open the cited reports to check it. Nothing here is a verified root cause.
      </p>
      <div className="button-row">
        <button type="button" className="btn" disabled={props.busy} onClick={props.onAgain}>
          Generate again
        </button>
        <button type="button" className="btn btn-quiet" disabled={props.busy} onClick={props.onDiscard}>
          Discard summary
        </button>
      </div>
    </div>
  );
}

export function SummaryPanel(props: {
  control: SummaryControl;
  stored: ReadonlySet<string>;
  onOpenRecord: (ncrNumber: string) => void;
}) {
  const { control } = props;
  const { check, mode } = control;
  const heading = useRef<HTMLHeadingElement>(null);

  // Bring the confirmation to the user when they ask for it, and keep the keyboard there.
  useEffect(() => {
    if (mode === 'confirm') {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [mode]);

  const latest = check?.latest ?? null;
  if (mode === 'closed' && latest === null) return null;

  return (
    <section className="card summary" aria-labelledby="summary-title">
      <p className="pareto-eyebrow">AI summary · optional</p>
      <h2 className="section-title" id="summary-title" tabIndex={-1} ref={heading}>
        {mode === 'confirm'
          ? 'Send this analysis to an AI provider?'
          : mode === 'sending'
            ? 'Generating summary'
            : mode === 'failed'
              ? 'The summary was not generated'
              : 'Summary of the analysis'}
      </h2>

      {mode === 'confirm' && (
        <div className="summary-block">
          <Confirm control={control} />
        </div>
      )}

      {mode === 'sending' && (
        <div className="summary-block" role="status">
          <p className="summary-text">
            <span className="summary-pulse" aria-hidden="true" />
            Waiting for {check?.provider?.name ?? 'the provider'}. This can take up to {check?.limits.timeoutSeconds ?? 60}{' '}
            seconds. The rest of Valynce stays usable.
          </p>
        </div>
      )}

      {mode === 'failed' && control.failure !== null && (
        <div className="summary-block">
          <p className="alert summary-alert" role="alert">
            <strong>Not generated.</strong> {control.failure.message}
          </p>
          {control.failure.problems.length > 0 && (
            <>
              <p className="summary-text">What the checks found in the last reply:</p>
              <ul className="summary-list">
                {control.failure.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </>
          )}
          <div className="button-row">
            <button type="button" className="btn" onClick={control.open}>
              Review and try again
            </button>
            <button type="button" className="btn btn-quiet" onClick={control.cancel}>
              Close
            </button>
          </div>
        </div>
      )}

      {latest !== null && (
        <Result
          record={latest}
          outdated={check?.latestOutdated ?? false}
          busy={mode === 'sending'}
          stored={props.stored}
          onOpenRecord={props.onOpenRecord}
          onAgain={control.open}
          onDiscard={control.discard}
        />
      )}
    </section>
  );
}
