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
- **No outside requests in normal use.** Fonts are bundled. The browser page contacts nothing but its own local server, and there is no telemetry. With no API key configured, the server makes no outside request either.
- **One optional outside request.** If you configure a key and confirm **Generate summary**, the server sends the evidence for that one analysis to the AI provider. See [AI summary](#ai-summary) for exactly what is and is not sent.
- **Where the database lives.** In your per-user data folder, outside the project folder, so updating or deleting the project does not touch your records:

  | System | Folder |
  |---|---|
  | macOS | `~/Library/Application Support/Valynce` |
  | Linux | `~/.local/share/valynce` (or `$XDG_DATA_HOME/valynce`) |
  | Windows | `%APPDATA%\Valynce` |

  Set `VALYNCE_DATA_DIR` to use another folder and `VALYNCE_PORT` to change the port, in your shell or in a `.env` file copied from [`.env.example`](../.env.example).
- **Backups.** When a newer version needs to change the database's structure, it first saves an untouched copy beside it, named like `valynce.db.v3.bak`. There are no scheduled backups: to make your own, stop Valynce and copy `valynce.db`.

## AI summary

Optional. Without a key the feature explains how to turn it on and everything else works offline.

**Setup.** Copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY` to your own key from the [Claude Console](https://platform.claude.com/), and restart Valynce. `.env` is git-ignored. The key stays in the server process: it is not stored in the database and never sent to the browser.

| Variable | Meaning | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your key. Empty means the feature is off. | empty |
| `VALYNCE_AI_MODEL` | Model used for summaries. | `claude-sonnet-5-5` |
| `VALYNCE_AI_TIMEOUT_SECONDS` | Time one request may take, 1 to 300. | `60` |
| `VALYNCE_AI_BASE_URL` | Address of the provider's API. The confirmation shows the host. | `https://api.anthropic.com` |

**Provider and model.** One provider is implemented, Anthropic, through its Messages API with structured outputs, which constrain the reply to a JSON schema. The default model is Claude Sonnet 5.5: a current, generally available model that supports structured outputs, and fast enough for a short reply. The provider sits behind a small adapter (`src/ai/provider.ts`), so another can be added without touching the rules. Anthropic's own terms govern how it handles what you send.

**What happens when you choose Generate summary.**

1. Valynce shows the provider, model and host, the number of reports, the fields that would be sent and those that would not. Nothing has been sent.
2. When you confirm, the server builds the evidence again and refuses if it no longer matches what you reviewed.
3. One request is made. If the reply fails a check, one corrected reply is requested. If that fails too, nothing is saved and the reasons are shown.
4. The summary is stored locally with its scope, figures and report IDs, and shown as an "AI-generated draft".

**What is sent.** For the reports in the analysis: NCR ID, opened date, defect category, description, status, disposition, reported cause, and the report's value for the metric being ranked. Also the ranking itself (category totals, shares, coverage counts) and the search text and status filter. If a category is selected in the chart, only that category's reports are listed.

**What is not sent.** Supplier, part number, the original file cells, the file name and row number, and any metric not being ranked. A cost in another currency is not sent; the report is marked as left out. Descriptions and reported causes are sent as written, so a name typed into a description is sent with it.

**Limits.** At most 200 reports and 40 categories per request. A larger selection is refused with a request to narrow it; Valynce never sends part of a selection quietly. A description or reported cause over 400 characters is sent shortened, marked `[shortened]`, and counted in the confirmation. A request is abandoned after the time limit, and only one runs at a time.

**What is checked in every reply.**

- Shape: an overview, at most three findings, at most five missing-information notes, at most three suggested checks, each within a length limit.
- Citations: every finding cites at least one report ID, and every ID must be one that was sent.
- Figures: any number in the text must already appear in the evidence. The figures shown under "Analysis scope and figures" are written by Valynce from the ranking, not by the model.
- Wording: no stated or implied root cause, no causal claim outside a finding marked as a hypothesis, no savings estimates, no defect rates.
- Descriptions are treated as data. An instruction written inside a report is not followed, and a reply that acts on one fails the checks above.

**Outdated summaries.** A summary belongs to the exact evidence it was generated from. If the reports, the search, the status filter, the selected category or the metric change, it is marked "Outdated" and left as it was. It is regenerated only when you ask.

**What these checks cannot do.** They test wording and traceability, not truth. A sentence can cite real reports and still misread them, and numbers written as words are not checked. Treat every summary as a draft and open the cited reports.

**Trying it with synthetic data.** Import [`fixtures/ai-eval.csv`](../fixtures/ai-eval.csv): nine invented reports with missing costs, a euro cost, a quantity in kg, and one description that tells the model to break the rules. `npm run check:ai:live` sends that same file to the provider from a throwaway database and reports whether real replies pass every check.

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
- **AI summary is a draft.** It is optional, limited to 200 reports per request, uses one provider, and keeps only the most recent summary. Its checks were exercised with scripted replies; a live run against the real model has not been done yet. The wording checks are in English.

## Roadmap

Planned, not built. Order may change.

1. Export of the reports themselves.
2. A packaged launcher, so the app starts with one command.

## How it is built

TypeScript throughout: a React interface built with Vite, a small Hono server on Node, and SQLite for storage. Quality rules, storage, interface, server and model code are kept in separate folders, described in [AGENTS.md](../AGENTS.md).

The only AI feature is the optional summary described above: one bounded model call per request, with no agent, no tool use and no background processing. AI coding agents also assisted in writing the code, working under the rules in [AGENTS.md](../AGENTS.md) and checked by the tests and browser checks in this repository.

## Screenshots

Light and dark versions of the overview, cost ranking, import, records and detail views are in [`screenshots/`](screenshots/). All use synthetic data.
