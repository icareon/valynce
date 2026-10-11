# Valynce

Valynce is a local-first quality tool. It runs on your own machine, with a browser interface on top of a local backend, and applies rules and AI-assisted analysis to non-conformance reports (NCRs).

> **Status:** Week 1, increment 1 of 6 complete. The app shows an overview, a category chart and a searchable records table over synthetic demo data. CSV import, Pareto analysis, AI summary, export and the `npx` launcher are not built yet.

## Try it

Requires Node.js 24.15 or newer.

```
npm ci
npm run build
npm start
```

Then open http://127.0.0.1:4310. A new database is empty; choose **Load demo data** to add 24 synthetic reports, and **Remove demo data** to take them out again. Press Ctrl+C in the terminal to stop the server.

For development, `npm run dev` runs the backend with reload and the interface at http://127.0.0.1:5310, using a separate database in `./data`.

| Command | What it does |
|---|---|
| `npm run dev` | Development servers with reload |
| `npm test` | Runs the tests |
| `npm run typecheck` | Type-checks everything |
| `npm run build` | Builds into `dist` |
| `npm start` | Serves the built app |
| `npm run check:browser` | Drives the built app in headless Chrome and writes screenshots |

## What the numbers mean

Valynce shows three different metrics and keeps them apart:

- **NCR reports**: the number of reports. Each counts once, however many units it covers.
- **Affected units**: units, summed over the reports that state a quantity.
- **Recorded cost**: the cost written on the reports, summed over those that state one. It is not an estimate of total cost of poor quality.

Each card says how many reports had a value, for example "Quantity recorded in 21 of 24 reports."

- A value that was not recorded is shown as "—" or "Not recorded". It is never treated as zero.
- Costs carry a currency. A cost with no stated currency is shown as "Currency unspecified" and is never assumed to be dollars.
- Amounts in different currencies are never added together; each currency gets its own total.
- The chart "NCR reports by category" counts reports, including an "Uncategorized" bucket, so the bars always add up to the number of reports shown.
- The cause on a report is shown as the *reported* cause. Valynce does not claim it is a verified root cause.

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
