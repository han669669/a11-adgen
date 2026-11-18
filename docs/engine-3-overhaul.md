# Engine 3 creative overhaul: assessment and plan

Date: 18-11-2026. Status: **the owner chose all four recommended options (D1 to D4 = A) on 18-11-2026 03:34 UTC.** Next: the proof run (section 8). No runtime code until the proof run passes. No model setting changes.
This document uses ASD-STE100 Simplified Technical English with British spelling.

Goals moved: Goal 1 (high-taste, self-improving ads) and Goal 2 (an ad a Singapore brand pays for). Each change in section 6 names its goal.

---

## 0. Bottom line

The first real engine 3 batch (`42207fa1`, W47 E3, Fickle Feline 2.0) failed the owner's bar. Only idea 3 draft 3 was usable, and its words looked "off". The owner would not pay for any draft.

The engine did not fail at one step. It failed at five, and the faults add up:

1. **Concept.** Two of the three picks were copy ideas with no picture idea. The picture was "the packshot in a room".
2. **Product lock as the only camera.** Every draft is the same packshot (the cake on top of its box, at one 15 degree angle), pasted into a different room. The drafts change only the room and the scale.
3. **Art direction.** The rules push to beige: "neutral whites, pale greys", "muted accents", and a kit note that bans the brand's own bright flat colour. The brand yellow shows only on the box.
4. **Type and layout.** One centred stack on all 8 drafts: logo, headline, subline, all in condensed capitals. The Cat & the Fiddle wordmark is itself condensed capitals, so the headline blends with the logo (the IRVINS fault again). The subline is condensed type at a small size. The words touch the cake.
5. **Critic.** It judges concepts from words, not from pictures. A visual score of 3 out of 5 can pass. It has no picture of the bar to compare with.

The five reference ads from v1 do the opposite on each point. Section 6 gives eight changes. Section 7 gives the decisions for the owner. Section 8 gives a cheap proof run before any code.

---

## 1. What was read

| Source | What it gave |
|---|---|
| The 5 reference ads (Moom Mama Water; Allies of Skin bof and mof; Oatside bof and mof), made by v1 | The bar |
| `/mnt/project-files/practice/w47-e3-ff20/` (project folder, not in the repo) | The 8 failed drafts |
| `batch_get 42207fa1` (brief, territories, concept review, directions, prompts) | What engine 3 decided at each stage, and why |
| `plugin/agents/writer.md`, `critic.md`, `art-director.md`; `docs/creative-playbook.md` §7; `docs/a11-engine-v3.md` §5 to §8 | The rules engine 3 follows |
| v1 (read only): `docs/a11-bold-spec.md`, `docs/agent-handoff/rubric.md`, `06-decisions-log.md` | How v1 made the references, and its owner-calibrated checks |
| Craft sources, section 5 | Principles |

---

## 2. What the reference ads do

| Ad | Product truth | One picture device | How the words and the picture lock | Stage | Type |
|---|---|---|---|---|---|
| Allies, bof | Repairs over-exfoliated skin | A peeled lemon (a comparison object) beside the bottle held in a hand | "OVER-EXFOLIATED IT." The lemon is the skin. | Periwinkle seamless, one hard shadow | Heavy condensed capitals, flush right; small logo in a pill above; one CTA chip |
| Allies, mof | A light serum, not a heavy one (2% ectoin) | Butter on toast against the bottle, on a navy and white split | "THICK AS BUTTER ON TOAST. NOT THIS." The headline points at the picture. | Two brand colour blocks | Heavy condensed capitals, flush left; subline in a plain sans under a thin rule |
| Oatside, bof | Oat milk replaces dairy | A cow-shaped milk jug walking away | "THE COW JUG CAN RETIRE NOW." The headline names the prop. | Brand blue wall, white floor | Heavy grotesque capitals, flush right; serif subline |
| Oatside, mof | Tastes right in matcha | The shadow of a steaming cup with no cup | "PERFECTLY TASTY IN MY MATCHA." The viewer finishes the picture. | Flat brand blue | Heavy grotesque capitals, flush left; logo heads the column |
| Moom | A daily ritual in water | A plain glass of water beside one sachet | "Same water. New morning ritual." The picture is the "same water". | Green wall, coral table, sun spot | Serif sentence case, flush left; one round sticker |

What all five share:

1. One product truth, shown by **one** picture device. At most one prop.
2. The headline **points at** the picture, or the picture **finishes** the headline. Neither half works alone.
3. The real product is large, sharp and lit like a studio shot. It is often in a new pose (in a hand, at a new angle).
4. The stage is the brand's own colour, flat or in two blocks, with one hard shadow.
5. Big calm empty space. The words sit in one flush column with the logo small at its head.
6. Two type voices: a heavy headline and a quiet subline in another face.

How v1 made them (`a11-bold-spec.md`): one shared "Bold colour studio" look for the batch (saturated brand-colour backdrop, hard light, one crisp shadow, at most two props); "Wild" metaphors from outside the category, each scored for one-second readability; a concept review whose check 3 is "the scene shows the headline's moment"; the image model draws the product from the packshot as a reference (not pasted pixels), so it can be held, turned or set in a scene; many owner review rounds; and a rubric calibrated on the owner's notes (N object and copy match, P calm, M3 off-putting placement, K AI tells).

---

## 3. What engine 3 made (W47 E3)

| Idea | Headline / subline | Picture | Owner | Cause |
|---|---|---|---|---|
| 1 Chope | "Chope your flavour first." / "Everyone has their eye on one." | A tissue packet on one slice | "atrocious", worst of all | A good Singapore insight, but the prop reads as a white block on food (an off-putting placement, v1 M3). The critic itself noted the risk and still gave the visual 4 of 5. |
| 2 Nobody can blame you | "Now nobody can blame you." / "A flavour for every cheesecake lover." | The packshot on a counter or a meeting table | "atrocious" | No picture idea. The critic wrote: "The picture is a packshot in a room: it carries 'something for every colleague' only, not the blame." It passed with visual 3. |
| 3 Someone took the best one | "Someone already took the best one." / "Good thing there are nine more." | The cake with one slice gone | Draft 3 usable; "scroll stopping"; words "off" | A real picture device (closure). The words were the fault: see section 4.4. |

Note: 10 of the 12 rejected concepts were rejected as "plain packshot: the picture adds nothing". The writer could not find picture ideas, because the system lets it change only the room around one fixed photo (section 4.2).

---

## 4. Root causes, stage by stage

### 4.1 Concept

- The writer writes an insight and a line, then a "visual". The visual is usually a room. The rules say "Prefer what can be made true: the real pack... Hands and people are high risk", so the writer avoids the things the references use: a hand, a prop that stands for the truth, the product in a new pose.
- The mechanism names (behavioural observation, product obsession, and so on) are labels. They do not give the writer a picture.
- The cover test is filled in by the writer and accepted by the critic. "A ten-flavour cake waiting in an office pantry" passed as "the picture alone".
- Nothing asks whether the headline points at anything you can see. In the references it always does.

### 4.2 Product lock as the only camera

- Engine 3 drafts start from a product-lock skeleton: the brand's packshot pasted at its own angle, then "turned into a photograph". This keeps the label exact. It also fixes the camera.
- The Fickle Feline packshot is a catalogue photo: the cake sits on top of its closed box. Nobody sees the cake like that in life. All 8 drafts show it like that.
- The drafts could vary only the room (pantry, meeting room, counter) and the scale. The "3 questions" became "which room".
- v1 lets the image model draw the product from the packshot as a reference. Then the product can be held, opened, turned, or set beside a prop. v1 checked the label afterwards (text check, packshot blend when needed). The references show that label fidelity at this quality is reachable that way.

### 4.3 Art direction

- `art-director.md` "calm rules": "a plain lit surface unless the concept needs a place, muted accent colours". The direction for idea 2 chose "neutral whites, pale greys and pale oak, so the brand-yellow box ... is the only saturated colour". Idea 3 chose "warm white and pale stone".
- The Cat & the Fiddle kit note says: "The brand's own site ads are bright flat-colour backdrops ... avoid copying that look." This bans the very look of all five references.
- Result: dull beige rooms, black type, and a product that looks pasted into a show flat. The references put the product on a stage of its own brand colour.

### 4.4 Type and layout (the "off" words)

Measured on idea 3 draft 3 (1024 x 1280):

1. **Three stacked blocks in one voice.** The logo, the headline and the subline are centred on one axis, and all three are condensed sans capitals or near it. The Cat & the Fiddle wordmark is a condensed bold sans, so the Oswald headline reads as a bigger copy of the logo. This is the IRVINS "blended" fault (owner, 16-11-2026), in a new form.
2. **The subline is condensed type at a small size.** Oswald 600 in sentence case at 0.40 of the headline looks cramped and thin. Every reference sets the subline in a different, wider face (Allies: plain sans; Oatside: serif).
3. **No air between the words and the product.** The subline ends about 30 px above the meringue. The block and the cake touch. The references keep a wide gap.
4. **Centred and wide.** The headline spans about 63% of the width in two equal lines. Centred stacks read as a template. The references use one flush column (left or right) about 45 to 55% wide, 2 to 3 short lines, tight leading, and the logo small at the column's head.
5. **One template on all 8 drafts.** The layout never changed with the idea.

### 4.5 Critic

- The concept review reads words only. It scores "visual" without seeing a picture. The Chope tissue packet got visual 4.
- The select rule is "no dimension under 3". Idea 2 passed with visual 3, although the critic wrote that the picture does not carry the idea.
- The draft check is technical: shape within 2%, label, logo, food, physics. Nothing asks "would the owner pay for this?" or "does it sit beside the bar?".
- v1's owner-calibrated checks (N object and copy match, P calm, M3 off-putting placement) are not in the engine 3 critic.

### 4.6 Learning

- The gold set from v1 has no images (`docs/v1-lessons.md` §4). The canon is words only.
- The references the owner likes are not in the system. No agent can look at the bar.

---

## 5. Principles from the craft (and the rule each one gives)

| Principle | Source | Engine rule |
|---|---|---|
| The art director and the copywriter make one idea together; the picture and the words are halves | Bernbach and DDB's art-and-copy teams (Krone and Koenig on VW "Think Small", 1959) [1] | The concept is a **pair**: one picture device plus the line that points at it |
| "Can the solution be entirely visual?"; "Show, don't tell" | Luke Sullivan, *Hey Whipple, Squeeze This* [2] | The picture must carry the idea with the words covered |
| Let the viewer finish it: the audience "may need to travel only 5% or as much as 40%" to get the idea | *Hey Whipple*, quoting a design source [2]; "Pass the Heinz" (DAVID Miami, 2017) showed food with no bottle [3] | **Closure** is a first-class device: a missing slice, a shadow with no cup, the thing it replaces |
| Visual metaphors of moderate complexity are liked most; too complex and people opt out | Phillips and McQuarrie 2004; van Mulken et al. 2014, *Journal of Advertising* [4] | One juxtaposition (object beside product) beats a puzzle. The link must click in about one second |
| Brand cues work by consistent use; colour is strongest when it is combined with shape and logo | Romaniuk, *Building Distinctive Brand Assets*; Sharp, *How Brands Grow* [5] | The stage is the brand's own colour by default. A small brand never leaves out its brand: leave out a part of the product, not the product (Heinz could omit the bottle because it is famous) |
| Few typefaces; one or two sizes with strong contrast; white space is more important than the black of the type | Vignelli, *The Vignelli Canon* [6] | Two type voices, a flush grid, a wide gap round the words |
| Pictures with "story appeal" stop people; the reader looks at the picture first, then the headline | Ogilvy, *Ogilvy on Advertising* [7] | One living trace (a hand, a bite gone, a shadow) beats a product alone in an empty room |
| Flat, abstract, literal work is less effective than work with something living and unexpected | Orlando Wood, *Lemon* (IPA, 2019), System1 data [8] | The bold studio stage is fine, but it needs one living or unexpected detail. A packshot in a bare room has neither |
| Impact, then communication, then persuasion | Dave Trott [9] | The critic checks in this order at phone size: does it stop me, do I get it in a second, do I want it |

Sources (read 18-11-2026):
[1] https://en.wikipedia.org/wiki/Think_Small
[2] https://www.academia.edu/10459919/Hey_Whipple_Squeeze_This ; chapter list: https://search.lib.uts.edu.au/discovery/fulldisplay?vid=61UTS_INST%3A61UTS&docid=alma991007142004805671
[3] https://www.adweek.com/creativity/50-years-later-heinz-approves-don-drapers-pass-the-heinz-ads-and-is-actually-running-them/ ; https://www.businessinsider.com/heinz-pass-the-heinz-ads-from-mad-men-don-draper-2017-3 (the reach and award figures in the owner's note are not verified here)
[4] https://pmc.ncbi.nlm.nih.gov/articles/PMC7235424/ ; https://www.semanticscholar.org/paper/37fdcc7b17056fddede2513e171d17e0339d5b1f
[5] https://tianpan.co/blog/2025/09/01/building-distinctive-brand-assets-by-jenni-romaniuk (a summary, not the book)
[6] https://www.rit.edu/vignellicenter/sites/rit.edu.vignellicenter/files/documents/The%20Vignelli%20Canon.pdf
[7] https://hammock.com/content-marketing/david-ogilvys-house-ad-how-to-create-advertising-that-sells/
[8] https://www.alexmurrell.co.uk/summaries/orlando-wood-lemon (a summary; the data is from TV ads)
[9] https://abitgamey.substack.com/p/how-would-dave-trott-sell-something

---

## 6. The overhaul

Order: the first five changes are words, prompts and data (no code). The last three need code. Each is a small PR.

| # | Change | Stage | Goal | Kind | Size |
|---|---|---|---|---|---|
| C1 | **The bar wall.** Put the 5 references, the owner-approved finals (Fickle Feline `f7886f1d`, Oatside `e8d74f93`, IRVINS `1216dca0`) and the "Pass the Heinz" case in the swipe file, each with the owner's words and the device it uses. The writer, the art director and the critic look at them before they work | all | 1 | data (`swipe_add`) and agent prompts | S |
| C2 | **Picture device first.** A concept starts from one picture device, from a short list taken from the bar: comparison object (lemon, butter), the thing it replaces (cow jug), closure (missing slice, shadow with no cup), ritual pair (glass and sachet), product state (open, poured, bitten), proof in hand. Then the line that points at it. New **point test**: the headline names or points to something you can see, or the picture finishes the line. The writer may use a hand or a prop when the device needs it | concept | 1, 2 | `writer.md`, playbook | S |
| C3 | **Look families, brand colour first.** The art director picks one family per concept and says why: (a) brand-colour seamless with one hard shadow, (b) two brand-colour blocks, (c) a coloured wall and floor still life. A neutral real room only when the concept needs a place. Drop "muted" and "neutral whites" as defaults. Remove the Cat & the Fiddle kit note that bans its bright flat colour (needs the owner's yes, D2) | art direction | 2 | `art-director.md`, playbook, kit note | S |
| C4 | **Drafts ask about the device, not the room.** The 3 drafts differ in how the device is staged: close against wide, with the prop against without, in a hand against on a surface, a new camera angle. A change of room alone does not count | art direction | 1 | `art-director.md` | S |
| C5 | **Critic sees what the owner sees.** The critic judges at phone size against the bar wall, in Trott's order (stop, get it in one second, want it). Select only with visual 4 or more and a pass on the point test. Port v1's owner-calibrated checks as words: N (object and copy match), P (calm), M3 (off-putting placement, for example a tissue on food), K (AI tells). One pairwise question per pick: "Does this sit on the same page as the bar?" | critic | 1 | `critic.md` | S |
| C6 | **Type lockups.** `headline.py` gets 4 lockups: flush-left column, flush-right column, top band left, split panel. The logo sits small at the head of the text column, on its edge. The subline uses the brand's second font at regular width (Cat & the Fiddle: Assistant 600, not Oswald). Headline leading 0.92 to 0.95, tracking about -1%, subline 0.30 to 0.36 of the headline. A clear gap of at least 4% of the height between the words and the product. No centred three-block stack unless the art director names a reason. When the logo is set in a face close to the headline face, the logo must differ by place and size | type | 2 | code: `scripts/headline.py` and tests | M |
| C7 | **Rough before the copy review.** For the critic's top 5 concepts, make one low rough each (about US$0.03 each, about US$0.15 for each batch at the blueprint estimate). The critic selects 3 from the roughs. The owner sees each pick's rough beside its words at the copy review | concept, critic | 1, 2 | code: a rough render kind (today `render_submit` refuses an idea that is not picked) | M |
| C8 | **Reference render for the product.** Default for engine 3 drafts: the image model draws the product from the packshot and texture photos as references, so it can be held, opened, turned or staged with a prop (the v1 method). A fidelity gate checks shape ratio, label words and logo on each draft. The final keeps the existing repairs (`reprint`, `box_print.py`, `region_fix`). The product lock stays as the fallback when a draft fails the gate twice, and for flat cartons where it already works | render | 2 | code and prompts: art-director, a check script, tests | M |

What stays the same: real packshots and logos as the truth; facts only from the fact sheet; the copy length rules; the brand font rule; the owner picks every draft; `photo_finish.py`; engine 2 and the daily practice (no change at all); v1 (read only, no change).

What this plan does not do: no new hard check in code (the 15-check budget holds; taste goes in words); no model change; no change to the deliverable count.

---

## 7. Decisions for the owner

Decided 18-11-2026 03:34 UTC: the owner chose A on all four (`docs/decisions.md`).

| # | Question | Options | Recommended |
|---|---|---|---|
| D1 | How does engine 3 draw the product? | A: reference render by default, with a fidelity gate; product lock as the fallback. B: product lock always (today). C: the art director chooses for each concept | **A.** The lock fixes the camera and made all 8 drafts one picture. The references were made the A way |
| D2 | What is engine 3's default stage? | A: brand-colour studio families first, a real room only when the concept needs one. B: a new look for each idea with no default (v3 decision 5 as written). C: the engine 2 house recipe | **A.** All 5 references use it. It keeps decision 5 (each idea still gets its own look inside a family). Also remove the Cat & the Fiddle kit note that bans bright flat colour |
| D3 | Make a cheap rough before the copy review? | A: yes, about US$0.15 for each batch. B: no, words only (today) | **A.** The critic and the owner judged Chope from words; the picture failed |
| D4 | Proof before code? | A: one hand-run test batch with C1 to C5 and C8 done by hand (about US$0.50), then code. B: build the code first | **A.** It tests the ideas for cents before any build |

The C6 type changes need no decision: they apply the owner's existing rules (brand fonts, headline apart from the logo). The owner sees them in the proof run.

---

## 8. Proof run (after D4 = A)

1. Same product: Fickle Feline 2.0, so the result compares with W47 E3. A new engine 3 batch, run by hand in the main session with C1 to C5 and C8 as written instructions. The type set by hand with the C6 settings (flags that `headline.py` has today, plus a manual subline font).
2. Show the owner 3 concepts with roughs and words; then 3 drafts each.
3. Pass criteria (set before the run):
   - the owner calls at least 2 of 3 ideas usable, and at least 1 an ad he would pay for;
   - side by side with the 5 references at phone size, the owner does not call every engine 3 ad weaker;
   - no draft shown with a render-checklist D item.
4. If it passes: build C6, C7 and C8 in code, one small PR each, and C1 to C5 as prompt and doc PRs. Then a second product in another category (a drink or a wellness product) to prove it is not a cake trick.
5. If it fails: record the owner's words, find which change did not hold, and report before any code.

Cost: about US$0.50 (5 roughs, 9 low drafts, no finals). Inside the live spend cap.

---

## 9. Not verified

- The fidelity of reference render on the Fickle Feline cake (10 different slices) is not tested. The proof run tests it. The fallback is the product lock.
- The type diagnosis in 4.4 is my reading of the picture against the references. The owner could not name the fault; the proof run tests it.
- Craft sources [5] and [8] are summaries, not the books. [8] measured TV ads, not static ads.
- The reach and award figures for "Pass the Heinz" in the owner's note are not verified. Only the campaign facts in [3] are.
- The rough cost uses the blueprint estimate (about US$0.028 for each low draft), not a new measurement.
