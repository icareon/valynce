# Valynce project rules

These rules apply to every contributor and every coding agent working in this repository. `CLAUDE.md` imports this file, so edit the rules here only.

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
| Affected quantity | The number of units the report says were affected. |
| Recorded cost | The cost written on the report. It is not an estimate or a full cost of poor quality. |
| Defect category | The classification written on the report. |
| Disposition | What was decided for the affected material, such as scrap, rework, use as is or return to supplier. |
| Reported cause | The cause as written on the report. It is not a verified root cause. |
| Pareto analysis | Categories ranked from largest to smallest by one stated metric, with cumulative share. A Pareto chart is always of one metric. |

## Analysis rules

- A value that was not recorded is `null` everywhere: storage, API and UI. Never replace it with zero, an empty string, an average or a guess. Totals state how many records had no value.
- NCR count, affected quantity and recorded cost are three different metrics. Label each one wherever it is shown and never merge or rank them as if they were one.
- `reportedCause` is what the report says. Do not present it, or anything a model produces, as a verified root cause.
- Cost is stored as whole hundredths (`costCents`) so sums are exact. The dataset is assumed to use one currency; Valynce does not convert.

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
| `npm run build` | Builds the UI and backend into `dist` |
| `npm start` | Serves the built app at `http://127.0.0.1:4310` |

Run `npm run typecheck` and `npm test` before calling a change done.

## Git and releases

- Never commit `.env`, databases, customer files, `node_modules`, build output or rendered demo files. `.gitignore` covers them; keep it that way.
- Do commit `package-lock.json`, `.env.example` (variable names with no values), the synthetic fixtures and the README.
- Commit after each working increment, with the checks passing. One increment, one commit where practical.
- Tag every working increment with an annotated tag that matches `version` in `package.json`, for example `v0.1.0-alpha.1`. A tag must be reproducible with `git checkout <tag> && npm ci && npm run build && npm test`.
- Never move or delete a tag that has been pushed. Fix forward with a new version.

## Tests

`tests` is for checks that would fail if the behaviour were wrong. Test NCR rules and analysis against fixtures with known expected results. Do not add tests that only restate the implementation or exist to raise coverage.

Tests run offline against synthetic fixtures. They do not need real customer data, a real database or a live model key.

## Demo

`demo` is a separate Remotion project. Anything shown in the video uses synthetic fixtures, since the output is published.
