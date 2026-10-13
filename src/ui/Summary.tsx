// The optional AI analysis: the choice between the offline model on this
// computer and the online provider, the set-up of the offline model, the
// confirmation for each, and the result. Nothing here downloads, sends or
// generates on its own: each of those follows one explicit press.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiLocation } from '../ai/provider.ts';
import type { AnalysisScope } from '../modules/quality/evidence.ts';
import type { SummaryCheckResponse, SummaryRecord } from '../server/contract.ts';
import { ApiError, cancelOffline, checkSummary, generateSummary, installOffline, offlineStatus, removeOffline, removeSummary } from './api.ts';
import { formatWhole, plural } from './format.ts';

type Mode = 'closed' | 'setup' | 'confirm' | 'sending' | 'failed';

export interface SummaryControl {
  check: SummaryCheckResponse | null;
  /** False while `check` still describes an earlier metric, filter or provider. Nothing can be confirmed until it is true. */
  fresh: boolean;
  /** The provider the user selected. It is remembered in this browser and never changed for them. */
  choice: AiLocation;
  choose: (location: AiLocation) => void;
  mode: Mode;
  failure: { message: string; problems: string[] } | null;
  open: () => void;
  cancel: () => void;
  send: () => void;
  /** Stops a summary that is being generated. */
  stop: () => void;
  discard: () => void;
  /** Shows what enabling offline AI would download. Downloads nothing. */
  setup: () => void;
  /** Starts the download the user just confirmed. */
  download: () => void;
  cancelDownload: () => void;
  removeFiles: () => void;
}

/** Waits a little longer than the backend's own limit, so its explanation arrives first. */
const CLIENT_GRACE_MS = 15_000;
const CHOICE_KEY = 'valynce.ai.provider';

function storedChoice(): AiLocation {
  try {
    return localStorage.getItem(CHOICE_KEY) === 'online' ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}

/**
 * Keeps the summary state in step with the analysis on screen. Whenever the
 * scope, the stored reports or the selected provider change it asks the local
 * backend what a summary would use and whether the stored one still matches.
 * That question stays on this computer.
 */
export function useSummary(scope: AnalysisScope, dataKey: unknown, enabled: boolean): SummaryControl {
  // The answer is kept with the question it belongs to, so a confirmation is never given for a different analysis.
  const [checked, setChecked] = useState<{ key: string; value: SummaryCheckResponse } | null>(null);
  const check = checked?.value ?? null;
  const setCheck = (update: (current: SummaryCheckResponse | null) => SummaryCheckResponse | null) =>
    setChecked((current) => {
      const value = update(current?.value ?? null);
      return value === null || current === null ? current : { key: current.key, value };
    });
  const [choice, setChoice] = useState<AiLocation>(storedChoice);
  const [mode, setMode] = useState<Mode>('closed');
  const [failure, setFailure] = useState<SummaryControl['failure']>(null);
  const requestKey = JSON.stringify({ scope, location: choice });
  const fresh = checked?.key === requestKey;
  const latestKey = useRef(requestKey);
  latestKey.current = requestKey;
  const sending = useRef<AbortController | null>(null);

  const refresh = useCallback(async (key: string) => {
    try {
      const result = await checkSummary(JSON.parse(key) as { scope: AnalysisScope; location: AiLocation });
      // An answer for an analysis or a provider that is no longer on screen is dropped.
      if (latestKey.current === key) setChecked({ key, value: result });
    } catch {
      if (latestKey.current === key) setChecked(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void refresh(requestKey), 150);
    return () => clearTimeout(timer);
  }, [enabled, requestKey, dataKey, refresh]);

  // While the offline model downloads, ask the local backend how far it is.
  const downloading = check?.offline.state === 'downloading';
  useEffect(() => {
    if (!enabled || !downloading) return;
    const timer = setInterval(() => {
      void offlineStatus()
        .then((offline) => {
          setCheck((current) => (current === null ? current : { ...current, offline }));
          if (offline.state !== 'downloading') void refresh(latestKey.current);
        })
        .catch(() => undefined);
    }, 700);
    return () => clearInterval(timer);
  }, [enabled, downloading, refresh]);

  const withOffline = (work: () => Promise<SummaryCheckResponse['offline']>) => {
    void work()
      .then((offline) => setCheck((current) => (current === null ? current : { ...current, offline })))
      .catch(() => undefined)
      .then(() => refresh(latestKey.current));
  };

  const send = async () => {
    if (sending.current !== null || check === null || !fresh || !check.request.ok || check.location !== choice) return;
    const controller = new AbortController();
    sending.current = controller;
    setMode('sending');
    setFailure(null);
    try {
      await generateSummary(
        { scope, fingerprint: check.request.fingerprint, confirmed: true, location: choice },
        AbortSignal.any([controller.signal, AbortSignal.timeout(check.limits.timeoutSeconds * 1000 + CLIENT_GRACE_MS)]),
      );
      setMode('closed');
    } catch (cause) {
      if (controller.signal.aborted) {
        // The user stopped it: that is not a failure to explain.
        setMode('closed');
      } else {
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
    }
    sending.current = null;
    await refresh(latestKey.current);
  };

  return {
    check,
    fresh,
    choice,
    choose: (location) => {
      if (sending.current !== null || location === choice) return;
      try {
        localStorage.setItem(CHOICE_KEY, location);
      } catch {
        // Storage can be unavailable; the choice still applies for this visit.
      }
      setChoice(location);
      // A confirmation written for one provider must not be answered for the other.
      setMode('closed');
      setFailure(null);
    },
    mode,
    failure,
    open: () => {
      if (sending.current === null) setMode('confirm');
    },
    cancel: () => {
      if (sending.current === null) setMode('closed');
    },
    send: () => void send(),
    stop: () => sending.current?.abort(),
    discard: () => {
      const id = check?.latest?.id;
      if (id === undefined) return;
      void removeSummary(id)
        .catch(() => undefined)
        .then(() => refresh(latestKey.current));
    },
    setup: () => {
      if (sending.current === null) setMode('setup');
    },
    download: () => {
      setMode('closed');
      withOffline(installOffline);
    },
    cancelDownload: () => withOffline(cancelOffline),
    removeFiles: () => withOffline(removeOffline),
  };
}

const list = (items: readonly string[]): string => items.join(', ');
const size = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
const OFFLINE_WITHHELD = ['supplier', 'part number', 'recorded cost', 'affected quantity', 'status', 'disposition', 'reported cause', 'opened date', 'original file cells', 'file name and row number'];

/** A short word for the state of each provider, shown inside its option. Never colour alone. */
function offlineWord(check: SummaryCheckResponse | null): string {
  if (check === null) return 'Checking…';
  const { offline } = check;
  if (offline.state === 'ready') return 'Ready';
  if (offline.state === 'downloading') return 'Downloading';
  if (offline.state === 'unsupported') return 'Not available here';
  if (offline.state === 'failed') return 'Set-up failed';
  return 'Not installed';
}

function ProviderChoice({ control }: { control: SummaryControl }) {
  const { check, choice } = control;
  const busy = control.mode === 'sending';
  const option = (location: AiLocation, title: string, text: string, model: string, state: string) => (
    <label className={`provider-option${choice === location ? ' is-selected' : ''}`}>
      <input type="radio" name="ai-provider" value={location} checked={choice === location} disabled={busy} onChange={() => control.choose(location)} />
      <span className="provider-body">
        <span className="provider-title">{title}</span>
        <span className="provider-text">{text}</span>
        <span className="provider-meta">
          <span className="mono">{model}</span>
          <span className="tag">{state}</span>
        </span>
      </span>
    </label>
  );
  return (
    <fieldset className="provider-choice">
      <legend className="visually-hidden">Where to run the analysis</legend>
      {option(
        'offline',
        'Offline · Private',
        'Analyze on this computer. NCR data stays on this device.',
        check?.offline.model.label || 'Qwen3 1.7B',
        offlineWord(check),
      )}
      {option(
        'online',
        'Online · Frontier',
        'Analyze with Claude. Selected NCR data is sent to Anthropic after confirmation.',
        check === null ? '…' : (check.provider?.model ?? 'No model configured'),
        check === null ? 'Checking…' : check.provider === null ? 'Not configured' : 'Ready',
      )}
    </fieldset>
  );
}

/** The state of the offline model and the steps that change it. */
function OfflineSetup({ control }: { control: SummaryControl }) {
  const { check, mode } = control;
  if (check === null) return null;
  const { offline } = check;
  const parts = `the ${offline.model.label} model (${size(offline.model.bytes)}, from ${offline.model.source})${
    offline.runtime === null ? '' : ` and the ${offline.runtime.name} runtime that runs it (${size(offline.runtime.bytes)}, from ${offline.runtime.source})`
  }`;

  if (offline.state === 'unsupported') return <p className="summary-text">{offline.message}</p>;

  if (offline.state === 'downloading') {
    const percent = offline.totalBytes === 0 ? 0 : Math.min(100, Math.floor((offline.receivedBytes / offline.totalBytes) * 100));
    const what = offline.step === 'runtime' ? 'Downloading the runtime' : offline.step === 'model' ? 'Downloading the model' : 'Checking files';
    return (
      <div className="summary-block">
        <p className="summary-text" id="offline-progress-label">
          {what}: {size(offline.receivedBytes)} of {size(offline.totalBytes)}. Each file is checked against its expected
          checksum before it is used.
        </p>
        <progress className="download-progress" max={offline.totalBytes} value={offline.receivedBytes} aria-labelledby="offline-progress-label">
          {percent}%
        </progress>
        <div className="button-row">
          <button type="button" className="btn" onClick={control.cancelDownload}>
            Cancel download
          </button>
        </div>
      </div>
    );
  }

  if (offline.state === 'ready') {
    return (
      <p className="summary-text provider-status">
        <span>
          Offline AI is ready. {offline.model.label} runs on this computer, with no internet connection and no API key. Its
          files are in <span className="mono">{offline.folder}</span>.
        </span>
        <button type="button" className="btn btn-quiet" disabled={mode === 'sending'} onClick={control.removeFiles}>
          Remove offline AI files
        </button>
      </p>
    );
  }

  if (mode === 'setup') {
    return (
      <div className="summary-block">
        <h3 className="section-title">Download offline AI?</h3>
        <p className="summary-text">
          This downloads <strong>{size(offline.totalBytes)}</strong> once: {parts}. Nothing else is downloaded, and no NCR
          data is sent. The files are kept in <span className="mono">{offline.folder}</span>, outside Valynce's own
          folder, and can be removed here at any time.
        </p>
        <p className="summary-text">
          The download needs an internet connection. After it, offline summaries need none.
        </p>
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={control.download}>
            Download {size(offline.totalBytes)}
          </button>
          <button type="button" className="btn" onClick={control.cancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="summary-block">
      {offline.state === 'failed' && (
        <p className="alert summary-alert" role="alert">
          <strong>Offline AI was not set up.</strong> {offline.message}
        </p>
      )}
      <p className="summary-text">
        Offline AI is not installed. Enabling it needs a one-time download of {size(offline.totalBytes)}. Nothing is
        downloaded until you confirm it.
      </p>
      <div className="button-row">
        <button type="button" className="btn" onClick={control.setup}>
          {offline.state === 'failed' ? 'Try again' : 'Enable offline AI'}
        </button>
        {offline.state === 'failed' && (
          <button type="button" className="btn btn-quiet" onClick={control.removeFiles}>
            Remove offline AI files
          </button>
        )}
      </div>
    </div>
  );
}

function OnlineSetup({ check }: { check: SummaryCheckResponse | null }) {
  if (check === null || check.provider !== null) return null;
  return (
    <div className="summary-block">
      <p className="summary-text">
        No online AI provider is configured, so nothing can be sent. Everything else in Valynce works without one.
      </p>
      <p className="summary-text">
        To turn it on, copy <code>.env.example</code> to <code>.env</code> in the Valynce folder, set{' '}
        <code>ANTHROPIC_API_KEY</code> to your own key, and restart Valynce. The key stays in that file on this computer.
      </p>
    </div>
  );
}

function Confirm({ control }: { control: SummaryControl }) {
  const { check, choice } = control;
  if (check === null || !control.fresh || check.location !== choice) return <p className="summary-text">Checking this analysis…</p>;

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

  if (choice === 'offline') {
    return (
      <>
        <h3 className="section-title">Generate this summary on this computer?</h3>
        <p className="summary-text">
          <strong>{check.offline.model.label}</strong> runs on this computer. The reports below are read here and are not
          sent anywhere; no internet connection is used.
        </p>
        <dl className="summary-facts">
          <dt>Model</dt>
          <dd>
            <span className="mono">{check.offline.model.id}</span>, on this computer
          </dd>
          <dt>Reports</dt>
          <dd>
            {plural(disclosure.recordCount, 'report')} (the offline limit is {formatWhole(check.limits.records)})
          </dd>
          <dt>Read for each report</dt>
          <dd>{list(check.offlineFields)}</dd>
          <dt>Not given to the model</dt>
          <dd>{list(OFFLINE_WITHHELD)}</dd>
        </dl>
        <p className="summary-text">
          This is a small model, so an offline summary is shorter. Valynce writes the figures, the ranked finding, the
          missing information and the suggested checks. The model writes only the overview and one sentence on what the
          reports in each leading category describe.
        </p>
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={control.send}>
            Generate on this computer
          </button>
          <button type="button" className="btn" onClick={control.cancel}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  if (check.provider === null) return null;
  return (
    <>
      <h3 className="section-title">Send this analysis to an AI provider?</h3>
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

/**
 * Shown while a summary is generated. The dots are decoration and say nothing
 * about how far the work is, so they are hidden from screen readers; the text
 * beside them is the status.
 */
function Analyzing({ control }: { control: SummaryControl }) {
  const { check, choice } = control;
  const seconds = check?.limits.timeoutSeconds ?? 60;
  return (
    <div className="summary-block analyzing">
      <span className="analyzing-square" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <div>
        <p className="analyzing-title" role="status">
          Analyzing NCRs…
        </p>
        <p className="summary-text">
          {choice === 'offline'
            ? `${check?.offline.model.label ?? 'The model'} is working on this computer. The first summary after starting Valynce also loads the model, which takes longer.`
            : `Waiting for ${check?.provider?.name ?? 'the provider'}.`}{' '}
          It stops by itself after {seconds} seconds. The chart and the records stay usable.
        </p>
        <div className="button-row">
          <button type="button" className="btn" onClick={control.stop}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const took = (ms: number): string => (ms < 950 ? 'under a second' : `${Math.round(ms / 1000)} s`);

function Result(props: {
  record: SummaryRecord;
  outdated: boolean;
  busy: boolean;
  /** NCR IDs that are still stored. */
  stored: ReadonlySet<string>;
  onOpenRecord: (ncrNumber: string) => void;
  onDiscard: () => void;
}) {
  const { record, outdated } = props;
  const { summary } = record;
  const offline = record.location === 'offline';
  return (
    <div className="summary-result">
      <div className="summary-head">
        <h3 className="section-title" id="summary-result-title">
          Summary <span className="tag">AI-generated draft · Review against source records</span>
        </h3>
        <p className="summary-meta">
          {offline ? `Offline · ${record.model} · on this computer` : `Online · ${record.provider} · ${record.model}`} · generated{' '}
          {when.format(new Date(record.createdAt))} in {took(record.durationMs)} · {plural(record.recordIds.length, 'report')}{' '}
          {offline ? 'read' : 'sent'}
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
          <li key={fact}>{offline ? fact.replace('Reports sent to the model', 'Reports read by the model') : fact}</li>
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
              <span className="tag">
                {finding.author === 'valynce' ? 'Computed by Valynce' : finding.kind === 'fact' ? 'From the reports' : 'Hypothesis, not verified'}
              </span>
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
        {offline
          ? 'This is the shorter offline summary. A small model on this computer wrote the overview and the findings marked "From the reports". Valynce wrote the finding marked "Computed by Valynce", the missing information and the suggested checks from the ranking.'
          : 'A model wrote the overview, findings, missing information and suggested checks from the data listed under scope.'}{' '}
        It can be wrong. Open the cited reports to check it. Nothing here is a verified root cause.
      </p>
      <div className="button-row">
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
  const { check, mode, choice } = control;
  const block = useRef<HTMLDivElement>(null);

  // Bring the confirmation or the set-up question to the user when they ask for it, and keep the keyboard there.
  useEffect(() => {
    if (mode === 'confirm' || mode === 'setup') {
      block.current?.focus({ preventScroll: true });
      block.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [mode]);

  const latest = check?.latest ?? null;
  const available = check !== null && (choice === 'offline' ? check.offline.state === 'ready' : check.provider !== null);
  // Not while the answer on screen is still for the previous metric, filter or provider.
  const ready = available && control.fresh;
  const hint = available
    ? choice === 'offline'
      ? 'Runs on this computer. You confirm the scope first.'
      : 'Nothing is sent until you confirm what will be sent.'
    : choice === 'offline'
      ? 'Enable offline AI below to use this option.'
      : 'Configure the online provider to use this option.';

  return (
    <section className="card summary" aria-labelledby="summary-title">
      <p className="pareto-eyebrow">Optional</p>
      <h2 className="section-title" id="summary-title">
        AI analysis
      </h2>

      <ProviderChoice control={control} />

      <div className="button-row summary-action">
        <button type="button" className="btn btn-primary" disabled={!ready || mode === 'sending' || mode === 'confirm'} onClick={control.open} aria-describedby="summary-hint">
          {latest === null ? 'Generate summary' : 'Generate summary again'}
        </button>
        <span className="summary-hint" id="summary-hint">
          {hint}
        </span>
      </div>

      {mode !== 'confirm' && mode !== 'sending' && (choice === 'offline' ? <OfflineSetup control={control} /> : <OnlineSetup check={check} />)}

      {mode === 'confirm' && (
        <div className="summary-block" tabIndex={-1} ref={block}>
          <Confirm control={control} />
        </div>
      )}
      {mode === 'setup' && <div tabIndex={-1} ref={block} />}

      {mode === 'sending' && <Analyzing control={control} />}

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
            <button type="button" className="btn" disabled={!ready} onClick={control.open}>
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
          onDiscard={control.discard}
        />
      )}
    </section>
  );
}
