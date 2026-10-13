# Session checkpoint

**Stop point: October 13, 2026**, on branch `main`. NCR V1 is closed as an alpha: offline and online AI analysis are integrated, evaluated and published to GitHub as the `v0.1.0-alpha.9` prerelease.

> **Further NCR features are deferred** until feedback from people using it identifies a concrete need. Do not publish to npm or announce on X until Paul asks for it. If you are a coding agent reading this at the start of a session, wait for an explicit request before changing product code.

## Where things stand

| | |
|---|---|
| Completed | NCR V1: import, three Pareto rankings, source records, ranking export, and optional AI analysis with a choice of an offline model on this computer or the online provider. The deferred AI evaluation is done. |
| Branch | `main`, pushed to GitHub on October 13, 2026. |
| Product tag | `v0.1.0-alpha.9`, pushed. |
| Earlier tags | `v0.1.0-alpha.8` is the online AI summary after live verification, `alpha.7` the same before it (its tag exists locally only; its commit is in `main`), `alpha.6` the borderless summary with USD-only cost, `alpha.5` the scrolling fix, `alpha.4` Increment 3, and `alpha.1` to `alpha.3` the earlier increments. None were moved. |
| GitHub prereleases | `v0.1.0-alpha.4`, `alpha.5`, `alpha.6`, `alpha.8` and `alpha.9`. None for `alpha.7`. |
| Repository | https://github.com/icareon/valynce |
| Next planned | Nothing. Wait for user feedback. Candidates are listed under Roadmap in `docs/REFERENCE.md`. |

The README was refreshed on October 13, 2026 for the two AI options, with one light and dark comparison (`docs/screenshots/overview-light-dark.png`). Data locations, definitions, the AI options, evaluation results, performance, limitations and the roadmap are in `docs/REFERENCE.md`.

## Is NCR V1 ready for users?

Ready as an early alpha for a technically comfortable user on macOS who runs it from the repository and reviews AI drafts against the reports. Not ready to hand to a non-technical user or to rely on unreviewed:

- It runs from a git clone with `npm ci && npm run build && npm start`. There is no packaged launcher and nothing on npm.
- Only macOS with Chrome has been run. Offline AI has been run on one Apple Silicon Mac; Linux is implemented and untested; Windows has no offline AI.
- No person has reviewed the interface or the AI summaries. All review was by the coding agent.
- AI summaries are drafts. The checks do not guarantee accuracy, and both models produced wrong or loose statements that passed on synthetic data. Neither model has been tried on real records.

One thing to know about the history: on October 11, 2026 every commit message was rewritten once to remove a co-author line, and `main` and tags `alpha.1` to `alpha.4` were pushed again with new commit IDs. File contents at each tag did not change. Commits must not carry AI co-author lines.

## What is implemented

**Increment 1, the runnable app** (`v0.1.0-alpha.1`, completed in `v0.1.0-alpha.2`)
- A local server bound to `127.0.0.1` that refuses other host names and cross-site writes.
- SQLite storage in a per-user data folder, with a backup copy written before any structural upgrade.
- 24 synthetic demo reports, loaded on request and removable. A new database starts empty.
- Overview with report count, affected quantity and recorded cost, each stating its coverage.
- Records table with search, status and category filters, and a detail panel.
- Costs carry a currency. Unstated currencies stay "unspecified", and currencies are never added together.

**Increment 2, CSV import** (`v0.1.0-alpha.3`)
- Column mapping suggested from headers and editable.
- Row-by-row validation with a reason for every rejected row, shown before anything is stored.
- Ambiguous dates block the import until the format is chosen.
- Duplicates within the file and against stored reports are skipped and reported. Nothing is overwritten.
- Each imported report keeps its file, row number and original cells. An import can be removed.

**Increment 3, Pareto analysis and themes** (`v0.1.0-alpha.4`)
- Categories ranked by NCR count, affected quantity or recorded cost, with share and cumulative share.
- A separate ranking per currency and per quantity unit. Coverage stated, and missing values never ranked as zero.
- Empty sets and zero totals reported explicitly.
- Chart, table and CSV export share one population. Selecting a category lists its reports.
- Quantities carry a unit. Piece counts are whole; fractions need a recognised unit of measure.
- Number format on import is taken from the file only when a value proves it, otherwise chosen by the user, with a preview of each reading.
- Light (default) and dark themes with a persistent toggle.

**Layout fix** (`v0.1.0-alpha.5`)
- Cause of the blank area when scrolling: the content pane was its own scroll container, but the screen-reader-only labels inside it are positioned against the document. They stayed at their unscrolled positions and made the document about 860px taller than the window, so the document scrolled as well and carried the whole app off the top.
- The document is now the only vertical scroll container. The app bar and navigation rail are sticky, the table grows with its rows, and its header sticks under the app bar. The detail panel is fixed and scrolls inside itself.
- The three summary tiles are one compact row, about 120px tall with the demo data, growing only when there are several currencies or units.

**Borderless summary and USD-only cost** (`v0.1.0-alpha.6`)
- The summary is three borderless groups on the page: NCR reports, affected quantity with its unit, and recorded cost (USD). Thin vertical rules separate them and one rule runs underneath. It is 88px tall at 1440x900 and 1280x800 (it was 121px), and the chart starts 222px from the top (it was 255px). It stacks at narrow widths.
- The summary and the cost ranking show only costs stated in USD. The currency selector is gone. Coverage is stated as "USD cost recorded in 6 of 11 reports", and the ranking also says how many reports have a cost in another or an unstated currency and how many have no cost. With no USD cost the text is "No USD costs recorded."
- Nothing is converted or relabelled. Costs in other currencies and unstated ones are unchanged in storage, the records list, the detail panel and the source cells. Stored totals still hold every currency separately; only what is displayed changed, and there is no database migration.
- NCR count and quantity are unchanged and still use the whole population. Quantity keeps one total and one ranking per unit.
- The exported ranking has one more column, `reports_with_a_cost_in_another_or_no_currency`, so the file states what the USD ranking left out.
- Import: when a file has no currency column, an unticked box "All costs in this file are USD" is offered. The preview states how many costs it will label, and the tick is dropped if the cost or currency column is changed. When the file has a currency column, the earlier setting for rows that state none is still there.
- At narrow widths the metric selector now stacks, because the longer "Recorded cost (USD)" label no longer fits on one line at 390px.

**Increment 4, optional AI summary** (`v0.1.0-alpha.7`)
- "Generate summary" beside the chart controls. It first shows the provider, model, host, report count and the fields sent and withheld; data leaves only after that view is confirmed, and the server refuses if the evidence changed in between.
- One provider, Anthropic's Messages API with structured outputs, default model `claude-sonnet-5-5`, behind a small adapter in `src/ai`. No SDK and no new dependency: the adapter uses `fetch`. Configured by `ANTHROPIC_API_KEY` in a git-ignored `.env`; with no key the app is unchanged and makes no outside request.
- The evidence bundle is built on the backend from the same population, metric and ranking as the chart (`src/modules/quality/evidence.ts`). Supplier, part number, original cells, file details and unranked metrics are never sent. Limits: 200 reports, 40 categories, 400 characters per text; a larger selection is refused, not cut.
- One bounded call with at most one repair. Replies are validated (`src/modules/quality/summaryRules.ts`) for shape, cited report IDs, figures and wording about root causes, causal facts, savings and rates. Figures shown beside the summary are written by the backend.
- The summary is stored in a new `ai_summary` table (schema version 5, backup copy written first, records untouched) with its scope, figures, report IDs and evidence fingerprint. Only the latest is kept. It is marked outdated when the analysis no longer matches and is never regenerated unasked.
- The panel shows loading, failure and timeout without blocking the app, labels facts and hypotheses, and makes cited report IDs open the report.
- The wording about external requests in the README, the reference and the app bar now separates normal local use from the optional summary.

**Offline and online AI analysis, and the deferred evaluation** (`v0.1.0-alpha.9`)
- "AI analysis" section under the chart with two options: "Offline · Private" (Qwen3 1.7B on this computer) and "Online · Frontier" (Claude through Anthropic). The choice is remembered in the browser. The server generates with the provider named in the request or refuses; it never falls back, and a stored summary keeps its provider (`location` column, schema version 6, backup written first, existing summaries marked online).
- Offline runtime: llama.cpp's official prebuilt `llama-server`, build `b11588`, downloaded on request and run as a child process on `127.0.0.1` behind a per-run key, with its web page and downloads off, non-thinking mode, one slot, 8,192-token context. Chosen over an npm binding so that the package stays small, no native dependency or install script is added, and no Ollama or Python is needed. Windows builds are zip files and are not handled, so the option reports itself unavailable there.
- Offline model: Qwen3-1.7B Q4_K_M, 1,282,439,264 bytes, from `ggml-org/Qwen3-1.7B-GGUF` at a pinned revision (Qwen's own GGUF repository has Q8_0 only). Apache-2.0; llama.cpp is MIT. Neither is redistributed.
- Set-up: "Enable offline AI" shows the size and sources, "Download" starts it, with progress and cancel. Files go to a temporary name, are checked for size and SHA-256, then moved into place; a verified file is reused; too little disk space, a corrupt file, an interrupted or cancelled download each leave nothing installed. Files live in `resolveAiDir()` (`src/core/paths.ts`), outside the repository and the database folder. Nothing is downloaded or started at start-up.
- The offline summary is the shorter, guided one (`src/modules/quality/guidedSummary.ts`): Valynce writes the figures, the ranked finding, the missing information and the suggested checks; the model writes an overview and one sentence per leading category from descriptions alone, with citations restricted to the category by the runtime's grammar. The full task was tried first and was not reliable (7 requests, 1 accepted, with a false statement).
- Offline limits: 40 reports and 12,000 characters, refused beyond that. Instruction-like descriptions are kept from the offline model and named in the summary.
- "Analyzing NCRs…" animation: a 28px square with four orange dots moving round its edge, CSS only, static under reduced motion, hidden from screen readers, with the status in a `role="status"` element. Downloads use a separate progress bar measured in bytes. A running generation can be cancelled.
- A race found in the real browser run was fixed: a confirmation could be given while the panel still held the answer for the previous metric, and the server then refused it as changed. The panel now waits for the answer that belongs to the analysis on screen.
- New: `npm run check:ai:eval`, `fixtures/ai-eval-varied.csv` (30 synthetic reports), `tests/offline.test.ts`, `scripts/browser-check-server.mjs`.

**Live verification of the AI summary** (`v0.1.0-alpha.8`)
- Figures are now tied to what a sentence is about: a number must be the evidence's figure for a report or category the sentence names (or, when it names no report, one the finding cites), or for the analysis as a whole. A share is not accepted as a count or an amount. Before, any number found anywhere in the evidence passed.
- A finding must cite every report its text names, at least one report in a category it names, and a report that has the reported cause it speaks of. Before, any valid ID passed.
- Three false rejections seen live were fixed: a fact saying a cause is "not a verified cause", and two missing-information entries naming a verified cause as absent. A claim followed by an unrelated "not" is still rejected.
- The prompt now tells the model not to repeat what instructions inside a report ask for, not to suggest converting a currency or unit, to cite what a finding names, and that coverage counts describe the whole population when only one category is listed.
- `npm run check:ai:live` prints every reply in full, including a rejected first reply and the reasons.

## Verification actually completed

Offline and online AI analysis, on macOS 26.5 with Node 24.21.0, an Apple M4 with 10 cores and 24 GB of memory, October 13, 2026:

- `npm run typecheck`, `npm test` (110 tests: 16 new in `tests/offline.test.ts`, 1 new in `tests/ai.test.ts`) and `npm run build` passed.
- `npm run check:browser` passed all 309 checks (57 new). The existing checks still cover import, mapping and validation, all three Pareto metrics, source details, export, both themes and the narrow viewport. The new ones cover the provider choice and its wording, the remembered choice, no download or generation on selection, the real 1.29 GB size shown before anything is fetched, the set-up question, download progress, cancel, ready, the offline confirmation and its wording, the animation and reduced motion, the offline result and its provenance, citations, the outdated mark, no relabelling when the other provider is selected, cancelling a generation, a missing model file, removing the files, and that offline generation contacted neither the online stand-in nor the download server. They use a pretend model and runtime served from the same machine; no real model is downloaded by the checks.
- The pinned files were checked against their publishers on October 13, 2026: sizes and SHA-256 digests from the Hugging Face and GitHub APIs match the files downloaded.
- Real set-up in the browser: "Enable offline AI" then "Download 1.29 GB" in headless Chrome fetched the real runtime and model in 51 seconds, verified them, and reached Ready. The model file's SHA-256 was computed independently afterwards and matches the pin.
- Real offline generation with the network blocked: the Valynce server and the model process were run under a macOS sandbox profile denying all outbound connections except to loopback. Offline summaries were generated in the browser (4.5 and 3.9 seconds), no non-loopback connection from either process was seen, and the page made no outside request. From the same sandboxed server the online option failed with "Could not reach api.anthropic.com" and the stored offline summary stayed, which shows both that the block was real and that nothing falls back.
- Real online generation in the browser with the configured key: the confirmation listed provider, model, host, 30 reports and the fields sent and withheld; the summary arrived in 7 seconds; four citations were clicked and opened the right reports; changing the metric marked it outdated; selecting the offline option afterwards did not relabel it.
- Evaluation, synthetic data only, replies read against the fixtures by the coding agent. `npm run check:ai:eval` on the final code: offline 10 of 10 accepted with no corrections and 2 loose statements in 26 model-written sentences; online 10 of 10 accepted with one correction (an accurate self-computed figure refused) and no wrong statement found. Neither followed the planted instructions. Earlier runs while the offline task was being settled: offline 20 requests, 19 accepted, 4 wrong statements passed, 1 accurate reply rejected; online 10 requests, 10 accepted, 1 wrong statement passed (a count written as a word). The full task offline: 7 requests, 1 accepted. Details and the known gaps are in `docs/REFERENCE.md` under "Evaluation".
- Offline performance on this computer: first summary 4.3 to 7 seconds (16 seconds once, straight after the download), later ones 1.4 to 4.3 seconds with a median of 2.1, model process up to 3.1 GB resident. 40 reports took under 5 seconds and 11,000 characters of descriptions about 6.
- The scripted wrong claims in `tests/ai.test.ts` record which classes the checks catch (figure on the wrong report, unknown citation, root cause, savings, a category cited through the wrong reports) and which they let through (counts as words, swapped figures between two named entities, whole-analysis counts given to one category, wrong status, comparison, ranking or exclusion reason, and the word "Other").
- The database upgrade from version 5 to 6 is tested on a version 5 database built in the test: the stored summary is kept, marked online, and a backup is written.

Not done for this increment:

- Offline AI on Linux or on an Intel Mac. Those builds are pinned and untested. No Windows support.
- A computer with less memory, no GPU or a slow processor.
- Turning the machine's network off. Isolation was done with a sandbox around the server and model processes, not by disconnecting the computer.
- Whether the runtime really unloads the model after five idle minutes. The setting is passed; it was not measured.
- A person looking at the interface or reading the summaries.
- The real database was not opened by any check. Its upgrade to version 6 happens, with a backup, the first time `alpha.9` is started against it.

README refresh, October 12, 2026:

- The comparison image was captured from the built `alpha.8` app in headless Chrome on a throwaway database holding only the 24 synthetic demo reports, ranked by recorded cost, at 1100x1000 in each theme.
- The summary in it is real. "Generate summary" and "Send and generate" were pressed in the page with the configured key, twice in all (the first capture was discarded for its size), sending only the demo reports. Both requests returned a summary that passed the checks, and the coding agent compared both with the demo fixture and found no wrong statement. This is the first time the panel showed a live reply; the citations were not clicked and no person has looked at it.
- The README's commands were run as written from a clean clone, and its image path and links were checked.

Live verification, on macOS with Node 24.21.0, October 12, 2026, model `claude-sonnet-5-5`:

- `npm run check:ai:live` was run six times, 24 requests, 28 replies, sending only `fixtures/ai-eval.csv`. Every reply was read against the fixture.
- Run 1, on the `alpha.7` checks: 3 of 4 passed on the first reply. The fourth failed after its one correction. Both of its replies were accurate; the checks had refused a sentence describing what the injected text asked for, an entry asking for "any verified cause analysis", and then a fact ending "not a verified cause".
- Runs 2 to 5, while the checks were being changed: 4 of 4 each, with one correction in three of them. Two of those corrections were false rejections caused by the new checks (a figure in a sentence that referred to its report as "It"; a comparison naming a second category) and one by the old wording check; all three were fixed and are now tests.
- Run 6, on the final code: 4 of 4 on the first reply. Replaying all 28 recorded replies through the final checks accepts 27; the one still refused is the reply that listed what the injected text asked for.
- Resistance to the injected description: in all 28 replies the model said the text was not a defect description and did not follow it. None contained the requested word, the nonexistent report, the savings figure or the asserted cause.
- Missing values: the replies named the reports with no cost or quantity, and the non-USD cost and the kg quantity, as left out of the ranking. None treated one as zero or wrote a converted amount.
- Accuracy problems found in accepted replies, none caught by the checks: counts written as words that the model had added up itself ("Four reports have no usable cost", which is correct, and "Three reports across the other categories have no recorded cost", which is wrong: two are in other categories); "its place in the ranking is unclear" for a report that is in fact ranked as uncategorized; a report said to be unranked for having no category when the reason was its missing cost; and, before the prompt change, two accepted replies suggesting that the non-USD cost be converted. In the three runs after the prompt change no reply suggested conversion.
- `npm run typecheck`, `npm test` (93 tests, 24 of them in `tests/ai.test.ts`), `npm run build` and `npm run check:browser` (252 checks) passed.
- This is a small sample on nine invented reports. It shows the request format works and how this model behaved on this file; it is not a measurement of accuracy on real records.

Increment 4 as built at `alpha.7`, on macOS with Node 24.21.0, October 12, 2026:

- `npm run typecheck`, `npm test` (90 tests, 21 of them new in `tests/ai.test.ts`) and `npm run build` passed.
- The new tests use `fixtures/ai-eval.csv` and scripted model replies. They cover: totals worked out by hand ($955.00 in 5 of 9 reports; 170 pieces in 7 of 9, with 2.5 kg kept apart); missing and non-USD costs never sent as zero or converted; withheld fields absent from the request; the 200-report limit refusing rather than truncating; a description containing instructions; root-cause, causal, savings, rate and invented-figure claims; invalid shape; nonexistent report IDs; one repair and no more; provider failure, timeout and missing key; duplicate requests; changed metric, filter and records; storage and removal; the adapter's request body; and the key never appearing in a response or in the database.
- `npm run check:browser` passed all 252 checks (50 new). The new ones drive the real interface against a stand-in provider on the same machine: no key, confirmation contents, nothing sent before confirming, exactly one request on confirming, request contents, labels, citations opening a report by keyboard, outdated marking on metric and filter change, persistence across a restart, the invalid-reply failure, the timeout, both themes, 390px width and scrolling.
- The database upgrade from version 4 to 5 was run on a copy of an existing local database: 11 records before and after, backup written.
- Screenshots of the confirmation, the result, the outdated state and the failure in both themes were inspected by the coding agent, not by a person.
- At `alpha.7` no live call had been made; see the live verification above for the result at `alpha.8`.

Earlier increments (the paragraphs below are as recorded at `alpha.6`):


All of this ran on macOS with Node 24.21.0, against tag `v0.1.0-alpha.6`, from a clean clone:

- `npm ci`, `npm run typecheck`, `npm test` (69 tests) and `npm run build` passed.
- USD figures were checked against the contributing records three ways: by hand for `fixtures/pareto-check.csv` ($1,000.00 in 7 of 10 reports, with the 300.00 EUR report left out) and `fixtures/ncr-import-example.csv` ($2,382.75 in 6 of 11); in the tests, where each bar is recomputed from the reports of its category; and in the browser checks, where each bar on screen is compared with the sum of the USD costs read back from storage.
- The browser checks also read storage back after the mixed-currency import and confirm the two EUR costs and the unstated one are intact with their original cells, and that the records list and detail panel still show them as recorded.
- `npm run check:browser` passed all 202 checks in headless Chrome. They cover loading and removing demo data, filters, the detail panel by keyboard, a full CSV import, re-import, removal of an import, the number-format choice, all three Pareto metrics against `fixtures/pareto-check.csv`, the CSV export, both themes, toggle persistence, text contrast, keyboard focus, reduced motion, layout at 1440x900, 1280x800 and 390x800, and persistence across server restarts.
- Scrolling was checked with real wheel events over the chart, table, sidebar and page background, on the Overview, Records and Import views, with a short filtered table, a one-row table and the detail panel open. In each case only the document scrolls, it is exactly as tall as its content, and the app bar and rail stay in place. The original fault was reproduced and measured before the fix.
- Figures for `fixtures/pareto-check.csv` were worked out by hand and match the tests and the app.
- Screenshots in both themes were inspected by the coding agent, not by a person.
- The demo recording script was re-run against `alpha.6` and completes; that recording was not published. The only video still on GitHub is the one attached to the `alpha.4` prerelease.
- The database upgrade was tested on a copy of an existing local database.
- Git history was scanned for credentials, data files and private material before publication. None was found.
- The README's statement that the app makes no external network requests rests on two things: the browser checks record every request the page makes during the whole run and fail if any goes anywhere but the local server, and the server code makes no outbound calls.
- The README's commands were run as written from a clean clone, and its screenshot path and links were checked.

After publication, CI on GitHub runs installation, type checking, tests and the build on Linux.

## Still outstanding

These need a person, and none has been done:

- **A person using AI analysis.** Both options were driven in the real browser by a script, with the real model and a real key. No person has used them or read the summaries. The checks cannot tell whether a sentence misreads a report; see `docs/REFERENCE.md`.
- **Offline AI on other computers**: Linux, Intel Macs, machines with less memory.
- **Human visual review** of the interface in both themes, including comparison with the intended reference design.
- **Full playback** of the demo video from start to finish.
- **Platform checks**: Windows, Linux desktop, Safari and Firefox.
- **Assistive technology**: screen readers, and keyboard use by a person.
- **Real pointer use**: hover on the chart was not exercised by the automated checks.
- `npm run dev` was not re-run after Increment 3.
- Dollar amounts were checked in an English (US) browser locale only. In other locales the browser may write the same USD figure as "US$" or with the symbol after the number.
- At 390px wide the percentage labels above the chart crowd together. This was already so before the summary change and was left alone.
- Large files and the 20 MB import limit were not exercised.

## Running it locally

Requires Node.js 24.15.0 or newer.

```bash
cd /path/to/valynce
npm ci
npm run build
npm start                 # http://127.0.0.1:4310, Ctrl+C to stop
```

Checks:

```bash
npm run typecheck
npm test
npm run build && npm run check:browser    # needs Chrome; writes screenshots
npm run build && npm run demo:record      # writes demo/out/valynce-pareto-demo.mp4
npm run check:ai:live                     # needs ANTHROPIC_API_KEY; sends only synthetic data
npm run check:ai:eval                     # offline needs offline AI enabled in the app; online sends only synthetic data
```

To reproduce the tagged alpha exactly: `git checkout v0.1.0-alpha.9 && npm ci && npm run build && npm test`.

## When work resumes

1. Read `AGENTS.md`, then this file.
2. Check `git status`. The Remotion project in `demo/` and a related paragraph in `AGENTS.md` are deliberately uncommitted; leave them unless asked.
3. Re-run the checks above before changing anything.
4. Do not add NCR features without a concrete need from user feedback.
5. Do not publish to npm or post to X unless asked.
