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
