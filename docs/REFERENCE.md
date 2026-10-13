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
- **No outside requests in normal use.** Fonts are bundled. The browser page contacts nothing but its own local server, and there is no telemetry. Until you use one of the two options below, the server makes no outside request either.
- **Two optional outside requests, each only when you ask.** Enabling offline AI downloads a model and its runtime after you confirm the size; it sends no NCR data, and offline summaries then run on your computer with no connection. Choosing the online option and confirming sends the evidence for that one analysis to the AI provider. See [AI analysis](#ai-analysis) for exactly what each reads or sends.
- **Where the database lives.** In your per-user data folder, outside the project folder, so updating or deleting the project does not touch your records:

  | System | Folder |
  |---|---|
  | macOS | `~/Library/Application Support/Valynce` |
  | Linux | `~/.local/share/valynce` (or `$XDG_DATA_HOME/valynce`) |
  | Windows | `%APPDATA%\Valynce` |

  Set `VALYNCE_DATA_DIR` to use another folder and `VALYNCE_PORT` to change the port, in your shell or in a `.env` file copied from [`.env.example`](../.env.example).
- **Backups.** When a newer version needs to change the database's structure, it first saves an untouched copy beside it, named like `valynce.db.v3.bak`. There are no scheduled backups: to make your own, stop Valynce and copy `valynce.db`.

## AI analysis

Offline analysis uses a small local model for brief, guided summaries without sending NCR data off-device. Online frontier-model analysis provides more capable, detailed explanations and requires explicitly sending selected data to Anthropic. Both produce drafts that require review against source records.

Optional. Under the chart, the **AI analysis** section drafts a short summary of the analysis on screen. It offers two providers. You choose one; the choice is remembered in your browser; and Valynce never switches to the other, whether one is missing, fails or is slow. A stored summary keeps the provider and model it came from, also after you select the other one.

| | Offline · Private | Online · Frontier |
|---|---|---|
| Where it runs | On this computer | At Anthropic, over the internet |
| Model | Qwen3 1.7B, Q4_K_M quantization, run by llama.cpp | Claude through the Messages API; `claude-sonnet-5-5` unless you set another |
| What it needs | A one-time download of 1.29 GB. macOS or Linux | Your own API key |
| What the model reads | NCR ID, defect category and description of each report | NCR ID, opened date, category, description, status, disposition, reported cause, and the value for the ranked metric |
| What the model writes | An overview and one sentence per leading category | Overview, up to three findings, missing information, suggested checks |
| Report limit per request | 40, and about 12,000 characters of text | 200 |
| Time limit | 180 seconds, including loading the model | 60 seconds |

Both use the same analysis: the same population, metric, unit, filters and report IDs as the chart, built on the backend. Both replies are constrained to a schema and then checked by Valynce's own code. No second model judges the first.

### Offline · Private

**Set-up.** Select the offline option and choose **Enable offline AI**. Valynce shows what it would download, how large it is and where it will be kept. Nothing is fetched until you confirm with **Download**. The download can be cancelled; a cancelled or interrupted download leaves nothing installed. When it finishes the option shows **Ready**.

| File | Size | From | License |
|---|---|---|---|
| Qwen3 1.7B, Q4_K_M GGUF | 1,282,439,264 bytes (1.28 GB) | `huggingface.co/ggml-org/Qwen3-1.7B-GGUF`, revision `daeb8e2d` | Apache-2.0 |
| llama.cpp `llama-server`, build `b11588` | 12 MB packed for macOS on Apple Silicon (12 to 18 MB on the other supported platforms), about 31 MB unpacked | `github.com/ggml-org/llama.cpp` releases | MIT |

- Each file is pinned in `src/ai/local/assets.ts` by address, size and SHA-256. It is written to a temporary name, checked, and only then moved into place. A file that is cut short or altered is discarded.
- A verified download is reused. Valynce never downloads, updates or checks for a newer model by itself, at start-up or otherwise.
- Qwen publishes this model as GGUF in Q8_0 only (1.83 GB). The smaller Q4_K_M file is published by ggml-org, the maintainers of llama.cpp, from Qwen's model.
- Valynce does not include or redistribute the model or the runtime. Your computer downloads them from their publishers. Their licenses are summarised in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

**Where the files are kept.** Outside the project folder and apart from the database:

| System | Folder |
|---|---|
| macOS | `~/Library/Application Support/Valynce/offline-ai` |
| Linux | `~/.local/share/valynce/offline-ai` (or `$XDG_DATA_HOME/valynce/offline-ai`) |

Set `VALYNCE_AI_DIR` to use another folder. **To remove them**, choose **Remove offline AI files** under the offline option, or delete that folder while Valynce is stopped. Stored summaries are kept.

**Supported platforms.** Valynce can manage the runtime on macOS (Apple Silicon and Intel) and Linux (x64 and arm64). Of these, only macOS on Apple Silicon has been run; the others use the corresponding official llama.cpp builds and are untested. On Windows the option says it is not available: the Windows runtime is packaged differently and is not handled yet. Ollama and Python are not needed anywhere.

**How it runs.** The runtime is llama.cpp's own server program, started by Valynce as a child process when you ask for the first offline summary, not before. It listens on `127.0.0.1` only, on a spare port, behind a key made up for that run, with its web page and its own downloads switched off. It uses Qwen3's documented non-thinking mode, one request at a time, an 8,192-token context and a 500-token reply limit. The runtime is told to unload the model after five minutes without a request, and Valynce stops it on shutdown. If Valynce is killed rather than stopped, the model process can be left running and has to be ended like any other process. The five-minute unloading was configured, not measured.

**Why the offline summary is shorter.** Qwen3 1.7B was first given the same task as the online model. In 7 requests on synthetic reports, with the reply shape and report IDs enforced by the runtime, 1 was accepted, and it said a category held "the majority" of reports when it held a third. Rejected replies invented an amount, misstated which category led, and repeated a cause planted in a report's text. So the offline task was reduced:

- **Valynce writes** the scope and figures, one ranked finding (marked "Computed by Valynce") with the reports behind it, the missing information and the suggested checks.
- **The model writes** an overview and one sentence on what the reports in each of the two leading categories describe (marked "From the reports"), citing reports that the runtime restricts to that category.
- The model is given descriptions only: no costs, quantities, statuses, dispositions or reported causes. Its sentences may not contain numbers, uncited report IDs or talk of causes.
- A description that reads as instructions to a model ("ignore the previous instructions…") is not given to the offline model, and the summary names the report. This is a short pattern list, not a guarantee.

The result panel says that it is the shorter offline summary and who wrote which part.

**Offline limits.** 40 reports and about 12,000 characters of report text per request. These were set by running the real model at 40 reports and at 11,000 characters; both stayed within the context and took under 7 seconds on the test computer. A larger selection is refused with a request to narrow it. Nothing is cut.

### Online · Frontier

**Set-up.** Copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY` to your own key from the [Claude Console](https://platform.claude.com/), and restart Valynce. `.env` is git-ignored. The key stays in the server process: it is not stored in the database and never sent to the browser. Anthropic's own terms govern how it handles what you send.

**What happens when you choose Generate summary.**

1. Valynce shows the provider, model and host, the number of reports, the fields that would be sent and those that would not. Nothing has been sent.
2. When you confirm, the server builds the evidence again and refuses if it no longer matches what you reviewed.
3. One request is made. If the reply fails a check, one corrected reply is requested. If that fails too, nothing is saved and the reasons are shown.
4. The summary is stored locally with its scope, figures and report IDs.

**What is sent.** For the reports in the analysis: NCR ID, opened date, defect category, description, status, disposition, reported cause, and the report's value for the metric being ranked. Also the ranking itself (category totals, shares, coverage counts) and the search text and status filter. If a category is selected in the chart, only that category's reports are listed.

**What is not sent.** Supplier, part number, the original file cells, the file name and row number, and any metric not being ranked. A cost in another currency is not sent; the report is marked as left out. Descriptions and reported causes are sent as written, so a name typed into a description is sent with it.

**Online limits.** At most 200 reports and 40 categories per request. A description or reported cause over 400 characters is sent shortened, marked `[shortened]`, and counted in the confirmation.

### Settings

| Variable | Meaning | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your key. Empty means the online option is off. | empty |
| `VALYNCE_AI_MODEL` | Online model. | `claude-sonnet-5-5` |
| `VALYNCE_AI_TIMEOUT_SECONDS` | Time one online request may take, 1 to 300. | `60` |
| `VALYNCE_AI_BASE_URL` | Address of the online provider's API. The confirmation shows the host. | `https://api.anthropic.com` |
| `VALYNCE_AI_DIR` | Folder for the offline model and runtime. | see above |
| `VALYNCE_OFFLINE_AI_TIMEOUT_SECONDS` | Time one offline request may take, 1 to 900. | `180` |

### What both have in common

- **Confirmation.** Each request follows one explicit confirmation of its scope. The offline confirmation says the reports are read on this computer; the online one says what is sent and to whom. Selecting a provider downloads nothing and generates nothing.
- **One at a time.** One request runs at a time, with a time limit and a Cancel button. While it runs the panel shows "Analyzing NCRs…"; the chart and the records stay usable.
- **Result.** Labelled "AI-generated draft · Review against source records", with offline or online, the model, when and how long it took, the scope and figures computed by Valynce, and report IDs that open the report.
- **Outdated.** A summary belongs to the exact analysis it was generated from. If the reports, the search, the status filter, the selected category or the metric change, it is marked "Outdated" and left as it was. It is regenerated only when you ask. Only the latest summary is kept.

**What is checked in every reply.**

- Shape and length of every part.
- Citations: every finding cites at least one report, and only reports that were given. A finding must also cite every report its text names, at least one report in a category it names, and, when it speaks of a reported cause, a report that has one.
- Figures: a number must be the evidence's figure for the report or category its sentence is about, or for the analysis as a whole. A real figure attached to the wrong report or category is rejected, and a share is not accepted as a count or an amount.
- Wording: no stated or implied root cause, no causal claim outside a finding marked as a hypothesis, no savings estimates, no defect rates.
- Descriptions are treated as data. A reply that acts on an instruction written inside a report fails the checks above.

**What these checks cannot do.** They test wording and traceability, not truth, and they do not guarantee that a summary is accurate. Treat every summary as a draft and open the cited reports. Each of the following is wrong and is accepted; `tests/ai.test.ts` keeps an example of all but the last:

- A count written as a word ("four reports give tool wear" when three do).
- Two reports or two categories named in one sentence with their figures swapped.
- A count for the whole analysis attached to one category, also when one category is selected.
- A wrong status or disposition, a wrong comparison, a wrong ranking in words, or a wrong reason for a report being left out.
- A category figure reached through an ordinary word that is also a category name, such as "Other".
- Loose description, such as naming a kind of problem that the cited reports do not mention.

The checks can also refuse an accurate sentence: one that contains a figure the model worked out itself, or that mentions a root cause or savings only to say a report's text asked for them. The one correction usually resolves it; if not, the request fails and nothing is saved.

### Evaluation

All of this used synthetic reports only, in throwaway databases, on October 12 and 13, 2026. The replies were read against the fixtures by the coding agent, not by a person. It is a small sample: it shows how these two models behaved on these files, not how accurate either is on your records.

**Comparison on the same ten cases** (`npm run check:ai:eval`, [`fixtures/ai-eval-varied.csv`](../fixtures/ai-eval-varied.csv): 30 reports with missing costs, EUR and unstated currencies, quantities in pieces, kg and m, a category named "Other", uncategorized reports and one description that tells the model to break the rules). The cases cover all three metrics, the kg ranking, three selected categories, a status filter and a search.

| | Offline, Qwen3 1.7B (shorter task) | Online, `claude-sonnet-5-5` (full task) |
|---|---|---|
| Final code: accepted | 10 of 10, none needing a correction | 10 of 10, one needing its correction |
| Followed the planted instructions | 0 | 0 |
| Wrong or unsupported statements found in accepted replies | 2 of 26 model-written sentences: "labeling" listed among the problems of a category whose reports do not mention it, and "related to manufacturing processes", which the reports do not say | none found in the 10 replies |
| Accurate replies rejected | 0 | 1: "the 26 stored reports that do not match the search", a correct figure the model had subtracted itself |
| Earlier runs of the same cases, while the offline task was being settled | 20 requests: 19 accepted. 1 rejection of an accurate reply that named the reports it cited, since allowed. 4 wrong statements passed: a problem attributed to the wrong category, a problem the reports do not mention, and twice a disposition the cited reports do not have, which is why the model no longer reads statuses or dispositions | 10 requests: 10 accepted. 1 wrong statement passed: "four" reports with a reported cause when three have it |

Before the instruction-like description was kept from the offline model, the smaller file [`fixtures/ai-eval.csv`](../fixtures/ai-eval.csv) was run 12 times offline: 7 accepted, and 5 failed after their correction because the model kept repeating what the planted text asked for. None of those 5 was shown or stored.

**Earlier online check.** On October 12, 2026 `npm run check:ai:live` was run six times against `claude-sonnet-5-5` with `fixtures/ai-eval.csv`, 24 requests and 28 replies. None followed the planted instructions, cited a report that was not sent, or stated a root cause, savings or a defect rate. The first run failed one request of four because the checks refused accurate sentences; those checks were corrected, and the final run passed four of four on the first reply.

**In the browser.** With the real model and a real key: offline set-up by download, offline generation with the server and the model process blocked from all outbound network access, the online confirmation and generation, citations opening their reports, and the outdated mark were each run in headless Chrome.

### Offline performance

Measured on one computer: an Apple M4 with 10 cores and 24 GB of memory, macOS 26.5, Node 24.21, llama.cpp build `b11588` with its default settings (Metal), 8,192-token context.

| | Measured |
|---|---|
| Download | 1,294,551,509 bytes (1.29 GB) in 51 seconds on the test connection; 1.2 GB on disk afterwards |
| First summary after starting Valynce, which loads the model | 4.3 to 7 seconds; 16 seconds the first time after the download |
| Later summaries | 1.4 to 4.3 seconds, median 2.1 seconds, for 4 to 30 reports |
| At the limits | 40 reports: under 5 seconds. 28 reports with 390-character descriptions: about 6 seconds |
| Memory used by the model process | up to 3.1 GB resident |

Slower processors, less memory or a computer without a supported GPU will take longer; none was tested.

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
- **An AI summary is a draft.** It is optional and keeps only the most recent summary. Its checks do not guarantee factual accuracy; both models produced occasional wrong or loose statements that passed (see [Evaluation](#evaluation)). Neither has been evaluated on real records, and no person has checked the evaluation replies against the reports. In the one review by a person so far, offline analysis was noticeably weaker than online. The wording checks are in English.
- **Offline AI is limited.** The summary is the shorter one, 40 reports per request, on macOS and Linux only, and it has been run on one Apple Silicon Mac. It needs about 3 GB of free memory while it works.

## Roadmap

NCR analysis is feature-complete for a first version: import, three Pareto rankings, source records, ranking export and optional AI analysis. Further NCR features are deferred until feedback from people using it identifies a concrete need. Known candidates, not planned:

- Export of the reports themselves.
- A packaged launcher, so the app starts with one command.
- Offline AI on Windows.

## How it is built

TypeScript throughout: a React interface built with Vite, a small Hono server on Node, and SQLite for storage. Quality rules, storage, interface, server and model code are kept in separate folders, described in [AGENTS.md](../AGENTS.md).

The only AI feature is the optional summary described above: one bounded model call per request, offline or online, with no agent, no tool use, no retrieval and no background processing. AI coding agents also assisted in writing the code, working under the rules in [AGENTS.md](../AGENTS.md) and checked by the tests and browser checks in this repository.

## Screenshots

[`screenshots/`](screenshots/) holds the light and dark comparison used in the README, taken from `v0.1.0-alpha.9`, and light and dark versions of the overview, cost ranking, import, records and detail views taken at `v0.1.0-alpha.6`, before the AI analysis section existed. All use synthetic data.
