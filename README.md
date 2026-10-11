# Valynce

Valynce is a local-first quality tool. It runs on your own machine, with a browser interface on top of a local backend, and applies rules and AI-assisted analysis to non-conformance reports (NCRs).

> **Status:** Week 1, increment 3 of 6. The app ranks defect categories by report count, affected quantity or recorded cost (Pareto analysis), lists and filters the reports, and imports CSV files with row-by-row checks. AI summary, record export and the `npx` launcher are not built yet.

![Overview in the light theme](docs/screenshots/overview-light.png)

## Try it

Requires Node.js 24.15 or newer.

```
npm ci
npm run build
npm start
```

Then open http://127.0.0.1:4310. A new database is empty; choose **Load demo data** to add 24 synthetic reports, and **Remove demo data** to take them out again, or import your own CSV file. Press Ctrl+C in the terminal to stop the server.

For development, `npm run dev` runs the backend with reload and the interface at http://127.0.0.1:5310, using a separate database in `./data`.

| Command | What it does |
|---|---|
| `npm run dev` | Development servers with reload |
| `npm test` | Runs the tests |
| `npm run typecheck` | Type-checks everything |
| `npm run build` | Builds into `dist` |
| `npm start` | Serves the built app |
| `npm run check:browser` | Drives the built app in headless Chrome and writes screenshots |
| `npm run demo:record` | Records the 20-second Pareto demo to `demo/out/` |

## What the numbers mean

Valynce shows three different metrics and keeps them apart:

- **NCR reports**: the number of reports. Each counts once, however many units it covers.
- **Affected quantity**: the quantity affected, summed over the reports that state one. With no unit it is a count of pieces.
- **Recorded cost**: the cost written on the reports, summed over those that state one. It is not an estimate of total cost of poor quality.

Each card says how many reports had a value, for example "Quantity recorded in 21 of 24 reports."

- A value that was not recorded is shown as "—" or "Not recorded". It is never treated as zero.
- Costs carry a currency. A cost with no stated currency is shown as "Currency unspecified" and is never assumed to be dollars.
- Amounts in different currencies, and quantities in different units, are never added together; each gets its own total.
- The cause on a report is shown as the *reported* cause. Valynce does not claim it is a verified root cause.

## Pareto analysis

The Overview ranks defect categories from largest to smallest by one metric at a time. Switch between **NCR reports**, **Affected quantity** and **Recorded cost** to see how the priority changes: the category with the most reports is often not the one with the most units or the most cost.

![Recorded cost by category, with one category selected](docs/screenshots/pareto-cost-light.png)

- **Bars** show each category's share of the total. **The line** shows the cumulative share on the same 0 to 100% scale.
- **One unit at a time.** Costs in different currencies and quantities in different units cannot be added, so each gets its own ranking, chosen with the buttons beside the metric.
- **Coverage is stated.** The line under the title says how many reports have a value for the metric. Reports with none are left out of the ranking and are never counted as zero.
- **One population.** The chart, the table under it and **Export CSV** all cover the same reports: those matching the search and status filter.
- **Select a category** to list its reports below. The readout says how many of them contribute to the bar.
- **Not a cause.** The ranking shows where reports, quantity or cost are recorded. It does not show why, and the leading category is not a verified root cause.

`fixtures/pareto-check.csv` is a ten-row synthetic file small enough to check by hand, in which each metric puts a different category first. `npm run build && npm run demo:record` records a 20-second video of it to `demo/out/`.

## Light and dark themes

The button at the top right switches theme. Light is the default; the choice is remembered on this computer.

![Overview in the dark theme](docs/screenshots/overview-dark.png)

## Importing a CSV file

Open **Import**, choose a CSV file, check the column matching, and import. To try it, use the synthetic example in `fixtures/ncr-import-example.csv`: 18 rows, of which 11 import and 7 are deliberately wrong in different ways.

- **Column mapping.** Valynce matches columns it recognises by header name. You can change any of them, and only the NCR ID is required.
- **No guessing.** A date such as 03/04/2026 could be March or April, and a number such as 1,234 could be 1234 or 1.234. When the file does not settle it, you choose, and the preview shows how each number will be read before anything is stored.
- **Exact values.** An amount with a currency symbol or more than two decimals is rejected, not adjusted.
- **Units.** A quantity with no unit is a whole count of pieces. A fractional quantity is accepted only with a unit of measure such as kg, from a unit column or the import settings.
- **Row-by-row results.** Before anything is stored you see which rows will be imported and, for every other row, its row number and the reason.
- **Duplicates.** A row whose NCR ID is already stored, or appeared earlier in the same file, is skipped and reported. Stored records are never overwritten, so importing the same file twice adds nothing.
- **Traceability.** Each imported report keeps the file name, the row it came from and that row's original cells. Open a record to see them.
- **Undo.** The Import view lists imported files; removing one removes exactly the reports it added.

Files must be UTF-8 text with a header row, separated by commas, semicolons or tabs, up to 20 MB.

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

## Your data stays local

- The server listens on `127.0.0.1` only, so it is not reachable from other machines.
- Records live in a SQLite database in your user data folder, outside the app's install folder, so updating Valynce does not erase them:
  - macOS: `~/Library/Application Support/Valynce`
  - Linux: `~/.local/share/valynce` (or `$XDG_DATA_HOME/valynce`)
  - Windows: `%APPDATA%\Valynce`
  - Set `VALYNCE_DATA_DIR` to use another folder, and `VALYNCE_PORT` to change the port. Set them in your shell, or copy `.env.example` to `.env` (git-ignored) and fill them in there.
- This repository is public and contains no customer data, databases or credentials. Everything in `fixtures` is synthetic.

## Contributing

Read [AGENTS.md](AGENTS.md) before opening a pull request. It holds the project rules for both people and coding agents, including what must never be committed.

## License

[MIT](LICENSE)
