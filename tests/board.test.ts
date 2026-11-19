import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync(new URL("../app/src/views/Board.tsx", import.meta.url), "utf8");
const card = board.match(/<button\b[\s\S]*?<\/button>/)?.[0] ?? "";

describe("draft card markup", () => {
  it("keeps the card as the only interactive control", () => {
    expect(card).toContain('type="button"');
    expect(card).toContain("aria-pressed={on}");
    expect(card).toContain("onClick={() => toggle(idea, d.key)}");
    expect(card.slice("<button".length)).not.toMatch(/<(?:button|input|select|textarea|a|Checkbox)\b|\btabIndex=|\brole=/);
  });

  it("uses an aria-hidden decorative mark for the selected state", () => {
    expect(card).toMatch(/<span\s+aria-hidden(?:[\s>]|=)/);
    expect(card).not.toContain("<Checkbox");
    expect(card).toContain("{on && (");
    expect(card).toContain('d="M6 12L10 16L18 8"');
  });
});
