# Valynce

[![CI](https://github.com/icareon/valynce/actions/workflows/ci.yml/badge.svg)](https://github.com/icareon/valynce/actions/workflows/ci.yml)
[![Status: early alpha](https://img.shields.io/badge/status-early%20alpha-ff5a1f)](https://github.com/icareon/valynce/releases)
[![Node.js 24.15+](https://img.shields.io/badge/node-%E2%89%A5%2024.15-555)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-555)](LICENSE)

Local-first analysis of non-conformance reports (NCRs) for manufacturers: import your reports, see where they concentrate, and trace every figure back to its source records.

![The Valynce overview in light and dark themes, showing the same 24 synthetic demo reports: report count, affected quantity, recorded cost in USD, a Pareto ranking of defect categories by recorded cost, and the AI analysis section with its offline and online options](docs/screenshots/overview-light-dark.png)

<sub>The same view in both themes, with Valynce's synthetic demo data, as a new installation shows it.</sub>

## What it does

- **CSV import with mapping and validation.** Map your columns, see every row's outcome and the reason for each rejection, and resolve ambiguous dates and number formats before anything is stored.
- **Pareto analysis by three metrics.** Rank defect categories by number of reports, affected quantity or recorded USD cost, with each category's share and cumulative share. Missing values are counted beside the figure, never treated as zero.
- **Source records and export.** Select a category to list the reports behind it, open any report to see its original file row, and export the ranking as CSV.
- **Optional AI analysis, offline or online.** Draft a short summary of the analysis on screen, with report IDs you can click. Choose a small model that runs on your computer, or Claude through Anthropic's API.

## Workflow

1. **Import** a CSV of NCRs, or load the 24 synthetic demo reports.
2. **Compare priorities** by switching the ranking between reports, quantity and cost.
3. **Inspect the evidence** by selecting a category and opening its reports.
4. **Optionally generate a summary**, offline or online, after reviewing what it will use.

## Run locally

Requires Node.js 24.15.0 or newer and git.

```bash
git clone https://github.com/icareon/valynce.git
cd valynce
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). A new installation starts empty; choose **Load demo data** on the start screen.

## Optional AI analysis

Offline analysis uses a small local model for brief, guided summaries without sending NCR data off-device. Online frontier-model analysis provides more capable, detailed explanations and requires explicitly sending selected data to Anthropic. Both produce drafts that require review against source records.

Under the chart, **AI analysis** offers two options. Your choice is remembered in your browser, and Valynce never switches from one to the other.

| | Offline · Private | Online · Frontier |
|---|---|---|
| Runs | on this computer | at Anthropic |
| Model | Qwen3 1.7B (Q4_K_M) with llama.cpp | Claude, `claude-sonnet-5-5` unless you set another |
| Your data | stays on this device | the selected reports are sent after you confirm |
| Needs | a one-time 1.29 GB download; macOS or Linux | your own API key and an internet connection |
| Summary | shorter: Valynce writes the figures and the ranked finding, the model describes what the reports say | fuller: findings, hypotheses, gaps and suggested checks |

**Offline.** Choose **Enable offline AI**, review the size, and confirm the download: the model (1.28 GB) and the runtime that runs it (12 MB), each checked against a pinned checksum. Nothing is downloaded before that, and nothing at start-up. Afterwards it needs no internet connection and no key. **Remove offline AI files** in the same place deletes them.

**Online.** Add your own key and restart:

```bash
cp .env.example .env      # then set ANTHROPIC_API_KEY in .env
npm start
```

`.env` is git-ignored. The key stays in the local server process; it is never sent to the browser or written to the database.

## Your data

Analysis is local. Records are stored in a database on your computer, and in normal use the app makes no external network requests. Installing it downloads its dependencies from npm.

There are two exceptions, and each happens only when you ask. Enabling offline AI downloads the model and runtime; it sends no NCR data, and offline summaries then run entirely on your computer. Choosing the online option first shows the provider, the model, the number of reports and the fields that would be sent and withheld; data leaves your computer only when you confirm that view, for that one request.

## Limitations

Valynce is an early alpha. It was developed and checked on macOS with Chrome, with installation, tests and the build also run on Linux in CI; Windows, Safari and Firefox are unchecked, and offline AI has been run on an Apple Silicon Mac only. It reads CSV files only, and cost analysis covers costs recorded in USD. An AI summary, from either option, is a draft that requires human review. Automated checks reject replies that cite unknown reports, attach a figure to the wrong report or claim a root cause, but they do not guarantee factual accuracy: in testing on synthetic reports both models produced occasional wrong or loose statements that passed. The offline model is small, which is why its summary is the shorter one.

## More

- [Reference](docs/REFERENCE.md): where your data and the offline model are stored, what each number means, what each AI option reads or sends, evaluation results, performance, licenses and the full list of limitations.
- [Contributing](CONTRIBUTING.md) and the [project rules](AGENTS.md).
- Licensed under [MIT](LICENSE). Bundled fonts and libraries, and the model and runtime downloaded for offline AI, are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
