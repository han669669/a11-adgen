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
      "Report in short simple sentences, result first. 'Usable' is not his bar: his bar is an ad he would pay for out of his own pocket and be proud of, beside his 5 reference ads (Moom, Allies of Skin x2, Oatside x2). Never say an ad passed that test unless he said so.",
      "Offer at most one other headline or subline, marked as an option. His own words win.",
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
    ],
  },
  {
    key: "PR",
    title: "Product truth and scale",
    roles: ALL,
    rules: [
      "The product matches the real one in every dimension. Before the first image, find its real height and width (the product page, a retailer's listing, the brand's photo of it beside its carton or in a hand) and save them with the source in the kit notes. The size guide is the brand's own photos, never an earlier render.",
      "Give scale through things in the picture (\"the pot rim level with the bottle's shoulder\"): the model ignores centimetres. A prop of unknown size is never the ruler; never shrink the product to a guessed prop size. Show true-scale cues where scale reads (a fridge so wide that its far side runs out of the frame; subway tiles and a worktop edge at true size).",
      "Measure every draft and every final again: the shape against the packshot (scripts/pack_check.py, 2%), the cap on the body centre within 1% of its width (scripts/cap_check.py), and every printed word against the packshot (the net weight, TM against R). Fix wrong small print with a local patch from the packshot, not a new render.",
      "A pack is handled as a real one can be: a pouch folds at most once, above its print, and nothing covers the brand name, the logo or the product name. A box reads as a plain box with four sides.",
      "A packshot that is a flat or 3D mock-up is rebuilt as a real object in the final (a carton: light across the front, rounded paperboard edges, creased ears, a matte cap; a pouch: pillowy film, creases, foil in the open mouth, a contact shadow). Do not paste the mock-up print back over it.",
      "Multiples never look cloned: no identical packs at equal gaps. Small turns, uneven gaps, one lying or leaning, as a person would put them down. Back packs recede (shadow, soft focus) and never take the light from the hero.",
    ],
  },
  {
    key: "LI",
    title: "Light, camera and the first glance",
    roles: ["art-director", "critic", "main"],
    rules: [
      "First-glance test: the picture looks photographed by a real camera at that exact angle. If it reads as an AI image at first glance, it fails, whatever else is right.",
      "The product takes the scene's light: the highlight on the light's side, the shade on the far side, the scene seen in a glossy surface, a contact shadow that agrees with the other shadows (D10). A glossy or rounded product (a bottle, a tube, a glossy jar) gets the brand's real photo as a reference only: no skeleton paste and no reprint.",
      "No glare, streak or reflection across any printed letter: the print stays legible at phone size (D11).",
      "More control gives more AI look. Prefer a simple scene of few large real objects. When the owner picked a concept from its rough, make the drafts from that rough with a short prompt (under about 900 characters).",
      "Run the real-camera finish (scripts/photo_finish.py) on drafts and finals: subtle, tuned by eye; hold a brand colour exact with --keep.",
      "What won his eye: a bright light reflecting on a prop, depth of field, real shadows and legible print, \"scroll stopping but not in your face\".",
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
      "A final that needs more than one repair is drafted again with a simpler scene.",
    ],
  },
];

const defects = () =>
  `## CH. Defects (the codes of checks_save)\nOne D item, or two F items, rejects a draft or a final. Kill an idea that needs one to work.\n${CHECK_CODES.map(([c, t]) => `- ${c}: ${t}`).join("\n")}`;

const HEAD =
  "# The owner's house rules\nThe owner (Han, a11 Studio) settled these in his batch reviews. Every agent follows them, with or without the a11 plugin. canon_get (his learned taste) and taste_log (his picks and words) add to them; what he says in this session wins. The evidence and the how-to are in docs/creative-playbook.md and docs/render-checklist.md of the a11-adgen repo. Send the rulesVersion with ideas_save, direction_save, render_submit, final_render and checks_save.";

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
