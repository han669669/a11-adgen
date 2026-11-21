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
  "requirements.txt": "The Python packages: python3 -m pip install -r requirements.txt",
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

/** The MCP tool finish_kit: each file's address on this Worker, its SHA-256 and its use, and the commands to fetch and check them. */
export async function finishKit(baseUrl: string) {
  const sums = await sha256s();
  const base = baseUrl.replace(/\/+$/, "");
  const files = Object.entries(FILES).map(([name, f]) => ({
    name,
    url: `${base}/finish/${name}`,
    sha256: sums[name]!,
    bytes: new TextEncoder().encode(f.text).byteLength,
    use: f.use,
  }));
  return {
    files,
    setup: [
      "mkdir -p a11-finish && cd a11-finish",
      ...files.map((f) => `curl -fsS --proto =https -o ${f.name} ${f.url}`),
      `printf '%s\\n' ${files.map((f) => `'${f.sha256}  ${f.name}'`).join(" ")} | sha256sum -c -`,
      "python3 -m venv .venv && . .venv/bin/activate",
      "python3 -m pip install -r requirements.txt",
    ],
    notes: [
      "Run each script as python3 <name> --help to read its options. The house rules (rules_get) say when each one runs.",
      "Keep these files and the pictures in their own folder, apart from other code.",
      "macOS has no sha256sum: use shasum -a 256 -c - instead.",
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
