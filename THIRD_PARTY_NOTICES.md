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

## Downloaded on request for the offline AI, not shipped

Valynce does not include or redistribute these. When you choose "Enable offline AI" and confirm, the app downloads them from their publishers to a folder on your computer, checks each against a pinned SHA-256, and runs them there. The exact files are listed in `src/ai/local/assets.ts`.

| Component | Version | License | Source |
|---|---|---|---|
| Qwen3-1.7B, Q4_K_M GGUF quantization | revision `daeb8e2d` of `ggml-org/Qwen3-1.7B-GGUF` | Apache-2.0 | Model by Alibaba Cloud's Qwen team, https://huggingface.co/Qwen/Qwen3-1.7B. This quantization is published by ggml-org, https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF |
| llama.cpp (prebuilt `llama-server`) | build `b11588` | MIT | Copyright (c) 2023-2026 The ggml authors. https://github.com/ggml-org/llama.cpp |

Qwen's own GGUF repository offers this model in Q8_0 only, so the smaller Q4_K_M file comes from ggml-org, the maintainers of llama.cpp. The Apache-2.0 and MIT licenses permit this use and redistribution with their notices; each download carries its own license file.
