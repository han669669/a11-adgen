# Render checklist

Read this file before you write a draft or final prompt, when you pick drafts, and before you send a final. It holds the owner's picture notes from v1 (`han669669/ai-ad-generator`, 2026-10-12 to 2026-10-31): his Pass notes, his Use marks and the rules they produced (v1 `convex/lib/stage.ts` `SCENE_RULES` and `physicsBlock`, `convex/lib/taste/reasons.ts`, `convex/lib/hand.ts`, `convex/lib/objectRead.ts`, `docs/agent-handoff/rubric.md` sections K, L, M, N and P). Batch ids such as B44 are v1 batches. Later rows (from D9) also hold v2 notes; their batch labels, such as W47, are v2 batches.

These are words for you to apply with judgement, not code rules (`docs/v1-lessons.md` §2.2). The idea comes first (`docs/creative-playbook.md` §2). This list stops a good idea from being rejected for its picture.

## 1. Defects: one of these rejects the ad

| # | Check | The owner's evidence |
|---|---|---|
| D1 | **Writing on a prop.** No readable text except the product's own label: the render paints no words, and the approved headline and subline are set in the kit font in code (creative-playbook §7.6). No handwritten note, sticky note, notebook, card, sign, book, magazine or printed paper. The model paints handwriting and small print badly, and it reads as AI at once. When an idea needs words on an object, put the words in the headline instead. | v1 render rule: "leave out props that carry writing"; owner note on a handwritten sticky note: AI slop. W46b tof broke this ("ONE HANDFUL ONLY" note). |
| D2 | **Fake food.** Any food that looks waxy, glossy, invented, cloned or wrong in colour. For the brand's own food, run the food truth stage (`creative-playbook.md` §6). Never paint a prepared food that the product is not (a kaya toast beside a kaya bar). | B39 kaya toast; reason code `fakeFood`. |
| D3 | **AI-rendered prop.** A drip, spill or stain on a cup, glass or plate; waxy or flat liquid; a lumpy or fused rim or handle; plastic texture where the real material has grain. A side prop is dry, empty and solid, except the one real serving that D6 allows. | B44: a drip on an espresso cup, "very ai slop looking less premium". Filled drink, food, hand or fabric props: 0 Use of 9. |
| D4 | **Physics.** Every object rests on a surface with a contact shadow from the one light, or is held in a hand. Nothing floats. Nothing balances on a moving, pouring or tilted object. No food balanced on a spoon for show, no spoon stuck in a pack or jar, no straw in a pan, no cloth over food. A cold product has condensation. | Reason code `physics`; B2/B3 dry "iced" cans. |
| D5 | **Off-putting placement.** No shoes by food, no plates on the floor, no used tea bag or leftovers, nothing odd under or on the product. | Reason code `placement`; B32 used tea bag. |
| D6 | **Unneeded serving.** Show a serving (a slice, a poured glass) only when it shows what the pack hides (cake layers, a tart in its tin) or the true size of a food sold by weight, and it fits the headline. | B46: the Oatside glass of milk "entirely destroys the ad"; the Kele tart "works fine". |
| D7 | **Wrong or garbled logo**, or a logo inside a pill or badge. In v2 the real logo is drawn in code: keep the top band plain. | HFB5b "THEI"; reason code `logoPill`. |
| D8 | **Race, ethnicity or religion.** In copy: never name them (the owner's hard no). In the picture: no stereotype, and never make a person's race, ethnicity or religion the point of the ad. | HFX-mix2: "sounds racist". |
| D9 | **Box print that does not sit on the box.** On a boxed product, every printed line must match the real packshot: crisp, the same weight, the line rising with the box face, and the letter stems standing as they do in the photo. Stems that turn with the line read as a rotated sticker. Run `scripts/box_print.py` and read its `typeset stems` line: the tilt must end at the packshot's value. Compare each line at full size with the product page's own photo. | W47: "the packaging's \"artisan...\" and \"asian-inspired...\" it is smeared"; 09-11-2026: the caps line stems were 10 degrees off on tof and bof; after the fix: "yes looks so so much better". |

## 2. Faults: two of these reject the ad

| # | Check | The owner's evidence |
|---|---|---|
| F1 | **Scale.** Every pack, product and prop keeps its real size next to the others. Write the product's real size in the prompt (from the product page, for example "a 15 cm tall jar"). A cup is small next to a jar; a box of six jars is bigger than one jar. | B36 ad 4: "cup of coffee doesn't match real life dimensions"; B45: no sense of the 1.2 kg size. |
| F2 | **A prop that does not earn its place.** No props by default. Allowed: the one object that IS the headline's idea, and at most one natural companion that people really keep next to the product. Cut a prop that only fills space or sets a mood (a spare bowl, spoon, plate, blanket, saucer, glass of water). Never an upturned bowl or cup (reads unlucky). | HFM-muse ad 1: "remove it and it becomes an usable ad". |
| F3 | **Cheap or stock prop.** Props match the brand's level (a fine porcelain teacup for a heritage brand, never a steel jug or a paper cup). No plastic bottle, foil, tote bag, rag, towel, closed laptop, blank paper bag, plain pillow, bedside lamp, generic mug. | B43: "a fancy chinese teacup would have suffice[d]"; reason code `cheapProp`. |
| F4 | **A hand the idea does not need.** A hand only for an action that the headline names (tearing a sachet, passing the jar). Then one plain hand, cropped at the wrist. | Hand scenes Used 7 of 31; without a hand 51 of 85. |
| F5 | **Object and headline do not click.** Cover the headline: what is the main object for in daily life? The link to the headline must come within one second, and the object's first meaning must not point to another message. | B38: an alarm clock on "3am. Brain still at the office." read as "awake at 3am". |
| F6 | **Busy.** One focal product. Count what the eye must visit at feed size: more than 5 elements fails. No scattered crumbs, pieces or second food. | B41 Used 4 of 4 "because they weren't chaotic or busy like B39". |
| F7 | **Text load and contrast.** Little text, large enough to read on a phone, in plain words. Every sticker and small line contrasts strongly with what is behind it. | Reason codes `textLoad`, `lowContrastSticker`. |
| F8 | **Sameness across the batch.** The 3 ads differ in camera and layout (eye level wide; straight down; close crop that runs off one edge; a 35-degree turn; one real serving). Not the same backdrop and centred product three times. | B46: 32 of 32 finals used the one view of their reference photo. |

## 3. Copy checks (headline, sticker, subline)

- Headline: one idea with a turn, up to 6 words most of the time and never more than 8 (the copy length guide, `creative-playbook.md` §8; it narrows the 7-word maximum of `blueprint.md` hard check 6), sentence case, no exclamation mark. A buyer's own words win (a Reddit title used word for word worked). An oddly specific true detail is good.
- No hype words (unlock, elevate, game-changer, "you deserve", "say goodbye to"). No urgency. No "you" diagnosis question ("Struggling with...?").
- A short true subline under the headline, backed by the product page or the fact sheet (a fact with its source), up to 8 words, and up to 14 words with the headline ("Hand-packaged to order"). Every ad has one: the owner felt ads without one were incomplete. The owner approves both as text before any draft (copy review, `creative-playbook.md` §8).
- No filler sticker: no shelf life, no bare size, no flavour scale, no thin review count (fewer than 20 reviews is never proof).
- tof: no price, saving or shipping sticker. bof: a real reason to buy now, with its condition kept ("free delivery from S$35", not "free delivery"). A price says what it buys (per jar, per box of 6).
- Health and wellness: no health claim in the copy. Claims printed on the pack stay as printed.

## 4. Prompt lines that worked in v1

- Studio look: start the style line with "A real studio photograph, honest and unposed:" and name the real textures (paper texture, light falloff, fine grain). Then: "No glamorization, no heavy retouching, no glossy CG finish. Avoid cinematic lighting and dramatic colour grading." Native look: "A real phone photo, honest and unposed:", with the same no-CG lines.
- At most one small mark, on the backdrop or the surface only (a soft crease in the paper). Never a mark on the product or a prop.
- State the product's real physical state: condensation on a cold product, a level surface on a poured drink, a torn edge on an opened sachet.
- Say the side of the frame for the product (not centred) and give the product's real size.
- Show only faces of the product that the reference photos show. A side the photos do not show stays plain in the pack's base colour, with no new print.

## 5. How to use this file

1. **Ideas.** Kill an idea that needs a D1 to D9 item to work (for example a joke that lives on a handwritten note). Rewrite it so that the headline carries the words.
2. **Prompts.** Write the section 4 lines into every draft and final prompt. Name the one prop and why it earns its place.
3. **Review and final check.** Before you show the drafts to the owner, name any draft with a D item. Before you send a final, go through sections 1 to 3 at phone size. Any D item, or two F items, rejects the draft or the final. Say which item in the report.
4. **Repair a final.** When one non-food item (a note, a drip, a filler prop) spoils an otherwise good final, run `region_fix` with tight boxes and a plain edit. Put the box edges in flat, calm areas (plain wall, empty glass, table), never across a label or text edge: the paste-back keeps a hard edge. Never use `food_fix` for this: its food words paint food in the box (W46b: removing the sticky note filled the empty jar with kernels).
