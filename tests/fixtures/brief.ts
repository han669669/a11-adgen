/**
 * The example brief of design pack §1.11: a fictional brand. The brand, product, quotes and URLs are invented.
 * Source ids are fixed so a test can store the matching research_sources rows.
 */
export const SRC = {
  about: "50000000-0000-4000-8000-000000000001",
  review1: "50000000-0000-4000-8000-000000000002",
  forum: "50000000-0000-4000-8000-000000000003",
  review2: "50000000-0000-4000-8000-000000000004",
  competitor: "50000000-0000-4000-8000-000000000005",
  curly: "50000000-0000-4000-8000-000000000006",
};

/** The stored text of each source: each contains its quote, among other words. */
export const SOURCES: { id: string; url: string; text: string }[] = [
  { id: SRC.about, url: "https://example.com/about", text: "Our story. Everything is baked in small batches in our Singapore kitchen, every Tuesday." },
  { id: SRC.review1, url: "https://example.com/reviews/1", text: "5 stars. Bought it for breakfast but I keep eating it straight from the bag at night. Oops." },
  { id: SRC.forum, url: "https://example.org/forum/thread-9", text: "re: granola. Supposed to last two weeks.   Gone in four days, mostly after dinner lol" },
  { id: SRC.review2, url: "https://example.net/reviews/2", text: "The big chunks are the best part, the crumbs not so much." },
  { id: SRC.competitor, url: "https://example.com/competitor", text: "Our granola. Pour. Top. Enjoy." },
  // Curly quotes, an en dash and a line break inside the quote.
  { id: SRC.curly, url: "https://example.org/blog", text: "She said “it’s not\nbreakfast – it’s a lifestyle” and laughed." },
];

export function exampleBrief(subjectId: string, factIds: string[]) {
  return {
    brand: {
      name: "Pasar Pantry",
      category: "packaged breakfast food",
      positioning: { text: "Granola with local flavours, baked in small batches in Singapore.", basis: "evidence", evidenceIds: ["e1"] },
    },
    product: { subjectId, name: "Gula Melaka Granola", variant: "300 g pouch" },
    productFacts: { factIds },
    productTruth: {
      shape: "Flat-bottom pouch, about 2:3, matt kraft face, round window low on the front.",
      texture: "Uneven clusters, 1 to 3 cm, dark gold, visible coconut flakes.",
      packaging: "Printed front label; the top fold is visible.",
      realAppearance: "Clusters break into crumbs at the bottom of the pouch.",
      referenceKeys: ["kits/pasar-pantry/product-front.png"],
    },
    buyer: { text: "Adults who buy granola for weekday breakfasts and eat it at other times.", basis: "interpretation", evidenceIds: ["e2", "e3"], confidence: "medium" },
    buyerInsights: [
      {
        id: "i1",
        text: "People buy it for breakfast and finish it as a late snack from the pouch.",
        tension: "The plan was a healthy morning. The fact is a hand in the pouch at 11 pm.",
        basis: "evidence",
        evidenceIds: ["e2", "e3"],
        confidence: "high",
        market: "SG",
      },
      {
        id: "i2",
        text: "People pick out the big clusters first and leave the crumbs.",
        tension: "Everybody in the home wants the same pieces.",
        basis: "interpretation",
        evidenceIds: ["e4"],
        confidence: "low",
        market: "unknown",
      },
    ],
    categoryConventions: [{ text: "Competitor ads show a bowl with milk and fruit from above.", basis: "evidence", evidenceIds: ["e5"] }],
    categoryOpportunities: [{ text: "No competitor shows granola eaten from the pouch.", basis: "hypothesis", evidenceIds: [], confidence: "low" }],
    brandIdentity: { kitSlug: "pasar-pantry", voice: "Dry, warm, short.", personality: "A neighbour who bakes." },
    commercialObjective: { text: "Practice batch: one ad good enough to win a real client.", source: "default", basis: "hypothesis" },
    constraints: {
      claims: ['No health claim. "Less sugar" is not in the facts.'],
      cultural: ["No race or religion in copy."],
      product: ["The pouch window must show real clusters."],
      visual: ["No bowl-from-above scene."],
    },
    evidence: [
      { id: "e1", sourceId: SRC.about, sourceType: "brand_site", quote: "baked in small batches in our Singapore kitchen", speaker: "brand", market: "SG" },
      { id: "e2", sourceId: SRC.review1, sourceType: "public_review", quote: "bought it for breakfast but i keep eating it straight from the bag at night", speaker: "buyer", market: "SG" },
      { id: "e3", sourceId: SRC.forum, sourceType: "forum", quote: "supposed to last two weeks. gone in four days, mostly after dinner", speaker: "buyer", market: "SG" },
      { id: "e4", sourceId: SRC.review2, sourceType: "public_review", quote: "the big chunks are the best part", speaker: "buyer", market: "unknown" },
      { id: "e5", sourceId: SRC.competitor, sourceType: "competitor_site", quote: "Pour. Top. Enjoy.", speaker: "competitor", market: "SG" },
    ],
    unknowns: [
      { field: "productFacts", question: "Is there a launch offer?", whyItMatters: "A bottom-of-funnel ad needs a real reason to buy now.", howToResolve: "owner" },
      { field: "buyer", question: "Who buys it: the eater or a parent?", whyItMatters: "It changes who the headline speaks to.", howToResolve: "client" },
    ],
  };
}
