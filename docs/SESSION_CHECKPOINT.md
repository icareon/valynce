# Session checkpoint

**Stop point: October 11, 2026.** Product development is paused here.

> **Do not resume development until Paul asks for it.** That means no Increment 4, no new features, no npm publication and no announcements. If you are a coding agent reading this at the start of a session, wait for an explicit request before changing product code.

## Where things stand

| | |
|---|---|
| Completed | Increments 1, 2 and 3 of the Week 1 plan, plus one layout fix |
| Product tag | `v0.1.0-alpha.5` (commit `1957069`): Increment 3 with the scrolling fix and compact summary row |
| Earlier tags | `v0.1.0-alpha.4` is Increment 3 as first completed. `alpha.1` to `alpha.3` are the earlier increments. None were moved for the fix. |
| After the tag | Documentation only: README links and this file. |
| Repository | https://github.com/icareon/valynce |
| Next planned | Increment 4: an optional, evidence-linked AI summary that cites the report IDs it is based on |

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

## Verification actually completed

All of this ran on macOS with Node 24.21.0, against commit `1957069`, from a clean clone:

- `npm ci`, `npm run typecheck`, `npm test` (65 tests) and `npm run build` passed.
- `npm run check:browser` passed all 166 checks in headless Chrome. They cover loading and removing demo data, filters, the detail panel by keyboard, a full CSV import, re-import, removal of an import, the number-format choice, all three Pareto metrics against `fixtures/pareto-check.csv`, the CSV export, both themes, toggle persistence, text contrast, keyboard focus, reduced motion, layout at 1440x900, 1280x800 and 390x800, and persistence across server restarts.
- Scrolling was checked with real wheel events over the chart, table, sidebar and page background, on the Overview, Records and Import views, with a short filtered table, a one-row table and the detail panel open. In each case only the document scrolls, it is exactly as tall as its content, and the app bar and rail stay in place. The original fault was reproduced and measured before the fix.
- Figures for `fixtures/pareto-check.csv` were worked out by hand and match the tests and the app.
- Screenshots in both themes were inspected by the coding agent, not by a person.
- The demo video was recorded and its duration (20 s), size (1280x720) and final frame were checked.
- The database upgrade was tested on a copy of an existing local database.
- Git history was scanned for credentials, data files and private material before publication. None was found.

After publication, CI on GitHub runs installation, type checking, tests and the build on Linux.

## Still outstanding

These need a person, and none has been done:

- **Human visual review** of the interface in both themes, including comparison with the intended reference design.
- **Full playback** of the demo video from start to finish.
- **Platform checks**: Windows, Linux desktop, Safari and Firefox.
- **Assistive technology**: screen readers, and keyboard use by a person.
- **Real pointer use**: hover on the chart was not exercised by the automated checks.
- `npm run dev` was not re-run after Increment 3.
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
```

To reproduce the tagged alpha exactly: `git checkout v0.1.0-alpha.4 && npm ci && npm run build && npm test`.

## When work resumes

1. Read `AGENTS.md`, then this file.
2. Confirm `git status` is clean and `main` matches `origin/main`.
3. Re-run the checks above before changing anything.
4. Start Increment 4 only when asked. Its constraints are already in `AGENTS.md` under "Network and AI": keys stay server-side, nothing is sent to a model without an explicit user action, and a summary must cite the report IDs it rests on and must not present anything as a verified root cause.
