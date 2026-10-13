// The exact files the offline AI downloads, pinned by revision and SHA-256.
// Nothing here is bundled with Valynce: each file is fetched from its publisher
// only when the user asks, and is refused if its size or hash differs.
//
// Checked on October 13, 2026:
// - Qwen publishes Qwen3-1.7B as GGUF in Q8_0 only (Qwen/Qwen3-1.7B-GGUF, 1.83 GB).
//   The Q4_K_M file comes from ggml-org, the maintainers of llama.cpp, converted
//   from Qwen/Qwen3-1.7B. Both repositories are Apache-2.0.
// - llama.cpp publishes prebuilt binaries with each build under the MIT licence.
//   The hashes below are the digests GitHub reports for those release assets.

export interface PinnedFile {
  url: string;
  bytes: number;
  sha256: string;
}

export const LOCAL_MODEL = {
  /** Shown to the user. */
  label: 'Qwen3 1.7B',
  /** Stored with a summary. */
  id: 'Qwen3-1.7B-Q4_K_M',
  file: 'Qwen3-1.7B-Q4_K_M.gguf',
  source: 'huggingface.co/ggml-org/Qwen3-1.7B-GGUF',
  license: 'Apache-2.0',
  url: 'https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF/resolve/daeb8e2d528a760970442092f6bf1e55c3b659eb/Qwen3-1.7B-Q4_K_M.gguf',
  bytes: 1_282_439_264,
  sha256: 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5',
} as const;

export const RUNTIME_BUILD = 'b11588';
const RELEASE = `https://github.com/ggml-org/llama.cpp/releases/download/${RUNTIME_BUILD}`;

export const LOCAL_RUNTIME = {
  name: 'llama.cpp',
  build: RUNTIME_BUILD,
  source: 'github.com/ggml-org/llama.cpp',
  license: 'MIT',
  /** The folder inside each archive, and the program Valynce starts. */
  folder: `llama-${RUNTIME_BUILD}`,
  program: 'llama-server',
} as const;

/** One archive per platform Valynce can manage. Windows builds are zip files and are not handled yet. */
const RUNTIME_ARCHIVES: Record<string, PinnedFile> = {
  'darwin-arm64': {
    url: `${RELEASE}/llama-${RUNTIME_BUILD}-bin-macos-arm64.tar.gz`,
    bytes: 12_112_245,
    sha256: '95039180209cb8b9a2fadedd03e061c5131fed17e1eb423b3dcf8c7848d12b9d',
  },
  'darwin-x64': {
    url: `${RELEASE}/llama-${RUNTIME_BUILD}-bin-macos-x64.tar.gz`,
    bytes: 11_608_121,
    sha256: 'f9bda3b33fc42d91ffc6caa86e3ca42a720defd84b692065bdbff9a7dca03739',
  },
  'linux-x64': {
    url: `${RELEASE}/llama-${RUNTIME_BUILD}-bin-ubuntu-x64.tar.gz`,
    bytes: 17_724_894,
    sha256: '656cba79ba40776e766070145e6d6b2f23b06158803b0fa318fb95bdefa7dd23',
  },
  'linux-arm64': {
    url: `${RELEASE}/llama-${RUNTIME_BUILD}-bin-ubuntu-arm64.tar.gz`,
    bytes: 13_839_237,
    sha256: '9ec6cdd3d080aae969735ba5197cd844c89acf734fe76f19eb8dc0b2a12263af',
  },
};

/** The runtime archive for this computer, or null when Valynce cannot manage one here. */
export function runtimeArchiveFor(platform: string, arch: string): PinnedFile | null {
  return RUNTIME_ARCHIVES[`${platform}-${arch}`] ?? null;
}

/** Everything a set-up needs, so the user can be told the size before anything is fetched. */
export interface LocalManifest {
  model: { label: string; id: string; file: string; source: string } & PinnedFile;
  runtime: { name: string; build: string; source: string; folder: string; program: string; archive: PinnedFile | null };
}

export function pinnedManifest(platform: string = process.platform, arch: string = process.arch): LocalManifest {
  return {
    model: { label: LOCAL_MODEL.label, id: LOCAL_MODEL.id, file: LOCAL_MODEL.file, source: LOCAL_MODEL.source, url: LOCAL_MODEL.url, bytes: LOCAL_MODEL.bytes, sha256: LOCAL_MODEL.sha256 },
    runtime: {
      name: LOCAL_RUNTIME.name,
      build: LOCAL_RUNTIME.build,
      source: LOCAL_RUNTIME.source,
      folder: LOCAL_RUNTIME.folder,
      program: LOCAL_RUNTIME.program,
      archive: runtimeArchiveFor(platform, arch),
    },
  };
}
