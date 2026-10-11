# Third-party notices

Valynce's own code is released under the [MIT License](LICENSE). It is built on the open-source work below, which stays under its own license. Versions are the ones pinned in `package.json`; the full dependency tree, including packages used only to build and test, is recorded in `package-lock.json`.

## Shipped in the built app

These are bundled into the interface or loaded by the server when Valynce runs.

| Component | Version | License | Copyright and source |
|---|---|---|---|
| Inter (font), via `@fontsource-variable/inter` | 5.3.0 | SIL Open Font License 1.1 | Copyright 2016 The Inter Project Authors. https://github.com/rsms/inter |
| IBM Plex Mono (font), via `@fontsource/ibm-plex-mono` | 5.3.0 | SIL Open Font License 1.1 | Copyright 2017 IBM Corp. https://github.com/IBM/plex |
| React and React DOM | 19.3.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. https://github.com/react/react |
| Hono | 4.13.13 | MIT | Copyright (c) 2021 - present, Yusuke Wada and Hono contributors. https://github.com/honojs/hono |
| @hono/node-server | 2.1.4 | MIT | Copyright (c) 2022 - present, Yusuke Wada and Hono contributors. https://github.com/honojs/node-server |

The fonts are used unmodified. Under the SIL Open Font License they may be bundled and redistributed with software, provided their copyright notice and license travel with them and they are not sold on their own. The full license text for each font is in its package: `node_modules/@fontsource-variable/inter/LICENSE` and `node_modules/@fontsource/ibm-plex-mono/LICENSE`, and at https://openfontlicense.org.

## Used to build and test, not shipped

| Component | Version | License |
|---|---|---|
| TypeScript | 7.0.2 | Apache-2.0 |
| Vite | 8.3.4 | MIT |
| @vitejs/plugin-react | 6.1.2 | MIT |
| Type definitions (`@types/node`, `@types/react`, `@types/react-dom`) | see `package.json` | MIT |

Valynce also relies on Node.js and its built-in SQLite module, which are installed separately and are not redistributed here.
