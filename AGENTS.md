# Valynce project rules

These rules apply to every contributor and every coding agent working in this repository. `CLAUDE.md` imports this file, so edit the rules here only.

## Current status

Read `docs/SESSION_CHECKPOINT.md` before starting. It records where work stopped, what was verified and what is still outstanding. If it says development is paused, do not change product code until asked.

## How we work

- **Build incrementally.** Each increment is a small, runnable step. Do not start the next one until the current one builds, passes its checks and has been tried.
- **Verify official documentation.** Before adding or upgrading a dependency, or relying on a runtime feature, read its current official documentation and check the published version. Do not work from memory.
- **Validate evidence.** Say something works only after running the check that shows it, and report what was not checked. A number shown to a user must be traceable to the records behind it.
- **Explain each increment.** Report what changed, a lesson in exactly three sentences, how to try it, and what was verified.
- **Commit after each working increment**, then tag it (see "Git and releases").

## Layout

| Folder | Contents |
|---|---|
| `src/ui` | Browser interface |
| `src/server` | Local backend |
| `src/modules/quality` | NCR rules and analysis |
| `src/core` | Shared entities and storage |
| `src/ai` | Model adapters and prompts |
| `src/cli` | NPX launcher |
| `fixtures` | Synthetic example records |
| `tests` | Meaningful correctness checks |
| `demo` | Remotion video project |

Put code in the folder that owns it. Entities and storage shared across modules belong in `src/core`; logic specific to quality and NCRs stays in `src/modules/quality`. Model calls and prompt text live in `src/ai`, not scattered through the UI, server or modules.

## Data and secrets

This repository is public. Nothing below may ever be committed, pasted into an issue or pull request, or written into a test, prompt, log or demo:

- **Customer data**: real NCRs, part numbers, supplier or customer names, exports, screenshots of real records.
- **Local databases**: any database file or dump the app creates or reads at runtime.
- **Credentials**: API keys, tokens, passwords, certificates, private keys, filled-in `.env` files.

How to stay inside that:

- The app stores its database in a per-user data folder outside the repository and outside the npm package (see `src/core/paths.ts`), so updates never erase it. `npm run dev` uses `data/` in the repository instead, which is git-ignored. Do not add another location for runtime data without ignoring that too.
- Secrets are read from environment variables, optionally from a local `.env` file. Commit `.env.example` with variable names and no values; never a real `.env`.
- `fixtures` holds synthetic records only, written by hand or generated. Never anonymise a real record into a fixture; invent one.
- Do not weaken `.gitignore` or use `git add -f` to get an ignored file in.
- Check `git status` and the staged diff before every commit.
- If a secret or customer record is committed, say so immediately. The credential must be rotated and the history rewritten; deleting the file in a later commit is not enough.

## Manufacturing definitions

These terms keep their shop-floor meaning. Do not rename, merge or reinterpret them in code, labels, prompts or documentation.

| Term | Meaning in Valynce |
|---|---|
| NCR | Non-conformance report: one record of a part or process that did not meet a requirement. |
| NCR count | The number of reports. One report counts once, however many units it covers. |
| Affected quantity | The quantity the report says was affected. With no unit it is a whole count of pieces; with a unit of measure such as kg it may be fractional. |
| Recorded cost | The cost written on the report. It is not an estimate or a full cost of poor quality. |
| Defect category | The classification written on the report. |
| Disposition | What was decided for the affected material, such as scrap, rework, use as is or return to supplier. |
| Reported cause | The cause as written on the report. It is not a verified root cause. |
| Demo data | Valynce's own synthetic records, stored with origin `sample` and costed in USD. Always labelled as demo data wherever it appears. |
| Pareto analysis | Categories ranked from largest to smallest by one stated metric, with each category's share of the total and the cumulative share. A Pareto chart is always of one metric, in one unit or currency. |
| Population | The reports an analysis covers: those matching the search and status filter. The chart, the table under it and the export always use the same population. |

## Analysis rules

- A value that was not recorded is `null` everywhere: storage, API and UI. Never replace it with zero, an empty string, an average or a guess. Totals state how many records had no value.
- NCR count, affected quantity and recorded cost are three different metrics. Label each one wherever it is shown and never merge or rank them as if they were one.
- `reportedCause` is what the report says. Do not present it, or anything a model produces, as a verified root cause.
- Cost is stored as whole hundredths (`costCents`) so sums are exact, with an ISO 4217 `currency` beside it.
- A cost whose currency was not stated has `currency` null and is shown as "Currency unspecified". Never assign a currency to it, and never infer one from a symbol such as `$`.
- Never add amounts in different currencies, or stated and unstated ones, together. Show one total per currency. Valynce does not convert.
- Affected quantity is stored in whole thousandths with its unit. A quantity with no unit is a count of pieces and must be whole. A fraction is accepted only with a recognised unit of measure.
- Never add quantities in different units together. Show one total, and one Pareto ranking, per unit.
- Categories, statuses and other values are compared exactly as written. Do not merge, rename or normalise them. The only exceptions are units: spellings of "pieces" all mean a count, and known units of measure are stored under one symbol.

## Pareto rules

- A ranking is computed in `src/modules/quality/pareto.ts` from one population and one metric. The chart, the readout, the table of contributing records and the exported file must all come from that same result.
- Every report in the population is either in exactly one ranking or counted as missing for the metric. State the coverage beside the chart. A missing value is never ranked as zero.
- When the total is zero, say so and show no shares. When nothing has a value, or no report matches, say that instead of drawing an empty chart.
- Rank the uncategorized bucket by its size like any other, and draw it differently so it reads as "unknown".
- Never call the leading category a cause, a driver or a root cause. A ranking shows where reports, quantity or cost are recorded, not why.

## Import rules

- Reading a file never guesses. A date that could be read two ways blocks the import until the user chooses the format; an amount is read exactly or the row is rejected; nothing is rounded.
- The same holds for numbers. A format is taken from the file only when a value proves it ("1,234.56" or "12,5"). A value such as "1,234" proves nothing, so the user must choose, and the preview shows how each number will be read before anything is stored.
- A currency comes from the file's currency column or from the setting the user chose for that import. It is never taken from a symbol or assumed.
- Every row gets a stated outcome: imported, error (with every reason), repeated in the file, already stored, or blank. Rows are numbered as a spreadsheet shows them, with the header as row 1.
- Stored records are never overwritten. A row whose NCR ID already exists, or appeared earlier in the file, is skipped and reported with the fields that differ.
- An import is stored completely or not at all, together with an entry recording the file name, its SHA-256, the time, the mapping used and the row counts.
- Each imported record keeps its import, its row number and the row's original cells, so any figure can be traced back to the file. Do not drop or alter these.
- CSV splitting lives in `src/core/csv.ts`; what a row means lives in `src/modules/quality/importRules.ts`. The server only wires them to storage.

## Network and AI

- The server binds to `127.0.0.1` only and refuses requests under other host names and writes from other origins. Do not loosen this.
- Model provider keys stay in the server process. They are never sent to the browser.
- Records are sent to an AI provider only when the user explicitly triggers it for that request. Nothing is sent in the background.

## Dependencies and commands

- Dependencies are pinned to exact versions and `package-lock.json` is committed. Add one with `npm install --save-exact`, and check the package's current official documentation first.
- Node.js 24.15 or newer is required, because storage uses the built-in `node:sqlite` module.
- Backend code runs as TypeScript directly in Node. Use `.ts` extensions in imports, `import type` for types, and no enums, namespaces or constructor parameter properties.

| Command | What it does |
|---|---|
| `npm run dev` | Backend with reload plus the Vite dev server at `http://127.0.0.1:5310` |
| `npm test` | Runs the tests in `tests` |
| `npm run typecheck` | Type-checks UI, backend and tests |
| `npm run check:browser` | Drives the built app in headless Chrome: clicks, keyboard, filters, both themes, restarts, layout and contrast. Needs `npm run build` first and a local Chrome |
| `npm run demo:record` | Records the 20-second Pareto demo to `demo/out/` (git-ignored) using headless Chrome |
| `npm run build` | Builds the UI and backend into `dist` |
| `npm start` | Serves the built app at `http://127.0.0.1:4310` |

Run `npm run typecheck` and `npm test` before calling a change done. For a change to the interface, also run `npm run build && npm run check:browser`, look at the screenshots it writes, and add a check for the new behaviour.

## Git and releases

- Never commit `.env`, databases, customer files, `node_modules`, build output or rendered demo files. `.gitignore` covers them; keep it that way.
- Do commit `package-lock.json`, `.env.example` (variable names with no values), the synthetic fixtures and the README.
- Commit after each working increment, with the checks passing. One increment, one commit where practical.
- Tag every working increment with an annotated tag that matches `version` in `package.json`, for example `v0.1.0-alpha.1`. A tag must be reproducible with `git checkout <tag> && npm ci && npm run build && npm test`.
- Never move or delete a tag that has been pushed. Fix forward with a new version.

## Interface

- Colours, type sizes, spacing, radii, icon size and motion come from the tokens in `src/ui/tokens.css`. Do not hard-code them in components.
- There are two themes, light (the default) and dark. Both define every colour token; layout, spacing and type are shared, so a component is written once. Check any interface change in both.
- Orange is reserved for the primary action, the active view, the selected chart bar, selected controls and keyboard focus. Everything else is neutral. Orange never means "alert"; errors use the danger colour with a text label.
- Sans-serif for descriptions and table content; monospace for navigation, column and chart labels, record IDs and technical values. Numbers that line up use tabular figures.
- Surfaces are flat: thin borders, small radii, no gradients or decorative patterns.
- The browser document is the only vertical scroll container. Do not give the shell, the content area or a table a fixed height or its own vertical overflow; the app bar and navigation rail are sticky, and the table header sticks under the app bar. The one exception is the detail panel, which is fixed and scrolls inside itself. `npm run check:browser` checks this with real wheel events.
- The summary row is compact: content decides its height, with no minimum heights or stretching, and longer explanations sit behind the help buttons.
- Every control works by keyboard and shows visible focus. Status is never carried by colour alone.
- Show only controls that work. Do not add placeholders for features that are not built.
- Do not show trends, percentage changes, scores or findings that are not computed from the stored records.
- A new database starts empty. Existing databases are migrated in place after a backup copy is written beside them; a migration never drops or rewrites a user's records.

## Tests

`tests` is for checks that would fail if the behaviour were wrong. Test NCR rules and analysis against fixtures with known expected results. Do not add tests that only restate the implementation or exist to raise coverage.

Tests run offline against synthetic fixtures. They do not need real customer data, a real database or a live model key.

## Demo

Demo videos use synthetic fixtures only, since the output is published. `scripts/record-demo.mjs` records the current demo by driving the built app; rendered files go to `demo/out/` and are not committed. A Remotion project for edited videos is not set up yet.
