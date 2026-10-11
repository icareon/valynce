# Valynce

Valynce is a local-first quality tool. It runs on your own machine, with a browser interface on top of a local backend, and applies rules and AI-assisted analysis to non-conformance reports (NCRs).

> **Status:** Week 1, increment 1 of 6. The app opens with synthetic NCR records and shows totals. CSV import, Pareto analysis, AI summary, export and the `npx` launcher are not built yet.

## Try it

Requires Node.js 24.15 or newer.

```
npm ci
npm run build
npm start
```

Then open http://127.0.0.1:4310. A new database starts with 24 synthetic sample records, which you can remove from the banner at the top.

For development, `npm run dev` runs the backend with reload and the interface at http://127.0.0.1:5310, using a separate database in `./data`.

| Command | What it does |
|---|---|
| `npm run dev` | Development servers with reload |
| `npm test` | Runs the tests |
| `npm run typecheck` | Type-checks everything |
| `npm run build` | Builds into `dist` |
| `npm start` | Serves the built app |

## What the numbers mean

Valynce shows three different metrics and keeps them apart:

- **NCR count**: the number of reports. Each counts once.
- **Affected quantity**: units, summed over the reports that state a quantity.
- **Recorded cost**: the cost written on the reports, summed over those that state one. One currency is assumed; nothing is converted.

A value that was not recorded is shown as "—". It is never treated as zero, and each total says how many reports had no value. The cause on a report is shown as the *reported* cause; Valynce does not claim it is verified.

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
