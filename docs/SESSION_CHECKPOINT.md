# Session checkpoint

**Stop point: October 12, 2026**, on branch `main`. Increment 4 is complete and published to GitHub as the `v0.1.0-alpha.8` prerelease.

> **First task next session: deeper AI validation before adding features.** The checks are listed under "First task next session" below. Do not publish to npm or announce on X until Paul asks for it. If you are a coding agent reading this at the start of a session, wait for an explicit request before changing product code.

## Where things stand

| | |
|---|---|
| Completed | Increment 4: the optional, evidence-linked AI summary, with its live verification and the fixes that came out of it, on top of Increments 1 to 3 and the two interface refinements |
| Branch | `main`, pushed to GitHub on October 12, 2026 with the two Increment 4 commits and a documentation commit that refreshed the README. |
| Product tag | `v0.1.0-alpha.8`, pushed. `v0.1.0-alpha.7` is Increment 4 before live verification; its tag exists locally only and was not pushed, though its commit is in `main`. |
| Earlier tags | `v0.1.0-alpha.6` is the borderless summary with USD-only cost, `alpha.5` the scrolling fix, `alpha.4` Increment 3, and `alpha.1` to `alpha.3` the earlier increments. None were moved. |
| GitHub prereleases | `v0.1.0-alpha.4`, `v0.1.0-alpha.5`, `v0.1.0-alpha.6` and `v0.1.0-alpha.8`. None for `alpha.7`. |
| Repository | https://github.com/icareon/valynce |
| Next planned | Deeper AI validation, first and before any feature. After that: export of the reports themselves. The roadmap is in `docs/REFERENCE.md`. |

The README was cut down to a short overview on October 11, 2026, and refreshed on October 12, 2026 with one light and dark comparison (`docs/screenshots/overview-light-dark.png`), a workflow and the AI wording. Data locations, definitions, limitations and the roadmap are in `docs/REFERENCE.md`.

## First task next session

Deeper AI validation before adding features. None of this has been done yet:

- Review live summaries through the actual browser panel, and click the citations.
- Use a larger, more varied synthetic evaluation set.
- Check numbers written as words.
- Check that figures attach to the correct report or category when several entities appear in one sentence.
- Check the scope of whole-analysis counts and of selected-category counts.
- Check wrong statuses, comparisons, ranking and exclusion explanations.
- Check ambiguous category names such as "Other".
- Record both unsupported claims that pass and accurate claims that are rejected.
- Repeat the live checks against the final code, and report the sample size and the actual outcomes.

The starting point is the live result and the known gaps recorded below and in `docs/REFERENCE.md`. `npm run check:ai:live` prints every reply, including rejected ones.

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

**Live verification of the AI summary** (`v0.1.0-alpha.8`)
- Figures are now tied to what a sentence is about: a number must be the evidence's figure for a report or category the sentence names (or, when it names no report, one the finding cites), or for the analysis as a whole. A share is not accepted as a count or an amount. Before, any number found anywhere in the evidence passed.
- A finding must cite every report its text names, at least one report in a category it names, and a report that has the reported cause it speaks of. Before, any valid ID passed.
- Three false rejections seen live were fixed: a fact saying a cause is "not a verified cause", and two missing-information entries naming a verified cause as absent. A claim followed by an unrelated "not" is still rejected.
- The prompt now tells the model not to repeat what instructions inside a report ask for, not to suggest converting a currency or unit, to cite what a finding names, and that coverage counts describe the whole population when only one category is listed.
- `npm run check:ai:live` prints every reply in full, including a rejected first reply and the reasons.

## Verification actually completed

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

- **A summary in the app with a real key, used by a person.** The live check calls the server's routes directly. The panel showed a live reply twice during the README capture, driven by a script; nobody clicked its citations.
- **A person reading live summaries.** The replies were read by the coding agent. The checks cannot tell whether a sentence misreads a report, and numbers written as words are not checked; see `docs/REFERENCE.md`.
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
```

To reproduce the tagged alpha exactly: `git checkout v0.1.0-alpha.8 && npm ci && npm run build && npm test`.

## When work resumes

1. Read `AGENTS.md`, then this file.
2. Check `git status`. The Remotion project in `demo/` and a related paragraph in `AGENTS.md` are deliberately uncommitted; leave them unless asked.
3. Re-run the checks above before changing anything.
4. Start with the deeper AI validation listed under "First task next session". Do not add features before it.
5. Do not publish to npm or post to X unless asked.
