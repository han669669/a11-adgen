import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The web app has no render tests in this suite, so these read the source of the card.
const board = readFileSync(new URL("../app/src/views/Board.tsx", import.meta.url), "utf8");
const pressed = board.indexOf("aria-pressed={on}");
const card = board.slice(board.lastIndexOf("<button", pressed), board.indexOf("</button>", pressed));
const mark = board.match(/function PickMark\b[\s\S]*?\n}\n/)?.[0] ?? "";
const CONTROL = /<(?:button|input|select|textarea|a|Checkbox)\b|\btabIndex=|\brole=/;

describe("draft card markup", () => {
  it("keeps the card as the only interactive control", () => {
    expect(card).toContain('type="button"');
    expect(card).toContain("aria-pressed={on}");
    expect(card).toContain("onClick={() => toggle(idea, d.key)}");
    expect(card.slice("<button".length)).not.toMatch(CONTROL);
  });

  it("draws the pick mark with no control in it, hidden from assistive technology", () => {
    expect(card).toContain("<PickMark on={on} />");
    expect(mark).toMatch(/<span aria-hidden\b/);
    expect(mark).toContain("{on && (");
    expect(mark).not.toMatch(CONTROL);
    expect(board).not.toContain("@/components/ui/checkbox");
  });
});
