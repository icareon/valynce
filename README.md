# Valynce

Local-first NCR analysis for manufacturers.

![Valynce overview with synthetic demo data: report count, affected quantity, recorded cost in USD and a Pareto chart of defect categories](docs/screenshots/overview-light.png)

## What it does

- Imports non-conformance reports (NCRs) from CSV, with column mapping and row-by-row validation before anything is stored.
- Ranks defect categories by report count, affected quantity or recorded USD cost.
- Traces results to their source records and exports the ranking as CSV.

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

Records stay on your computer. The app makes no external network requests during normal use. Installing it downloads its dependencies from npm.

Cost analysis covers costs recorded in USD only. Reports with no cost, or with a cost in another or an unstated currency, are left out of cost figures and counted beside them, never treated as zero.

Where the database lives, what each number means and the full list of limitations are in [docs/REFERENCE.md](docs/REFERENCE.md).

## Status

Early alpha. AI summaries are not implemented yet.

- Developed and checked on macOS with Chrome. Installation, type checking, tests and the build also run on Linux in CI. Windows, Safari and Firefox have not been checked.
- Reads CSV files only: UTF-8, with a header row.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE); bundled fonts and libraries are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
