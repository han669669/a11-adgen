import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../.github/workflows/", import.meta.url);
const uses = readdirSync(dir).flatMap((file) =>
  readFileSync(new URL(file, dir), "utf8")
    .split("\n")
    .filter((line) => /^\s*(- )?uses:/.test(line))
    .map((line) => `${file}: ${line.trim()}`),
);

describe("GitHub workflows run only the action code that was reviewed", () => {
  it("pins each action to a full commit SHA, with the release tag as a comment", () => {
    // The owner of an action can move a tag to other code. A commit SHA always names the same code.
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((line) => !/uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(line))).toEqual([]);
  });
});

describe("GitHub workflows keep outside code off Avrea runners", () => {
  // The repository is public. A pull request from a fork must run on a GitHub-hosted runner, and the
  // repository variable CI_GITHUB_HOSTED must move every job back to GitHub-hosted runners.
  const runsOn = readdirSync(dir).flatMap((file) =>
    readFileSync(new URL(file, dir), "utf8")
      .split("\n")
      .filter((line) => /^\s*runs-on:/.test(line))
      .map((line) => ({ file, line: line.trim() })),
  );
  const guard =
    "(vars.CI_GITHUB_HOSTED == 'true' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository)) && 'ubuntu-latest' || 'avrea-";

  it("gives each Avrea job the fork fallback and the way back", () => {
    const avrea = runsOn.filter(({ line }) => line.includes("avrea-"));
    expect(avrea.length).toBeGreaterThan(0);
    expect(avrea.filter(({ line }) => !line.startsWith(`runs-on: \${{ ${guard}`))).toEqual([]);
  });
});
