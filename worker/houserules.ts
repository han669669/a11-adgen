/**
 * The owner's house rules: his settled taste and process decisions from the batch reviews (07-11-2026 onward), in one
 * place on the server, so every MCP client follows them, with or without the a11 plugin. A client that does not load
 * plugin/agents/*.md (Cursor, 21-11-2026, issue 144) still gets them from rules_get.
 *
 * This file is the one operative copy. The evidence (the owner's words, the batch, the date) stays in
 * docs/creative-playbook.md and docs/render-checklist.md; tests keep the defect codes equal in the three places.
 * The learned canon (canon_get) is separate: it holds taste rules with evidence counts and the gold test guards it.
 * A new settled owner decision that every client must follow goes here, in a PR, and RULES_VERSION changes with it.
 */

export const RULE_ROLES = ["writer", "critic", "art-director", "main"] as const;
export type RuleRole = (typeof RULE_ROLES)[number];

interface Section {
  key: string;
  title: string;
  roles: readonly RuleRole[];
  rules: readonly string[];
}

const ALL = RULE_ROLES;

/** The defect list of docs/render-checklist.md, one line per code: the codes checks_save takes. */
export const CHECK_CODES: readonly (readonly [string, string])[] = [
  ["D1", "Writing on a prop: no readable text except the product's own label; no note, card, sign or printed paper."],
  ["D2", "Fake food: waxy, glossy, invented, cloned or wrong-colour food; food in a shape it never has; a model-drawn food prop or side food; any crumbs, smear, leftovers, torn cut face or slice pulled or set apart."],
  ["D3", "AI-rendered prop: a drip, spill or stain, waxy liquid, a fused rim or handle, plastic texture. A side prop is dry and empty, except the one real serving that D6 allows."],
  ["D4", "Physics: something floats or balances for show; no contact shadow; a pack handled as no real pack can be (a pouch folded more than once, branding covered)."],
  ["D5", "Off-putting placement: shoes by food, plates on the floor, a used tea bag, leftovers."],
  ["D6", "Unneeded serving: a slice or poured glass that does not show what the pack hides or the size of a food sold by weight, or does not fit the headline."],
  ["D7", "Wrong or garbled logo, or a logo in a pill or badge. The real logo is drawn in code."],
  ["D8", "Race, ethnicity or religion named in copy, or made the point of the picture."],
  ["D9", "Box print that does not sit on the box: smeared lines, or stems that turn like a rotated sticker."],
  ["D10", "Pasted product light: the product keeps the packshot's studio light, not the scene's light, shade, reflections and contact shadow."],
  ["D11", "Product drawn wrong in the final: cap off the body centre (over 1% of its width), wrong shape, or glare across the print."],
  ["F1", "Scale: a pack, product or prop not at its real size next to the others."],
  ["F2", "A prop that does not earn its place."],
  ["F3", "Cheap or stock prop below the brand's level."],
  ["F4", "A hand the idea does not need."],
  ["F5", "Object and headline do not click within one second."],
  ["F6", "Busy: more than 5 elements at feed size, or a second focal point."],
  ["F7", "Too much text, or text that is too small or low in contrast on a phone."],
  ["F8", "Sameness: the drafts or the 3 ads share one backdrop, camera and layout."],
];

const SECTIONS: readonly Section[] = [
  {
    key: "OW",
    title: "The owner and the process",
    roles: ALL,
    rules: [
      "The owner chooses: in engine 3 the 3 concepts (from ALL concepts, shown with each one's rough and the critic's notes; the critic's picks are advice; in engine 2 the critic picks the 3 ideas), the words (the copy review, before any draft), 1 draft per idea, and every verdict on a final. Never pick for him, and never say which draft you prefer.",
      "Save his words exactly as he wrote them, with his spelling, case and punctuation (\"favorite\", \"OATSIDE\", a lowercase subline). Never correct them. Words he approved stand over every length guide.",
      "A draft verdict with mark 'pass' means he rejected ALL drafts of that idea. For a usable or liked draft, save the pick or a 'fix' note with his words. Never use 'pass' for usable.",
      "When he leaves a choice to you (\"ur pick\", \"use either pump or cap\"), choose the brand's main option, say which, and keep it in every round. When he chose an option (Allies: the cap, not the pump), never switch without asking him.",
      "When he likes the words, the logo or the layout of a draft and asks for a redo for another reason, keep that layout (headline area, logo place and size, type size, product place and size) and change only what he asked.",
      "Each round fixes what he named and breaks nothing he liked. Before you show a redo, put it beside the version he liked and compare.",
      "Show drafts numbered 1 to 3 from left to right, with no rank. Name every draft that has a D item. When you try a new finish or option, show both (with and without; cap and pump).",
      "Show the owner a draft only with the approved words and the kit logo set inside the picture (scripts/headline.py --logo, from finish_kit). Never show a bare photo and ask him to imagine the words (IRVINS, 21-11-2026: that board was of no use to him).",
      "Report in short simple sentences, result first. 'Usable' is not his bar: his bar is an ad he would pay for out of his own pocket and be proud of, beside his 5 reference ads (Moom, Allies of Skin x2, Oatside x2). Never say an ad passed that test unless he said so.",
      "Offer at most one other headline or subline, marked as an option. His own words win.",
      "For a creative run, use the a11 tools, the files that finish_kit serves and the brand's own public pages and photos. Never open, fetch or clone a git repository for it. When a step needs a call that no tool gives, stop and tell the owner which call is missing.",
    ],
  },
  {
    key: "CO",
    title: "Concepts",
    roles: ["writer", "critic", "main"],
    rules: [
      "One idea that the picture and the headline carry together. Cover the headline: the picture still says part of it. Cover the picture: the headline still means something.",
      "Start from one picture device that the product's truth calls for, at the level of the reference ads (a zested lemon for over-exfoliated skin, butter on toast for a thick serum). For food, the food itself is the device (the cake from above as a pie chart: \"The only pie chart I like.\").",
      "Point test: the headline names or points at something you can see, or the picture finishes the line.",
      "Local truth: a behaviour that Singapore buyers really have (\"no one flips a coin to decide\" here). Never name or hint at race, ethnicity or religion.",
      "Real-world truth: every food and pack exists and is handled as in real life (fish skin is short curled pieces, so a tally of long straight strips fails; a pouch folds once). A concept that needs an impossible shape fails at the concept stage, before any render.",
      "Check the brand's certifications and limits first: a halal brand gets no alcohol or pork pairing (IRVINS beer ideas were killed; Meta also limits alcohol ads).",
      "Do not require that a prop acts out the problem at the concept stage (owner, 20-11-2026: creative is nuanced).",
      "Engine 3 reaches for deeper, original concepts. His plain-line picks on engine 2 do not pull engine 3 back to plain lines.",
      "Critic notes are short, plain and true to the product: check the product's facts before you suggest a staging (a note that suggested a wok for a kettle-cooked snack was \"gibberish\").",
      "A bottom-of-funnel ad shows what the buyer takes home. One hero pack on a plain, lit surface beats a busy multi-pack scene. Tell the rest of the range in the Meta text, not in the picture.",
    ],
  },
  {
    key: "CP",
    title: "Copy",
    roles: ["writer", "critic", "main"],
    rules: [
      "Headline: up to 6 words most of the time, never more than 8. Subline: up to 8 words. Both together: up to 14. The shorter of two equal lines wins. Every ad has a subline: render_submit refuses a draft for an idea without one. ideas_save warns when a line goes over.",
      "Voice: the buyer's own plain words, local and conversational, full words and full stops. A direct question the product answers (\"Can't pick a flavour?\", \"Why pick just one flavour?\"), a first-person line (\"The only pie chart I like\"), or a short punch (\"Too slow.\", \"Last one already?\"). Singapore phrasing is welcome (\"So worth it.\").",
      "Do not write clever abstract turns (\"Everyone picks, nobody fights.\", \"The group chat can relax.\"), fragment lists (\"Ten people. Ten slices. S$58.90.\"), an argument against a rival that the picture cannot show, hype words (unlock, elevate, game-changer), invented urgency, a 'you' diagnosis question, or an exclamation mark without a reason.",
      "Only facts from the fact sheet, each with its source. No health claim. A claim from a study keeps a small footnote with its source on the picture (headline.py --footnote). Price math must be true and useful (S$58.90 for 10 slices is under S$6 a slice, against S$8 to S$10 for a cafe slice).",
      "No dated reference: an old year or an old award \"sounds outdated\" (the owner, in 2026, on a 2024 award). A founding year is fine when it is the idea. ideas_save warns on a past year.",
      "Top of funnel: no price, saving or delivery offer. Bottom of funnel: one true reason to buy now, with its condition. The count or the flavour in the copy matches the picture.",
      "Reuse approved copy word for word, also in the pack's Meta text. Write new copy only when he asks, and show it beside the approved copy.",
    ],
  },
  {
    key: "TY",
    title: "Type, logo and breathing space",
    roles: ["art-director", "critic", "main"],
    rules: [
      "The model paints no words. The approved words are set in code (scripts/headline.py) in the brand's own primary font, never another family (not Anton). When that font is the logo's own face, use the brand's next site font, so the headline does not blend into the logo.",
      "Poster style: the headline in capitals at the heaviest weight, leading about 1.0, 2 or 3 short stacked lines, no one-word line alone. A soft display serif whose capitals look wide and weak (Recoleta) stays in sentence case. The subline one weight lighter, never Light, in sentence case, at 0.4 to 0.5 of the headline size (0.36 was \"too small to be readable\").",
      "Size: big enough to read at phone size and to punch like \"Too slow.\" and \"This one.\", never cramped. \"A tiny bit bigger\" means about 5%, not 18%.",
      "Accent colour: one key phrase on one ad of a batch at most, in a calm version of the brand accent (Cat & the Fiddle #DD4430, not the kit's #FA363A: \"too strikingly in the face\").",
      "Breathing space: at least 4% from the words and the logo to each edge, at least 3% from the logo to the headline, at least 3% (4% by default) from the words to the product; headline.py refuses less. Too much space is a fault too: the logo and the words must still read as one lockup (IRVINS: \"now too much breathing space\").",
      "One logo size and place for each brand, from the kit placement, on every ad (Allies of Skin: 28% wide, 4% from the top). The headline starts at the same height on every ad of a batch, and its size stays close from ad to ad.",
      "The logo is optically centred on its wordmark (a TM or R mark is left out of the centre), big enough to read at a glance, and never an afterthought: in a column layout it heads the text column. On a dark backdrop use a light version of the logo (Oatside: cream on brown).",
      "The words sit on one plain tone: no sharp colour or shadow edge runs through them. A footnote never sits over an object or a shadow edge.",
      "The words and the logo sit inside the photograph, on its plain backdrop. Never a separate panel or colour block that holds the words above, below or beside a smaller inset photo (IRVINS, 21-11-2026: he rejected all nine at one look).",
      "The words must read at a glance: light words on a mid or dark backdrop, dark words on a light one. scripts/headline.py refuses a line under APCA lightness contrast 40 and names the colour that reads (owner, 26-11-2026, B/SKIN: dark words on a mid sage wall were \"really difficult to read\"; light words on the green wall were approved). Change the words' colour (and use the matching logo) or the wall's tone, never the copy.",
    ],
  },
  {
    key: "PR",
    title: "Product truth and scale",
    roles: ALL,
    rules: [
      "The product matches the real one in every dimension. Before the first image, find its real height and width (the product page, a retailer's listing, the brand's photo of it beside its carton or in a hand) and save them with the source in the kit notes. The size guide is the brand's own photos, never an earlier render.",
      "Give scale through things in the picture (\"the pot rim level with the bottle's shoulder\"): the model ignores centimetres. A prop of unknown size is never the ruler; never shrink the product to a guessed prop size. Show true-scale cues where scale reads (a fridge so wide that its far side runs out of the frame; subway tiles and a worktop edge at true size).",
      "Measure every draft and every final again: the shape against the packshot (scripts/pack_check.py, 2%), the cap on the body centre within 1% of its width (scripts/cap_check.py), and every printed word against the packshot (the net weight, TM against R). Fix wrong small print with a local patch from the packshot, not a new render. A front-on body that drifted (a model pass made it 1 to 5% taller, or the cap narrower) is corrected in code with scripts/shape_fix.py before the owner sees it; a drift over 8% is rendered again (owner, 26-11-2026).",
      "A pack is handled as a real one can be: a pouch folds at most once, above its print, and nothing covers the brand name, the logo or the product name. A box reads as a plain box with four sides.",
      "A packshot that is a flat or 3D mock-up is rebuilt as a real object in the final (a carton: light across the front, rounded paperboard edges, creased ears, a matte cap; a pouch: pillowy film, creases, foil in the open mouth, a contact shadow). Do not paste the mock-up print back over it.",
      "Multiples never look cloned: no identical packs at equal gaps. Small turns, uneven gaps, one lying or leaning, as a person would put them down. Back packs recede (shadow, soft focus) and never take the light from the hero.",
      "Never redraw scrambled print by hand or with a drawn patch: it reads as a shape pasted on the pack (IRVINS, 21-11-2026). When a rough drew scrambled print on a face that must read (a pouch lying down), make that draft from a layout plan that copies the rough's camera, place and size (product_lock.py layout), so reprint puts the real print back.",
      "Know the product's surface (matte, satin or glossy) from the brand's own photos before the first image, and save it with the source in the kit notes. Every draft and final prompt names it (owner, 26-11-2026: the B/SKIN bottle is \"slightly matte\" satin, not glossy, and the drafts showed it glossy).",
      "Two packs in one picture stand apart, with a clear gap between them. Where one pack overlaps another, the reprint of the back pack spills onto the front pack's edge and leaves a seam (owner, 27-11-2026, PopoMama: he circled the seams). A back pack in soft focus (as above) gets \"blur\" in its layout plan, and reprint keeps it as soft: check its print at full size.",
    ],
  },
  {
    key: "LI",
    title: "Light, camera and the first glance",
    roles: ["art-director", "critic", "main"],
    rules: [
      "First-glance test: the picture looks photographed by a real camera at that exact angle. If it reads as an AI image at first glance, it fails, whatever else is right.",
      "The product takes the scene's light: the highlight on the light's side, the shade on the far side, the scene seen in a glossy surface, a contact shadow that agrees with the other shadows (D10). A glossy or rounded product (a bottle, a tube, a glossy jar) gets the brand's real photo as a reference only: no skeleton paste and no product_lock.py reprint. A front-on printed label of a clear colour then goes back with scripts/label_transfer.py: it moves only the ink and keeps the scene's light; a white or pale label gets a local patch from the packshot (owner, 26-11-2026: the model redrew the B/SKIN small print, with uneven spacing and ghosting).",
      "No glare, streak or reflection across any printed letter: the print stays legible at phone size (D11).",
      "More control gives more AI look. Prefer a simple scene of few large real objects. When the owner picked a concept from its rough, make the drafts from that rough with a short prompt (under about 900 characters).",
      "Run the real-camera finish (scripts/photo_finish.py) on drafts and finals: subtle, tuned by eye; hold a brand colour exact with --keep. It keeps each colour's hue: a lit yellow must not turn green (owner, 26-11-2026).",
      "What won his eye: a bright light reflecting on a prop, depth of field, real shadows and legible print, \"scroll stopping but not in your face\".",
      "A draft check judges an ad, not only defects: check each draft with its words and logo set, beside its rough and the owner's notes. A draft that lost the picked rough's device, put back a fact the owner changed, or no longer says the line at first glance is weak: set composition to fail, so it is not eligible, and say why in reason (IRVINS, 21-11-2026: nine eligible packshots that he rejected at one look).",
      "Never brighten one face or one object in code: a product lit on its own reads as pasted in, not photographed (owner, 27-11-2026, PopoMama: \"doesnt feel like the actual product's there\"). A product that is too dark gets a new render with the scene relit (where the light comes from, the light across each front, the contact shadow), then at most one brightness gain on the whole picture (scripts/exposure.py). Before you show a final, measure each product front against the picked draft (scripts/exposure.py --measure): a final front more than 5% darker than in its draft gets the gain or a new render before you show it (the PopoMama finals were 10 to 17% darker, and he rejected them as too dark).",
    ],
  },
  {
    key: "FO",
    title: "Food",
    roles: ALL,
    rules: [
      "Real brand food only: find the brand's own photos of the food (each slice, a pile, a plated shot) and use them as the truth reference. Model-drawn food is \"AI food slop\". Never cut food shapes out of a texture photo.",
      "Each cut food keeps its real proportions (the slice's height, width and length, its base and layers): measure them before the direction. Never squeeze a slice narrower, and never mix two flavours in one slice.",
      "Make the owner's picked food at high quality (render kind final) with the real photo as the truth reference: it removed the AI look of the low draft.",
      "No mess: no crumbs, smears, leftovers, torn cut faces, or slices pulled or set apart. Every food prompt says \"clean cut faces, no crumbs anywhere\". One crumb is a defect (D2).",
      "No prop beside food: a hand, a card, a flag or a tool that looks unreal each read as unappetising. When the idea needs a cake server, it is a real, short, recognisable steel server.",
      "A food prop that is not the brand's own food (a chilli padi, a lemon) needs a real photo of it as the reference, or it is left out. No model-drawn side food (rice).",
      "Staging: one seamless floor, no white shelf or platform; one camera and one eye line for every item; an item cut by the frame edge stays readable (not a sliver); the count in the picture matches the copy; a brand photo pasted in from another angle looks pasted.",
      "Never push a food colour past the real photo.",
    ],
  },
  {
    key: "ST",
    title: "Staging and props",
    roles: ["writer", "critic", "art-director", "main"],
    rules: [
      "Calm: one hero, 5 elements or fewer, each one earning its place. No filler prop.",
      "Props match the brand's level. No cheap or stock props.",
      "The stage is a brand-colour family first (a seamless wall and floor with one hard shadow, two colour blocks, a coloured still life). A real room only when the concept needs a place. Busy real rooms (a kopitiam, a provision shop, a delivery box of many packs) read as AI.",
      "A side cup or glass is dry and empty by default. A real serving only as D6 allows it. A subtle real filled cup as a side prop (a real tulip cup with a flat white and faint steam) only when the owner asks. Never a CG-perfect cup.",
      "Hands only when the idea needs them, never beside food, and only when the hand looks like a real camera photo.",
      "The 3 drafts of an idea differ in how the device is staged (camera, crop, scale), not only in the backdrop colour.",
      "Every prop, not only food, has a real photo of that real object as its reference, at its real size against the product and in a position a person would leave it in; without one, leave it out. A model-drawn prop is AI slop (owner, 26-11-2026, B/SKIN: a handheld fan with a stand behind its handle, then a small fan lying flat, \"ai ugly slop\").",
      "A large prop behind or beside the product (a pot, a kettle, a jar) that the model draws reads as AI at first glance, even with a real photo as its reference: the model makes it too clean and perfect (owner, 27-11-2026, PopoMama: a steel pot behind the boxes gave the whole ad \"a very strong ai image look at first glance\"). Use no prop, or put the real photo's pixels of that prop into the skeleton (product_lock.py layout) and check it at full size after the render. reprint refuses a plan with a photographed item: reprint the pack from a second plan that holds only the pack, with the same place, size and turn.",
    ],
  },
  {
    key: "RE",
    title: "Renders and prompts",
    roles: ["art-director", "main"],
    rules: [
      "No words, logo or sticker drawn by the model. Keep the headline area plain backdrop.",
      "Every prompt asks for a real photograph, honest and unposed, with no glossy CG finish, and states the product's real state. Every final prompt also says \"no glare, streak or reflection across any letter\", and \"clean cut faces, no crumbs anywhere\" when food shows.",
      "Short prompts beat long lists of rules (2,100-character prompts made the IRVINS drafts look like AI).",
      "An edit pass on a liked render (\"keep this photograph exactly; remove X\") keeps everything but X.",
      "When the owner changes a fact of a picked rough (a sealed pouch, a small portion), each draft that edits that rough starts its prompt with the change (\"Keep this photograph. Change only: the pouch is sealed; four pieces.\"). Check each draft for the change.",
      "A final that needs more than one repair is drafted again with a simpler scene.",
    ],
  },
  {
    key: "WI",
    title: "Engine v1 (wild concepts)",
    roles: ALL,
    rules: [
      "Engine v1 is batch engine 1 (owner, 23-11-2026). The old tool (han669669/ai-ad-generator) is \"old v1\", never \"v1\". Start engine 1 only on the owner's words: batch_create engine 1 with ownerStart. It makes 3 wild concepts for one brand and one product, and each concept is one picture.",
      "No words on an engine 1 picture: no headline, no subline, no footnote. Only the real kit logo. Off for engine 1: the words part of OW8 (the logo stays), CO1, CO3, all of CP, TY1 to TY4, the words parts of TY5 to TY7, TY8 and TY9, PR1 and PR2 (real size), FO3 (the high final keeps the draft instead: WI7), ST1 (the calm rule) and the checks F1, F5, F6 and F7. Every other rule stays, and D1 to D11 apply.",
      "Wild: a concept that no one else would think of, high taste, on brand (the brand's colours and world) and very pleasing to the eye. Scale is free (a giant slice, a small animal beside it). Busy is allowed when the concept needs it. The food stays appetising and true.",
      "Food truth is strict, and the real food pixels come first (owner, 25-11-2026). Do not ask the model to draw the food. Before the concepts, find real photos of this product at each camera angle that a concept may need (front, three-quarter, side, top, cut face, back): the brand's site, its one-piece stills and lifestyle pages, retailer listings and public photos of buyers. Write in the batch notes which angles have a real photo, with the ref key of each. Before each draft, name the food's camera angle. When a real photo at that angle exists, lock it: the product lock (scripts/product_lock.py cutout, with --alpha for a cake, then layout; creative-playbook §7.4 A) puts its real pixels into the skeleton at any size, and that skeleton is the only reference of the draft. When an extra must show through the food (cat ears that peek out behind a cake, a paw, a prop), the lock leaves a hole: the plan's holes keep those pixels as backdrop. The model keeps every locked food pixel and invents only the extras and the light, in the holes and around the food. When no real photo shows the food at that angle, render nothing: change the food's angle (the extras can stay) or wait for a new real photo from the owner. Never guess a top, a back or a cut face from a front packshot (no 3D model, depth warp or turned packshot). After the render, compare the food with the locked photo (D2); never swap the whole packshot over the extras.",
      "References: look outside the category (editorial, art, fashion, still life) with exa_search, read the links that fit, and name the reference each concept takes from. No mood-board file.",
      "Process: the writer makes 6 to 10 concepts (ideas_save: headline is the concept name, visual is the picture, insight is why it fits the brand; format tof). A fresh critic picks 3 blind with ideas_pick, in any mix. No stop for the owner at the concepts and no copy review: copyApproved is not needed. A note for the critic, not a gate for the writer: an animal earns its place when it adds meaning to the concept.",
      "Pictures: one low draft for each picked concept (render_submit kind draft, numImages 1) from its food lock (WI4), with the kit logo set. Redo a failed draft once. The owner gives a verdict on each draft. A draft he chooses is the final as it is, unless WI18 calls for a high final (final_render). Then a touch-up (region_fix, food_fix) where it is needed, then the logo. Craft checks on the pictures only, never limits on the concepts (batch c1a43bcc, 23-11-2026): the high final is a light touch that keeps the draft's photograph and never makes the food more perfect than the draft: finalRefs stay empty and the final prompt never asks the model to redraw the food (a \"change only the food\" final looked \"more perfect and ai looking\"); when a final is worse than its draft, also show him the finished draft. Before you show a final, check hard shadows and edges at full size for stepped or pixelated lines. Show the food only from camera angles that the brand's real photos show (tops drawn from an unseen top-down angle looked fake). A pack only when he asks for one; the Meta text only at the pack step.",
      "Logo: set the real kit logo in code at the kit place by default (scripts/headline.py --logo with no --headline). When a painted logo is better for the concept (on the brand's own box or wall), the model may paint it: then RE1 and the code part of D7 do not apply, and the painted logo must match the real logo letter by letter (D7).",
      "Animals and figures are allowed. Each must pass the first-glance test (LI1) with real fur, eyes and face (the cat head of 23-11-2026 looked AI). An animal is cute by default; the concept may call for another look (owner, 23-11-2026: \"it could also be not cute depending on the concept\"). A touch-up fixes only the AI texture (airbrushed fur, CG eyes) and keeps the face, eye size and expression the owner chose (the realistic cat was \"no longer cute\"; he approved the light touch). No human faces.",
      "Engine 1 verdicts teach engine 1 only: do not move them into the engine 2 or 3 canon (canon_update). taste_log names the engine of each pick and verdict: read an engine 1 row only for engine 1. No gold score for engine 1.",
      "First glance, no lore (owner, 28-11-2026, Durian Delivery batch): a concept must read from the picture alone, with no caption, story or local lore. The critic tests this first and drops a concept that needs an explanation (a civet's shadow and a harvest moon: \"doesn't register in my brain at all purely from looking\"). Also drop the product alone on a plain podium or pedestal (\"very basic\"). Framing is free: mix close-ups and wide scenes (\"sometimes yes sometimes no\").",
      "A brand photo whose food stands on a board, a plate or a table: before the lock, cut the food out with scripts/product_lock.py cutout-scene (--surface patches of the board teach GrabCut its colour) and check the mask at full size over the photo, unless the concept needs that surface. A surface the concept does not need is a distraction (owner, 28-11-2026: \"the wooden board below seems a distraction\").",
      "Depth comes from the lock: to give food more depth (a lower light, longer shadows, a contact shadow), make a new draft from the lock skeleton with that light in the prompt. On engine 1 an edit pass of a draft only removes or adds a thing: an edit pass that asked for depth redrew the pods (owner, 28-11-2026: the cutout looked \"flat as if its a 2d product\"; the new draft from the lock had \"depth\" and was approved).",
      "Real scene, real pixels (owner, 28-11-2026, Durian gallery ad): a wide scene (a gallery, a street, a crowd) may start from a real photo of that scene with a free licence as the skeleton (its link in the batch notes), and a prop from a real photo's pixels in the skeleton; both came back real. After the render, keep the real photo and take from the render only the areas that had to change, with scripts/patch_merge.py (--box, --ellipse): a model pass over the whole crowd made \"odd looking weird heads\". When patch_merge says that the render moved the composition, render again with \"keep the exact composition\".",
      "People and depth order: no model-drawn hands or fingers (\"the fingers looks weird\"): hide a hand behind a nearer object, or keep the real photo's hand. A blurred near object always covers the things behind it: never draw a held object over a nearer head (\"the bottom of the phone is cutting into the skull\"). On engine 1 either fault counts as a D item. Faces stay turned away (WI9).",
      "A screen in the picture (a phone, a tablet) shows what it really sees: build its picture in code from the scene itself (a crop from the right place, the soft focus of the screen, the phone's real bars and buttons), never with the model (the owner liked the phone preview made this way).",
      "Every draft and final prompt says \"keep the exact composition; the top fifth stays plain\" (for the kit logo's place), or the model moves objects into the logo area (the gilt frame moved up into it).",
      "A draft can be the finished picture. After his verdict, show him the finished draft as the final; make a high final only when he asks for one, or when the draft has a fault that only a new render can fix (in both engine 1 batches to 28-11-2026 the low draft was better than the high final). When he approves a draft as it is, save his words with batch_update ownerVerdicts stage 'final', mark 'approve' and the draft's key (owner, 28-11-2026: \"no final render needed\"). A client pack takes only a final render: when he asks for a pack with such a draft, make its light-touch high final first (WI7) and show it to him.",
    ],
  },
];

const defects = () =>
  `## CH. Defects (the codes of checks_save)\nOne D item, or two F items, rejects a draft or a final. Kill an idea that needs one to work.\n${CHECK_CODES.map(([c, t]) => `- ${c}: ${t}`).join("\n")}`;

const HEAD =
  "# The owner's house rules\nThe owner (Han, a11 Studio) settled these in his batch reviews. Every agent follows them, with or without the a11 plugin. canon_get (his learned taste) and taste_log (his picks and words) add to them; what he says in this session wins. The evidence and the how-to are in docs/creative-playbook.md and docs/render-checklist.md of the public GitHub repo han669669/a11-adgen (background only: you need no checkout, and finish_kit gives the scripts). Send the rulesVersion with ideas_save, direction_save, render_submit, final_render and checks_save.";

function render(sections: readonly Section[], withDefects: boolean): string {
  const body = sections.map((s) => `## ${s.key}. ${s.title}\n${s.rules.map((r, i) => `- ${s.key}${i + 1}: ${r}`).join("\n")}`);
  return [HEAD, ...body, ...(withDefects ? [defects()] : [])].join("\n\n");
}

/** FNV-1a, 32 bits: a short stable tag that changes with any change of the text. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const HOUSE_RULES = render(SECTIONS, true);
/** A hash of every rule and of which roles get each section, so a change to either makes each agent read the rules again. */
export const RULES_VERSION = fnv1a(JSON.stringify(SECTIONS.map((x) => [x.key, x.roles])) + HOUSE_RULES);

/** The rules for one role (every section that names it, and the defect list), or all of them. */
export function houseRules(role?: RuleRole): { rulesVersion: string; role: RuleRole | "all"; rules: string } {
  if (!role) return { rulesVersion: RULES_VERSION, role: "all", rules: HOUSE_RULES };
  return { rulesVersion: RULES_VERSION, role, rules: render(SECTIONS.filter((s) => s.roles.includes(role)), true) };
}

/** The tools that act on the owner's taste: each one refuses a call without the current rulesVersion. */
export const RULES_GATED = new Set(["ideas_save", "direction_save", "render_submit", "final_render", "checks_save"]);

/** Null when the call may go on, else the refusal text. */
export function rulesGate(tool: string, args: unknown): string | null {
  if (!RULES_GATED.has(tool)) return null;
  const v = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>).rulesVersion : undefined;
  if (v === RULES_VERSION) return null;
  return v === undefined || v === null || v === ""
    ? `${tool} needs rulesVersion. Call rules_get first (free), read the owner's house rules and follow them, then send its rulesVersion with this call.`
    : `The owner's house rules changed since you read them. Call rules_get again (free), read the new rules, then send the new rulesVersion with this call.`;
}
