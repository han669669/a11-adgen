import kit from "../dist/finish-kit.json";

/**
 * The finish kit (issue 147, 21-11-2026): the scripts that the house recipe runs on the agent's machine (the words in the
 * kit font, the real print, the real-camera finish, the shape checks), served by this Worker from the build of its own
 * commit. A client with only the MCP (Cursor) gets them with finish_kit and curl, so it needs no git checkout, and no
 * agent goes looking for a repository (the IRVINS run from Cursor opened another private repository of the owner's).
 * The Worker does no image work (Free plan, 10 ms CPU): the scripts run on the client.
 * The files are the public scripts of this repo (finishkit.build.ts lists them), in the bundle as text; the route is public and
 * serves only these names.
 */
const USES: Record<string, string> = {
  "headline.py": "Sets the approved headline, subline and kit logo inside the picture, in the kit font (Google Fonts, or a font file the brand's site serves). Run it on every draft before the owner sees it, and on every final.",
  "photo_finish.py": "The real-camera finish on drafts and finals, before headline.py.",
  "product_lock.py": "The real pack: skeleton and layout (a layout plan), reprint (the real print back on a render made from a skeleton), swap (the real pack into a picked draft), cutout.",
  "pack_check.py": "The pack's height over width against the packshot (2%).",
  "cap_check.py": "The cap on the body centre of a bottle (1% of its width).",
  "box_print.py": "The real box print on a boxed product, from a box-print config for that product.",
  "food_grade.py": "Moves the food colour of a packshot toward the brand's real close-up photo.",
  "requirements.txt": "The Python packages, for the setup script (Python 3.12 or newer).",
};

const FILES: Record<string, { text: string; use: string }> = Object.fromEntries(
  Object.entries(USES).map(([name, use]) => [name, { text: (kit as Record<string, string>)[name] ?? "", use }]),
);

export const FINISH_PATH = /^\/finish\/([a-z_]+\.(?:py|txt))$/;

let hashes: Promise<Record<string, string>> | undefined;
function sha256s(): Promise<Record<string, string>> {
  hashes ??= Promise.all(
    Object.entries(FILES).map(async ([name, f]) => {
      const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(f.text));
      return [name, [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")] as const;
    }),
  ).then(Object.fromEntries);
  return hashes;
}

/** The kit folder on the client: the scripts go in scripts/, so the commands of the house recipe (scripts/headline.py) run from it. */
const FOLDER = "a11-finish";

/**
 * The MCP tool finish_kit: each file's address on this Worker, its SHA-256 and its use, and one shell script that downloads,
 * checks and installs them. One script, not separate commands, because a client may run each command in a new shell
 * (Devin Review, PR 148). The packages go into a virtual environment of Python 3.12 or newer (numpy 2.5 needs it).
 */
export async function finishKit(baseUrl: string) {
  const sums = await sha256s();
  const base = baseUrl.replace(/\/+$/, "");
  const files = Object.entries(FILES).map(([name, f]) => ({
    name,
    path: `scripts/${name}`,
    url: `${base}/finish/${name}`,
    sha256: sums[name]!,
    bytes: new TextEncoder().encode(f.text).byteLength,
    use: f.use,
  }));
  const setup = [
    "set -eu",
    `mkdir -p ${FOLDER}/scripts && cd ${FOLDER}`,
    ...files.map((f) => `curl -fsS --proto =https -o ${f.path} ${f.url}`),
    'SUM="sha256sum"; command -v sha256sum >/dev/null 2>&1 || SUM="shasum -a 256"',
    `printf '%s\\n' ${files.map((f) => `'${f.sha256}  ${f.path}'`).join(" ")} | $SUM -c -`,
    `PY=""; for p in python3.14 python3.13 python3.12 python3; do if command -v "$p" >/dev/null 2>&1 && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then PY="$p"; break; fi; done`,
    '[ -n "$PY" ] || { echo "The finish kit needs Python 3.12 or newer (tested on 3.13)." >&2; exit 1; }',
    '"$PY" -m venv .venv',
    ".venv/bin/python -m pip install -r scripts/requirements.txt",
  ].join("\n");
  return {
    folder: FOLDER,
    files,
    setup,
    run: `Run every script from the ${FOLDER} folder with its Python: .venv/bin/python scripts/<name> (for example .venv/bin/python scripts/headline.py --help). The recipe's commands name scripts/<name>, as here.`,
    notes: [
      "Run setup as one bash script (save it to a file and run bash on it, or pass it to bash -c). It stops at the first error: a failed download, a wrong SHA-256 or no Python 3.12.",
      "The house rules (rules_get) say when each script runs.",
      "Keep the kit folder and the pictures apart from other code.",
      "Never open, fetch or clone a git repository for a creative run. When a step needs a call that no a11 tool gives, stop and tell the owner which call is missing.",
    ],
  };
}

/** GET or HEAD /finish/<name>: one file of the kit as plain text, or 404 for any other name. */
export function serveFinishFile(request: Request, name: string): Response {
  const f = Object.hasOwn(FILES, name) ? FILES[name]! : undefined;
  if (!f || (request.method !== "GET" && request.method !== "HEAD")) return new Response("Not found", { status: 404 });
  const headers = {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "public, max-age=300",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  return new Response(request.method === "HEAD" ? null : f.text, { headers });
}
