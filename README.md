# Valynce

Local-first NCR analysis for manufacturers.

![Valynce overview with synthetic demo data: report count, affected quantity, recorded cost in USD and a Pareto chart of defect categories](docs/screenshots/overview-light.png)

## What it does

- Imports non-conformance reports (NCRs) from CSV, with column mapping and row-by-row validation before anything is stored.
- Ranks defect categories by report count, affected quantity or recorded USD cost.
- Traces results to their source records and exports the ranking as CSV.
- Optionally drafts a short summary of the analysis with an AI model, citing the report IDs it rests on. Off unless you add a key.

## Run locally

Requires Node.js 24.15.0 or newer and git.

```bash
git clone https://github.com/icareon/valynce.git
cd valynce
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). A new installation starts empty; choose **Load demo data** on the start screen to add 24 synthetic reports.

## Data

Records stay on your computer. In normal use the app makes no external network requests. Installing it downloads its dependencies from npm.

The one exception is the optional AI summary. It is off until you add your own API key. With a key, nothing is sent until you choose **Generate summary**, review exactly what will be sent and confirm; then the selected reports go to the AI provider for that one request.

Cost analysis covers costs recorded in USD only. Reports with no cost, or with a cost in another or an unstated currency, are left out of cost figures and counted beside them, never treated as zero.

Where the database lives, what each number means and the full list of limitations are in [docs/REFERENCE.md](docs/REFERENCE.md).

## AI summary (optional)

```bash
cp .env.example .env      # then set ANTHROPIC_API_KEY in .env to your own key
npm start
```

On the overview, choose **Generate summary** beside the chart controls. Valynce shows the provider, the model, the number of reports and the fields that would be sent, and sends them only when you confirm. The result is an AI-generated draft: an overview, up to three findings marked as fact or hypothesis with clickable report IDs, what is missing, and up to three suggested checks. The figures beside it are computed by Valynce, not by the model. Details and limits are in [docs/REFERENCE.md](docs/REFERENCE.md#ai-summary).

## Status

Early alpha.

- Developed and checked on macOS with Chrome. Installation, type checking, tests and the build also run on Linux in CI. Windows, Safari and Firefox have not been checked.
- Reads CSV files only: UTF-8, with a header row.
- The AI summary's checks ran against scripted replies. It has not yet been run against the live model; see the reference for how to run that check yourself.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE); bundled fonts and libraries are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
