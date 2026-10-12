# Valynce reference

Technical detail that does not belong in the [README](../README.md). The rules contributors and coding agents follow are in [AGENTS.md](../AGENTS.md).

## Import

- Columns are matched by header and can be corrected. Every row gets a stated outcome before anything is stored, and each rejected row is listed with its row number and reason.
- A date such as `03/04/2026` or a number such as `1,234` can be read two ways. When the file does not settle it, you choose, and the preview shows how each number will be read.
- A file with no currency column can be marked "All costs in this file are USD" by ticking a box. Valynce never does this for you.
- Each imported report keeps its file name, row number and original cells. An import can be removed, which takes out exactly the reports it added.
- To see the Pareto analysis at its clearest, import [`fixtures/pareto-check.csv`](../fixtures/pareto-check.csv) and switch the metric: Labeling leads by report count, Dimensional by affected quantity and Material by recorded cost.

## Where your data lives

- **Local only.** The server listens on `127.0.0.1`, so other machines cannot reach it. It refuses requests under other host names and writes coming from other websites.
- **No outside requests today.** Fonts are bundled. The app contacts nothing but its own local server, and there is no telemetry. The planned AI summary would send the reports it summarises to a model provider, and only when you ask for it.
- **Where the database lives.** In your per-user data folder, outside the project folder, so updating or deleting the project does not touch your records:

  | System | Folder |
  |---|---|
  | macOS | `~/Library/Application Support/Valynce` |
  | Linux | `~/.local/share/valynce` (or `$XDG_DATA_HOME/valynce`) |
  | Windows | `%APPDATA%\Valynce` |

  Set `VALYNCE_DATA_DIR` to use another folder and `VALYNCE_PORT` to change the port, in your shell or in a `.env` file copied from [`.env.example`](../.env.example).
- **Backups.** When a newer version needs to change the database's structure, it first saves an untouched copy beside it, named like `valynce.db.v3.bak`. There are no scheduled backups: to make your own, stop Valynce and copy `valynce.db`.

## What the numbers mean

| Term | Meaning |
|---|---|
| **NCR count** | The number of reports. Each report counts once, however many units it covers. |
| **Affected quantity** | The quantity the reports say was affected. With no unit it is a whole count of pieces; with a unit of measure such as kg it may be fractional. |
| **Recorded cost** | The cost written on the reports. It is not an estimate of the total cost of poor quality. |
| **Share / cumulative** | A category's part of the total of the values that were recorded, and the running sum of those parts down the ranking. |
| **Reported cause** | The cause as written on the report. Valynce does not treat it as verified. |

Three rules hold everywhere:

- **Missing is not zero.** A value that was not recorded is shown as "—" or "Not recorded" and is left out of sums. Every total and every chart says how many reports it covers.
- **Nothing is assumed.** A cost with no stated currency is shown as "Currency unspecified". It is never taken to be dollars and never added to costs in a known currency. If a file has no currency column, you can tick "All costs in this file are USD" during import; Valynce does not do it for you.
- **A ranking is not a cause.** The Pareto chart shows where reports, quantity or cost are recorded. It does not show why, and the leading category is not a verified root cause.

## Limitations

This is an early alpha. Expect rough edges.

- **Checked on one platform.** Development and automated checks ran on macOS with Chrome. Windows, Linux desktops, Safari, Firefox and screen readers have not been checked by hand. CI runs installation, type checking, tests and the build on Linux.
- **CSV only, UTF-8 only.** Files need a header row and comma, semicolon or tab separators, up to 20 MB. Excel workbooks are not read.
- **No editing.** Reports cannot be edited or added by hand, only imported or removed with their import.
- **Duplicates are skipped.** A row whose NCR ID is already stored is reported and left out. There is no option to update a stored report from a file.
- **Export is the ranking only.** Exporting the reports themselves is not built yet.
- **One grouping.** The Pareto chart groups by defect category only.
- **Cost analysis in USD only.** The cost total and cost ranking cover costs stated in US dollars. Other currencies are stored and listed, and counted as left out, but not totalled or ranked yet.
- **Built-in SQLite.** Storage uses Node's `node:sqlite` module, which Node labels a release candidate.
- **No AI features.** No model is called and no summary is generated.

## Roadmap

Planned, not built. Order may change.

1. An optional summary of the analysis that cites the report IDs it is based on, sent to a model only when you ask.
2. Export of the reports themselves.
3. A packaged launcher, so the app starts with one command.

## How it is built

TypeScript throughout: a React interface built with Vite, a small Hono server on Node, and SQLite for storage. Quality rules, storage, interface and server are kept in separate folders, described in [AGENTS.md](../AGENTS.md).

**Valynce contains no AI features today.** No model is called and no summary is generated. AI coding agents assisted in writing the code, working under the rules in [AGENTS.md](../AGENTS.md) and checked by the tests and browser checks in this repository.

## Screenshots

Light and dark versions of the overview, cost ranking, import, records and detail views are in [`screenshots/`](screenshots/). All use synthetic data.
