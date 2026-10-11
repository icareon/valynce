# Contributing to Valynce

Thank you for helping. Valynce is an early alpha, so the most useful contributions right now are clear bug reports and small, focused fixes.

## Before anything else: no real data

This repository is public. Never put real NCRs, part numbers, supplier or customer names, exports, screenshots of real records, database files or credentials in an issue, a pull request, a test, a fixture or a commit. Use the synthetic files in `fixtures/`, or invent a small example. If something sensitive is posted by mistake, say so straight away so it can be removed properly.

## Setup

You need Node.js 24.15.0 or newer and git.

```bash
git clone https://github.com/icareon/valynce.git
cd valynce
npm ci
npm run dev
```

`npm run dev` starts the backend with reload and the interface at http://127.0.0.1:5310. It keeps its database in `./data`, separate from any real Valynce data on your machine.

## Checks to run before opening a pull request

Every change:

```bash
npm run typecheck
npm test
npm run build
```

Any change to the interface, as well:

```bash
npm run build && npm run check:browser
```

`check:browser` drives the built app in headless Chrome, in both themes, and writes screenshots. It needs Chrome or Chromium installed; set `CHROME_PATH` if it is somewhere unusual. Look at the screenshots, and add a check for the behaviour you changed.

CI runs installation, type checking, the tests and the build on Linux for every pull request. The browser checks are not part of CI yet, so please run them locally.

## Project rules

[AGENTS.md](AGENTS.md) holds the rules that keep the analysis trustworthy. The ones that matter most:

- A value that was not recorded stays "not recorded". Never fill it with zero or a guess.
- Never add amounts in different currencies, or quantities in different units.
- Reading a file never guesses. If a date or number could mean two things, the user chooses.
- A ranking shows where, not why. Do not call the leading category a cause.
- Tests should fail if the behaviour were wrong. Prefer a fixture small enough to check by hand.

Put code in the folder that owns it: quality rules in `src/modules/quality`, shared entities and storage in `src/core`, the server in `src/server`, the interface in `src/ui`.

## Pull requests

- Keep each pull request to one change, and say what you checked.
- Pin any new dependency to an exact version, commit the lockfile, and explain why it is needed.
- New features should be discussed in an issue first. The roadmap in the README is deliberately short.

## Reporting a problem

Use the bug report template. The most helpful reports include the steps, what you expected, what happened, and a tiny synthetic CSV that reproduces it.
