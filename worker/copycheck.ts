/**
 * Warnings on the words of new ideas (house rules CP1, CP5, CP6; creative-playbook §8). They are true or false facts
 * about the text (a word count, a price on a top-of-funnel line, a past year), never a refusal: the owner's copy review
 * is the gate, and words he approves stand over the guide.
 */

interface Words {
  format: string;
  headline: string;
  copy?: Record<string, unknown>;
}

/** Words with a letter or a digit in them: "S$58.90." is one word, a lone dash is none. */
export const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

const PRICE = /(?:S\$|SGD|\$)\s?\d|\d\s?%\s?off\b|\bfree\s+(?:delivery|shipping)\b/i;
const YEAR = /\b(?:19|20)\d{2}\b/g;

/** The year on the Singapore clock (UTC+8). */
const sgYear = (at: Date) => new Date(at.getTime() + 8 * 3600_000).getUTCFullYear();

export function copyWarnings(ideas: readonly Words[], at = new Date()): string[] {
  const out: string[] = [];
  const year = sgYear(at);
  ideas.forEach((idea, i) => {
    const where = `ideas[${i}]`;
    const sub = typeof idea.copy?.subline === "string" ? idea.copy.subline : "";
    const h = wordCount(idea.headline);
    const s = wordCount(sub);
    if (h > 8) out.push(`${where}: the headline has ${h} words; the owner's guide is 6 most of the time and never more than 8 (house rule CP1). Shorten it, or show it to him as it is.`);
    if (s > 8) out.push(`${where}: the subline has ${s} words; the guide is 8 or fewer (house rule CP1).`);
    if (h <= 8 && s <= 8 && h + s > 14) out.push(`${where}: the headline and subline have ${h + s} words together; the guide is 14 or fewer (house rule CP1).`);
    const both = `${idea.headline} ${sub}`;
    if (idea.format === "tof" && PRICE.test(both)) out.push(`${where}: a top-of-funnel line names a price or an offer; tof has none (house rule CP6).`);
    const past = [...new Set(both.match(YEAR) ?? [])].filter((y) => Number(y) < year);
    if (past.length) out.push(`${where}: the words name ${past.join(", ")}; an old year or award reads outdated to the owner (house rule CP5). Keep it only when it is the idea, such as a founding year.`);
  });
  return out;
}
