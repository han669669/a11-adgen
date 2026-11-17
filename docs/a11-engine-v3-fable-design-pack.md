# a11-engine v3: design pack for Phases 1 to 4

This document uses ASD-STE100 Simplified Technical English with British spelling. Code, commands, paths and field names are not changed.

- **Status:** design only. Nothing in this file is built. No runtime code, test, migration, plugin file, script, D1 row or deployment was changed to write it.
- **Specification:** `docs/a11-engine-v3.md` (the owner's text, kept verbatim). Section marks such as "v3 §5.2" point to it.
- **Audit:** `docs/a11-engine-v3-phase-0.md`. File and line references are true for commit `860eb9f`. Marks such as "P0 §6" point to it.
- **Next reader:** the implementation session. Start with `docs/a11-engine-v3-opus-kickoff.md`.
- **Priority:** Phase 1 is the most complete, then 2, then 3, then 4.

Words used in this file:

| Word | Meaning |
|---|---|
| Engine 2 | The batch flow that is live today: 20 to 30 ideas, one pick per funnel stage. |
| Engine 3 | The v3 batch flow of this design. |
| Record | One row of the new table `batch_records` (section 0.2). Records are added, never changed. |
| Main session | The Claude Code session that runs the batch prompt. |
| Shape check | The server refuses input that has the wrong structure. It is not a taste rule. |

---

## 0. Design that all four phases share

### 0.1 Principles

1. **The server is the hands. Claude Code is the brain.** A new tool saves and returns data. It does not judge taste. Taste stays in words: the playbook, the canon and the subagent files (v3 §6.3, `AGENTS.md` rule budget of 15 hard checks).
2. **Additive.** Engine 2 batches, their ideas, picks, verdicts, packs and results stay readable and unchanged. No row is rewritten.
3. **One live migration for Phases 1 to 4**, so that the owner approves one database change. It is live before the code that needs it. The code of each unit works before and after it where this document says so.
4. **Everything that a later session needs is in D1.** A batch can stop after any step and a new session can continue it from `batch_get` (v3 §11.2).
5. **The owner's rules stay.** Section 0.6 lists the lessons that no phase may weaken.
6. **No claim without a measurement.** No part of this design says that engine 3 makes better ads. Phase 7 measures that.

### 0.2 Migration 0015 (one file, one owner approval)

File: `migrations/0015_engine_v3.sql`. The implementation session writes it, tests it on the preview D1 and asks the owner for the live run. Contents:

**A. Pick limit: 3 for each batch for engine 3; 1 for each stage stays for engine 2.** The SQL is in P0 §6.4. It drops `ideas_pick_limit_insert` and `ideas_pick_limit_update` (`migrations/0004_funnel.sql:29-41`) and creates `ideas_pick_cap_insert` and `ideas_pick_cap_update`, which read `batches.engine`. Part C (the engine column) must come before part A in the file. Before the live run, read the live trigger text (P0 U3).

**B. Concept data on an idea.**

```sql
ALTER TABLE ideas ADD COLUMN concept TEXT NOT NULL DEFAULT '{}';
```

**C. Engine mark on a batch.**

```sql
ALTER TABLE batches ADD COLUMN engine INTEGER NOT NULL DEFAULT 2;
```

Every batch that exists gets 2. `batch_create` writes 3 after the engine 3 code is live. The server uses this mark to choose the pick rule and the board gate.

**D. Research sources.**

```sql
CREATE TABLE research_sources (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  published_date TEXT,
  retrieved_at TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('search', 'contents')),
  query TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX research_sources_once ON research_sources (batch_id, url, via);
```

**E. Batch records (append only).**

```sql
CREATE TABLE batch_records (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES batches(id),
  kind TEXT NOT NULL CHECK (kind IN
    ('brief', 'territories', 'concept_review', 'direction', 'draft_check', 'final_check', 'rank_context')),
  idea_id TEXT,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL CHECK (author IN ('main', 'writer', 'critic', 'art-director', 'owner', 'server')),
  prompt_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (idea_id, batch_id) REFERENCES ideas(id, batch_id)   -- the same composite key as picks, draft_ranks and verdicts
);
CREATE UNIQUE INDEX batch_records_version ON batch_records (batch_id, kind, IFNULL(idea_id, ''), version);
CREATE INDEX batch_records_read ON batch_records (batch_id, kind, created_at);
```

The composite key makes sure that the idea of a record is an idea of the same batch. A record with no idea (`idea_id` NULL) is not checked by it, as SQLite skips a foreign key with a NULL part.

**F. Fact check mark.**

```sql
ALTER TABLE facts ADD COLUMN verified INTEGER;   -- NULL: not checked (every row that exists). 1: the quote is in the stored source. 0: it is not.
```

**G. Calibration runs (Phase 4).**

```sql
CREATE TABLE calibration_runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('triplet_replay', 'final_replay', 'concept_stability')),
  as_of TEXT NOT NULL,
  split TEXT NOT NULL CHECK (split IN ('tuning', 'holdout', 'all')),
  canon_log_id TEXT,
  prompt_version TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL,
  result TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
```

Notes for the implementation session:

- Follow the style of the 14 migrations that exist (ids, date format, `STRICT` if the others use it). The SQL above shows the design, not the final text.
- `tests/migrations.test.ts:9-41` tests the old triggers. Change that test in the same pull request as the migration file.
- **Alternative that was considered:** one typed table for each record kind. It gives stronger column checks and six more tables. The one-table design was chosen because each kind is read whole, by batch, and is never joined on a field of its body. The implementation session may choose typed tables if it finds a query that needs them. It must say so in the pull request.
- **Order:** the migration is safe to run while engine 2 code is live. `ideasPick` (`worker/batch.ts:267-277`) does not check the stage; the D1 triggers are the only guard of the one-per-stage limit. So the new triggers keep that limit for every batch with `engine = 2` (P0 §6.4), and every batch that exists gets `engine = 2`. Test this in `tests/migrations.test.ts`: after the migration, a second pick in one stage of an engine 2 batch is still refused.
- **Rollback:** a new migration that drops the new triggers and creates the two old triggers again. A trigger checks only new writes, so rows that exist stay as they are. The new columns and tables stay; they do no harm. The code rollback is a revert pull request.
- **Never** run migration 0014 or its backfill again.

### 0.3 Next step from the server (no new status values)

`batches.status` has a CHECK list. A new value needs a table rebuild. Engine 3 adds no status value. The fine state comes from the saved records.

`batch_get` returns a new field `nextStep` for engine 3 batches. The server derives it. It is advice for the main session, not a gate.

| Order | Condition (first that is true) | `nextStep` |
|---|---|---|
| 1 | No brief record | `brief` |
| 2 | No ideas | `concepts` |
| 3 | Latest concept review has `outcome: "rework"` and no idea is newer than it | `concepts_rework` |
| 4 | Fewer than 3 picked ideas | `concept_review` |
| 5 | A picked idea has no `copyApproved` | `copy_review` |
| 6 | A picked idea has no direction record | `direction` |
| 7 | A picked idea has fewer than 3 eligible drafts (see 3.6) | `drafts` |
| 8 | A picked idea has drafts with no rank | `draft_rank` |
| 9 | Status is not `board` and later | `board` |
| 10 | A picked idea has no owner pick and no full pass | `owner_pick` |
| 11 | An owner pick has no final with a final check | `finals` |
| 12 | Otherwise | `done` |

The gates that exist stay as gates: copy approval before a render (`worker/mcp.ts:827`), the board gate (`worker/batch.ts:141-150`), the owner pick before a final.

### 0.4 Hard checks and shape checks

The record says: at most 15 hard checks in code. This design adds **no** hard taste check. It adds shape checks (wrong type, missing field, wrong count) and one gate change in unit 0 (`render_submit` refuses a draft for an idea that is not picked). Before each unit, count the hard checks that exist against `docs/decisions.md`. If a unit would go over 15, stop and ask the owner.

### 0.5 Version stamps

Every record has `prompt_version`. The subagent passes the plugin version (today `0.2.9`). `drafts_rank` and the concept review also save the id of the latest canon log row. Phase 4 groups its numbers by these stamps.

### 0.6 Owner lessons that every phase keeps

| Lesson | Where it lives today | Effect on this design |
|---|---|---|
| Copy length: headline usually 6 words or fewer, never more than 8; subline 8 or fewer; total 14 or fewer. The owner's own words can go over. | Playbook, canon | Writer contract 2.4. The critic reports length. No new code check. |
| Copy review before any render (`copyApproved`, owner's exact words) | `worker/batch.ts:252-265`, `worker/mcp.ts:827` | Stays between concept selection and direction (2.7, conflict C2). |
| Headline in a brand font that is not the logo's font | Playbook §7.6 | Direction record has `type.headlineFont` and `type.reason` (3.3). |
| Logo optically centred | `scripts/headline.py`, PR #87 | Final check item (3.6). |
| Real pack print is put back (reprint); the fold line stays | `scripts/product_lock.py reprint` | Untouched. Draft check item. |
| A mock-up pack is rebuilt as real in the prompt; reprint only small wrong areas | Playbook §7.4 | Draft prompt structure 3.5. |
| Back products recede (shadow, soft focus) | Playbook | Direction field `hierarchy`; draft check item. |
| `photo_finish` standard | `scripts/photo_finish.py`, playbook §7.7 | Untouched. |
| One hero pack on a calm surface beats a busy scene | Canon, 16-11-2026 | Calm rules in 3.4 (conflict C5). |
| The owner picks drafts. The agent never picks for him. He does not see the rank first. | MCP instructions | 4.3 makes the server hold the rank. |

---

## 1. Phase 1: strategic intelligence and the Creative Strategy Brief

### 1.1 Current behaviour

- Research: `exa_search` and `exa_contents` (`worker/mcp.ts:67-98`, `worker/exa.ts:31-75`) return results to the session. The server stores nothing.
- Insights: `batch_update insights` saves a flat list in `batches.insights` (`worker/mcp.ts:279-292`). Each item has text, a quote and a URL that the agent typed. The server does not know if the quote is real.
- Facts: `facts_save` saves product facts for a subject (`worker/batch.ts:43-55`). Facts have a source URL and a quote that the agent typed. The server checks only that the subject exists. It does not check the quote. So a row in `facts` is "the agent says it is verified", not "verified". No retrieval date is returned.
- There is no place for the buyer, the category, the objective, the constraints or the unknowns. There is no difference between evidence, interpretation and hypothesis.
- The writer reads the insights through `batch_get`. The critic reads the same view, which also has the main session's notes (`worker/batch.ts:512`).

### 1.2 Desired behaviour

1. The main session does research with the Exa tools and gives the batch id. The server stores each result as a research source.
2. The main session writes a brief with the 13 fields of v3 §4.1 and saves it with `brief_save`.
3. Each claim in the brief has a basis: evidence, interpretation or hypothesis. Evidence has an exact quote from a stored source.
4. The server checks each quote against the stored text and marks it `verified: true` or `false`. This is a mark, not a refusal.
5. What the engine cannot verify goes into `unknowns`. It is not filled with a guess.
6. The brief has a version. A new save makes a new version. Old versions stay.
7. `batch_get` returns the latest brief to the main session, the writer and the critic.
8. A new session can read the brief and continue.

### 1.3 Data structures

**Brief** (the `body` of a record with `kind: "brief"`, `idea_id` NULL, author `main`):

```json
{
  "brand": { "name": "", "category": "", "positioning": { "text": "", "basis": "evidence", "evidenceIds": ["e1"] } },
  "product": { "subjectId": "", "name": "", "variant": "" },
  "productFacts": { "factIds": ["..."], "note": "Read from the facts table. Not copied." },
  "productTruth": { "shape": "", "texture": "", "packaging": "", "realAppearance": "", "referenceKeys": ["..."] },
  "buyer": { "text": "", "basis": "interpretation", "evidenceIds": ["e2", "e3"], "confidence": "medium" },
  "buyerInsights": [
    { "id": "i1", "text": "", "tension": "", "basis": "evidence", "evidenceIds": ["e2"], "confidence": "high", "market": "SG" }
  ],
  "categoryConventions": [ { "text": "", "basis": "evidence", "evidenceIds": ["e5"] } ],
  "categoryOpportunities": [ { "text": "", "basis": "hypothesis", "evidenceIds": [], "confidence": "low" } ],
  "brandIdentity": { "kitSlug": "", "voice": "", "personality": "", "note": "Assets come from the brand kit." },
  "commercialObjective": { "text": "", "source": "owner | client | default", "basis": "hypothesis" },
  "constraints": { "claims": [""], "cultural": [""], "product": [""], "visual": [""] },
  "evidence": [
    {
      "id": "e1",
      "sourceId": "",
      "url": "https://...",
      "sourceType": "product_page",
      "quote": "",
      "retrievedAt": "",
      "publishedDate": null,
      "speaker": "brand",
      "market": "SG",
      "verified": true
    }
  ],
  "unknowns": [
    { "field": "commercialObjective", "question": "", "whyItMatters": "", "howToResolve": "owner" }
  ]
}
```

Field rules:

| Field | Rule |
|---|---|
| `basis` | `evidence`: the text says what a source says. `interpretation`: a reasonable reading of evidence; it needs at least one evidence id. `hypothesis`: not supported; evidence ids can be empty. |
| `confidence` | `high`: direct evidence from 2 or more different domains. `medium`: direct evidence from 1 domain. `low`: interpretation or hypothesis only. The main session sets it; the server does not compute it. |
| `evidence[].sourceType` | One of `brand_site`, `product_page`, `retailer_listing`, `public_review`, `forum`, `social_public`, `news_media`, `competitor_site`, `ad_library_public`, `owner_supplied`, `client_supplied`. |
| `evidence[].quote` | Exact words from the source, 600 characters or fewer. Not a summary. |
| `evidence[].speaker` | `buyer`, `brand`, `competitor`, `press` or `unknown`. Only `buyer` evidence can support a buyer insight with basis `evidence`. |
| `evidence[].market` | `SG`, `non-SG` or `unknown`. A buyer insight with `market: "SG"` needs at least one evidence item with `market: "SG"`. If it has none, its basis is `hypothesis`. |
| `evidence[].verified` | The server sets it (1.4). The input value is ignored. |
| `evidence[].retrievedAt`, `publishedDate` | The server copies them from the research source when `sourceId` is given. |
| `productFacts` | Only ids of rows in `facts`. A price, size, offer or certification that is not in `facts` is an unknown. A fact whose `verified` mark is not 1 (see 1.4) is shown as not verified to the writer, the critic and the owner; it must not be used as a factual claim in copy until its quote is found in a stored source, or the owner approves that copy at the copy review after he saw the "not verified" mark. That approval is saved as today: `ideas_update copyApproved` keeps his exact words for that idea. It does not change `facts.verified`, which records only the server's quote check. |
| `commercialObjective.source` | `default` means that nobody stated an objective. The default text is "practice batch: one ad good enough to win a real client". It is marked as a hypothesis. |
| `unknowns[].howToResolve` | `owner`, `client` or `public_research`. |

Size limits (shape checks): 12 buyer insights, 40 evidence items, 20 unknowns, 2,000 characters for each text.

Private data: `owner_supplied` and `client_supplied` evidence has no public URL. The quote is what the owner or the client wrote. The brief never calls public research "customer data" (v3 Phase 1 acceptance). Customer voice from private data is excluded (v3 §9.6).

### 1.4 Research sources and the quote check

- `exa_search` and `exa_contents` get an optional `batchId`. With it, the server writes one `research_sources` row for each result: URL, title, published date from Exa, the time of the call, the query, and the returned text (cut at 20,000 characters). The same URL through the same tool is stored once for a batch (the unique index); a later call updates nothing.
- The tools return the new `sourceId` with each result.
- Without `batchId`, the tools work as today.
- **Quote check in `brief_save`:** for each evidence item with a `sourceId`, the server normalises the quote and the stored text (lower case, all white space to one space, curly quotes to straight quotes, dashes to one form) and sets `verified` to true if the quote is in the text. An item with no `sourceId` gets `verified: false`, except `owner_supplied` and `client_supplied`, which get `verified: null`.
- `brief_save` returns the list of items that are not verified. The main session then corrects the quote, fetches the page with `exa_contents`, or changes the basis of what depends on it.
- **The same check for facts.** `facts_save` gets an optional `batchId`. With it, the server looks for each fact's quote in the stored source text of that batch with the same URL, with the same normalisation, and writes `facts.verified` (1 or 0). Without `batchId`, or when the page is not stored, the mark stays NULL (not checked). The batch prompt tells the main session to fetch the product page with `exa_contents` and `batchId` before `facts_save`. `brief_save` gives a warning for each fact id in `productFacts` whose mark is not 1. The copy review text marks a subline with `sublineBasis.kind: "fact"` whose fact is not verified, so the owner sees it before he approves. This is a mark and a warning, not a refusal (OD 1.1 covers both checks). Old facts have NULL and are treated as not checked.
- The check proves that the words are on the page. It does not prove that the page is true.
- Storage: about 40 sources for a batch at 20,000 characters is under 1 MB for a batch. Recheck the D1 limits first (P0 U4).

### 1.5 MCP tools

| Tool | Change | Input | Output |
|---|---|---|---|
| `exa_search`, `exa_contents` | EXTEND | Add optional `batchId` | Add `sourceId` to each result |
| `brief_save` | NEW | `batchId`, `brief` (1.3), `promptVersion` | `version`, `unverified[]` (evidence ids), `warnings[]` |
| `batch_get` | EXTEND | No change | Add `brief` (latest body and version), `sources` (id, URL, title, dates; no text), `nextStep` |
| `facts_save` and the facts in `batch_get` | EXTEND | Add optional `batchId` (quote check, 1.4) | Add `retrievedAt` (the row's `created_at`) and `verified` (true, false or null) |
| `batch_update insights` | KEEP | No change | Engine 2 batches use it. Engine 3 batches do not need it. |

`brief_save` warnings (not refusals): an insight with basis `evidence` and no verified evidence; an SG insight with no SG evidence; a buyer insight with basis `evidence` whose evidence has no `buyer` speaker; `confidence: "high"` with evidence from one domain.

`brief_save` refusals (shape checks only): unknown batch; wrong types; an evidence id that is not in the evidence list; a fact id that is not a fact of the batch's subject; over a size limit.

A new tool without a test fails CI (`tests/mcp.test.ts`). Add the tool, its test and its line in the MCP instructions (`worker/mcp.ts:30-31`) in one pull request.

### 1.6 Prompt contract for the brief step

This text goes into the batch prompt (`worker/prompts.ts:57`) in place of the insight step, for engine 3 batches. It is a contract, not final wording.

```
BRIEF. Before any idea, build the Creative Strategy Brief and save it with brief_save.
1. Read brand_get and the subject's facts. These are the product facts. Do not copy them. Give their ids.
2. Research with exa_search and exa_contents. Give batchId in every call. Look for what buyers say and do:
   public reviews, forums, public social posts, retailer listings, competitor sites, public ads.
   Prefer Singapore sources. Say when a source is not from Singapore.
3. For each thing you learn, decide its basis:
   evidence = a source says it. Copy the exact words. Do not tidy them.
   interpretation = your reading of one or more quotes. Name the quotes.
   hypothesis = you think it is likely. You have no quote.
   Never write an interpretation as a quote. Never give a buyer words that a brand wrote.
4. A buyer insight is a behaviour or a tension that a person would recognise.
   "Busy professionals who want convenient premium snacks" is not an insight.
5. What you cannot verify is an unknown. Write the question, why it matters and who can answer it.
   Do not fill it. A price, size, offer, ingredient, certificate, health benefit, delivery term,
   guarantee or customer number that is not in the facts is an unknown.
6. Save. Read the unverified list. Correct each item or lower the basis of what depends on it. Save again.
7. Tell the owner, in 5 lines or fewer: the 3 strongest insights with their basis, and the unknowns that he can answer.
   Do not stop for his answer unless an unknown blocks a claim that the ads need.
```

### 1.7 Agent responsibilities

| Agent | Phase 1 responsibility |
|---|---|
| Main session | Research, the brief, the saves, the report to the owner. |
| Writer | Reads the brief. Uses only insights from it. Names the insight id and the evidence ids in each concept (Phase 2). |
| Critic | Reads the brief. Judges "is the buyer insight credible" from basis, confidence and quotes (Phase 2). |
| Art director | Reads `productTruth` and `constraints.visual` (Phase 3). |
| Server | Stores sources, checks quotes, keeps versions. |

### 1.8 State transitions

`batch_create` (engine 3) → research → `brief_save` v1 → optional corrections → `brief_save` v2 … → concepts. `nextStep` is `brief` until a brief record exists. A new brief version after concepts exist does not delete the concepts. Each concept stores the `briefVersion` that it was written from, so a later reader can see a stale concept.

### 1.9 Failure handling

| Failure | Behaviour |
|---|---|
| Exa call fails or the spend cap refuses it | As today. No source row. The brief can still be saved; what is not supported is a hypothesis or an unknown. |
| Source storage fails | The Exa result still returns. The result has `sourceId: null` and a warning. Research is not blocked by storage. |
| A quote is not found | `verified: false` and a place in `unverified[]`. No refusal. |
| The page text was cut at 20,000 characters and the quote is after the cut | The quote shows as not verified. The main session calls `exa_contents` for the page with a narrower request, or keeps the item as not verified. |
| Two sessions save at the same time | The unique index on (batch, kind, idea, version) makes one save fail. The server tries once more with the next version number. |
| No public evidence of buyers exists | The brief says so in `unknowns`. All buyer insights are hypotheses with low confidence. The batch can go on; the owner is told. |

### 1.10 Compatibility

- Engine 2 batches have no brief. `batch_get` returns `brief: null` and no `nextStep` for them. Their insights stay in `batches.insights`.
- Before migration 0015 is live, `brief_save` and source storage cannot work. The code of this unit must merge only after the migration is live, or it must return a clear error ("migration 0015 is not live") and leave all engine 2 paths unchanged. `batch_get` must not fail when the tables do not exist.
- Reuse (optional, small): `brief_save` can take `fromBatchId`. The server copies the latest brief of that batch if it has the same subject. Every evidence item keeps its old `retrievedAt`. The main session must check items older than 30 days. This is an open decision (OD 1.3).

### 1.11 Example brief (fictional brand, for tests and for the prompt)

The brand, the product, the quotes and the URLs below are invented for this example. Use `example.com` URLs in tests. Do not write example research about a real brand.

```json
{
  "brand": { "name": "Pasar Pantry", "category": "packaged breakfast food",
    "positioning": { "text": "Granola with local flavours, baked in small batches in Singapore.", "basis": "evidence", "evidenceIds": ["e1"] } },
  "product": { "subjectId": "subj_example", "name": "Gula Melaka Granola", "variant": "300 g pouch" },
  "productFacts": { "factIds": ["fact_size_300g", "fact_price_1290"] },
  "productTruth": { "shape": "Flat-bottom pouch, about 2:3, matt kraft face, round window low on the front.",
    "texture": "Uneven clusters, 1 to 3 cm, dark gold, visible coconut flakes.",
    "packaging": "Printed front label; the top fold is visible.", "realAppearance": "Clusters break into crumbs at the bottom of the pouch.",
    "referenceKeys": ["kits/pasar-pantry/product-front.png", "kits/pasar-pantry/texture.jpg"] },
  "buyer": { "text": "Adults who buy granola for weekday breakfasts and eat it at other times.", "basis": "interpretation", "evidenceIds": ["e2", "e3"], "confidence": "medium" },
  "buyerInsights": [
    { "id": "i1", "text": "People buy it for breakfast and finish it as a late snack from the pouch.",
      "tension": "The plan was a healthy morning. The fact is a hand in the pouch at 11 pm.",
      "basis": "evidence", "evidenceIds": ["e2", "e3"], "confidence": "high", "market": "SG" },
    { "id": "i2", "text": "People pick out the big clusters first and leave the crumbs.",
      "tension": "Everybody in the home wants the same pieces.",
      "basis": "interpretation", "evidenceIds": ["e4"], "confidence": "low", "market": "unknown" }
  ],
  "categoryConventions": [ { "text": "Competitor ads show a bowl with milk and fruit from above.", "basis": "evidence", "evidenceIds": ["e5"] } ],
  "categoryOpportunities": [ { "text": "No competitor shows granola eaten from the pouch.", "basis": "hypothesis", "evidenceIds": [], "confidence": "low" } ],
  "brandIdentity": { "kitSlug": "pasar-pantry", "voice": "Dry, warm, short.", "personality": "A neighbour who bakes." },
  "commercialObjective": { "text": "Practice batch: one ad good enough to win a real client.", "source": "default", "basis": "hypothesis" },
  "constraints": { "claims": ["No health claim. \"Less sugar\" is not in the facts."], "cultural": ["No race or religion in copy."],
    "product": ["The pouch window must show real clusters."], "visual": ["No bowl-from-above scene."] },
  "evidence": [
    { "id": "e1", "sourceId": "src_1", "url": "https://example.com/about", "sourceType": "brand_site", "quote": "baked in small batches in our Singapore kitchen", "speaker": "brand", "market": "SG" },
    { "id": "e2", "sourceId": "src_2", "url": "https://example.com/reviews/1", "sourceType": "public_review", "quote": "bought it for breakfast but i keep eating it straight from the bag at night", "speaker": "buyer", "market": "SG" },
    { "id": "e3", "sourceId": "src_3", "url": "https://example.com/forum/thread-9", "sourceType": "forum", "quote": "supposed to last two weeks. gone in four days, mostly after dinner", "speaker": "buyer", "market": "SG" },
    { "id": "e4", "sourceId": "src_4", "url": "https://example.com/reviews/2", "sourceType": "public_review", "quote": "the big chunks are the best part", "speaker": "buyer", "market": "unknown" },
    { "id": "e5", "sourceId": "src_5", "url": "https://example.com/competitor", "sourceType": "competitor_site", "quote": "Pour. Top. Enjoy.", "speaker": "competitor", "market": "SG" }
  ],
  "unknowns": [
    { "field": "productFacts", "question": "Is there a launch offer?", "whyItMatters": "A bottom-of-funnel ad needs a real reason to buy now.", "howToResolve": "owner" },
    { "field": "buyer", "question": "Who buys it: the eater or a parent?", "whyItMatters": "It changes who the headline speaks to.", "howToResolve": "client" }
  ]
}
```

### 1.12 Test fixtures and test cases

Fixtures (new file, for example `tests/fixtures/brief.ts`): the example brief above; five `research_sources` rows `src_1` to `src_5` whose text contains the quotes; one row whose text has the quote with curly quotes and a line break inside it.

| # | Test | Expected |
|---|---|---|
| 1.1 | `exa_search` with `batchId` (Exa mocked as the tests do today) | One source row for each result; `sourceId` returned |
| 1.2 | The same URL twice through the same tool | One row |
| 1.3 | `exa_search` without `batchId` | No row; output as today |
| 1.4 | `brief_save` with the fixture | Version 1; all `sourceId` evidence `verified: true` |
| 1.5 | One quote changed by one word | That item `verified: false`; it is in `unverified[]`; the save succeeds |
| 1.6 | Quote with curly quotes and a line break | `verified: true` |
| 1.7 | Insight with basis `evidence` and only an unverified quote | Warning; the save succeeds |
| 1.8 | SG insight with no SG evidence | Warning |
| 1.9 | Evidence id that does not exist; fact id of another subject | Refused |
| 1.10 | Second save | Version 2; version 1 still in the table |
| 1.11 | `batch_get` on an engine 3 batch | Latest brief; sources with no text; `nextStep: "concepts"` |
| 1.12 | `batch_get` on an engine 2 batch | `brief: null`; all old fields equal to today |
| 1.13 | `owner_supplied` evidence with no URL | `verified: null`; no warning |
| 1.14 | The MCP tool list test | `brief_save` is listed and has a test |
| 1.15 | `facts_save` with `batchId`, quote in the stored page | `verified: true` |
| 1.16 | `facts_save` with a quote that is not on the stored page; and with no stored page | `verified: false`; `verified: null` |
| 1.17 | `brief_save` with a fact id whose mark is not 1 | Warning that names the fact |

### 1.13 Acceptance criteria

1. A batch can save a brief with sources; each insight shows its basis, its evidence and its confidence (v3 Phase 1).
2. A fact that is not in `facts` is an unknown. Each fact shows whether the server found its quote in a stored source; a fact that is not verified is marked so wherever it is shown.
3. No text calls public research "customer data".
4. The writer and the critic get the brief through `batch_get`.
5. A new session continues from the saved brief.
6. All engine 2 tests pass without change, except tests that the unit names.
7. `npm run check` passes.

### 1.14 Open decisions

| # | Decision | Default in this design | Who |
|---|---|---|---|
| OD 1.1 | Is an unverified quote (evidence or fact) a refusal? | No. A mark and a warning. A refusal needs one real failure and a row in `docs/decisions.md` (rule budget). | Owner, after first batches |
| OD 1.2 | Does the owner want to approve the brief before concepts? | No. He gets 5 lines. He said he does not want to write briefs (v3 §7.5). | Owner |
| OD 1.3 | Reuse a brief from an earlier batch of the same product | Not in the first unit. | Implementation session |
| OD 1.4 | Text limit for a stored source | 20,000 characters | Implementation session, after the limit check |

### 1.15 Risks

| Risk | Control |
|---|---|
| The brief becomes long form-filling and costs tokens for no gain | Size limits; the 5-line owner summary; Phase 7 compares against engine 2. |
| A verified quote from a wrong or paid source looks like truth | `sourceType` and `speaker` are shown; the critic judges credibility. |
| Stored page text has personal data from public posts | Store only what Exa returned for the query; cut the text; no author names in the brief unless the page is the brand's. The repository has no copy of it. The security checklist applies. |
| Research cost rises | No change to the Exa spend cap. Storage adds no paid call. |

---

## 2. Phase 2: the concept engine

### 2.1 Current behaviour

- The writer subagent writes 20 to 30 ideas, at least 8 for each stage (`plugin/agents/writer.md:3-4,11`). An idea has `format` (tof, mof, bof), `insight`, `visual`, `headline`, `copy` (`worker/mcp.ts:320-361`).
- The critic picks 3: one for each stage (`plugin/agents/critic.md:3-4`, `worker/mcp.ts:363-376`, `worker/batch.ts:267-277`, the D1 triggers). `ideas_pick` saves no reason. It needs at least one id, so "reject all" is not possible in data.
- The critic reads `batch_get`, which has the main session's notes and old ranks.
- `render_submit` checks copy approval but not that the idea is picked.
- `ideas_update` overwrites the headline when the owner changes it (`worker/batch.ts:226-227`).

### 2.2 Territories

After the brief, the writer makes 3 to 5 territories. A territory is the `body` item of one record with `kind: "territories"` (one record holds the whole list).

```json
{
  "briefVersion": 2,
  "territories": [
    {
      "key": "t1",
      "name": "The 11 pm pouch",
      "insightId": "i1",
      "whyItMatters": "",
      "productConnection": "",
      "brandConnection": "",
      "commercialOpportunity": "",
      "mechanisms": ["behavioural_observation", "product_obsession"]
    }
  ]
}
```

Rules in words (writer contract): each territory starts from a different insight or a clearly different tension of one insight. Five versions of one observation are one territory. A territory on a hypothesis insight is allowed and is marked so; the critic weighs it.

Mechanism names (v3 §5.3; a list for labels, not a template): `behavioural_observation`, `product_obsession`, `visual_metaphor`, `contrast`, `product_demonstration`, `editorial_photography`, `typography_led`, `unexpected_object`, `other`.

### 2.3 Concepts

The writer makes 2 to 3 concepts for each territory: 6 to 15 for a batch. Each concept is one row of `ideas`. The columns that exist keep their meaning. The new data goes into `ideas.concept`.

| v3 field (§5.2) | Where |
|---|---|
| Buyer insight | `ideas.insight` (text) and `concept.insightId` |
| Headline | `ideas.headline` |
| Supporting line | `ideas.copy.subline` (as today) |
| Funnel classification | `ideas.format` (the writer's advisory label; see 2.6) |
| Picture in words | `ideas.visual` |
| All others | `ideas.concept` |

```json
{
  "territory": "t1",
  "name": "Night shift",
  "insightId": "i1",
  "evidenceIds": ["e2", "e3"],
  "proposition": "What the ad wants the buyer to understand, in one sentence.",
  "concept": "The central idea, in one or two sentences.",
  "mechanism": { "type": "product_obsession", "how": "How the picture communicates the idea." },
  "productRole": "Why the product is in the scene.",
  "brandRole": "How the brand becomes recognisable.",
  "purpose": "The advertising job.",
  "coverTest": { "pictureAlone": "What a person understands with the headline covered.", "headlineAlone": "What a person understands with the picture covered." },
  "sublineBasis": { "kind": "fact | second_beat | none", "factId": null },
  "risks": [""],
  "briefVersion": 2
}
```

`sublineBasis` handles conflict C4. `fact`: the subline states a fact; `factId` is required in words (warning if absent). `second_beat`: the subline is a second beat of the idea and states no claim. `none`: a headline-only ad; it needs the owner's word at the copy review.

Writer self-notes (the writer's own opinion of which concept is best) are not saved. The critic must not see them.

### 2.4 Writer instructions (contract for `plugin/agents/writer.md`)

```
You develop concepts. You do not select them.
Read: batch_get (the brief), canon_get, taste_log, swipe_search. Read the playbook's option B test.
1. Make 3 to 5 territories. Each one starts from a different insight in the brief. Give the insight id.
   If the brief has fewer than 3 usable insights, say so and stop. Do not invent an insight.
2. For each territory make 2 or 3 concepts. A concept is one idea that the picture and the headline carry together.
   Write the picture and the headline together. Do not write a headline and then look for a picture.
3. Cover test. Cover the headline: the picture still says part of the idea. Cover the picture: the headline still means something.
   If the two say unrelated things, drop the concept. Write both answers.
4. Copy. Headline: 6 words or fewer most times, never more than 8. Subline: 8 words or fewer. Both together: 14 or fewer.
   Sentence case as text. One thought. No hype, no invented urgency, no exclamation mark without a reason.
   The subline states a fact from the facts (give its id) or is a second beat that claims nothing.
   No price, offer, size, ingredient, certificate or health benefit that is not in the facts.
5. Product and brand. Say why the product must be in this scene and how a person knows the brand.
   Use product truth from the brief. Prefer what can be made true: the real pack, real food, product state, arrangement, scale, light.
   Hands and people are high risk. Use them only when the idea needs them.
6. Label each concept tof, mof or bof as advice: who it speaks to. Do not balance the stages. Do not put a price on a tof concept.
7. Name the risks: what could make this concept fail in the render or with the buyer.
8. Return the territories and the concepts as JSON for ideas_save. Do not rank them. Do not say which is best.
When you are sent back with a review: read what the critic rejected and why. Keep what was kept. Write new concepts,
not new words on the same idea. Add to the batch; do not delete.
```

### 2.5 Concept review and selection by the critic

**Critic view.** `batch_get` gets an optional `view: "critic"`. In this view the server omits: the batch notes, owner messages that are not rules, draft ranks and rank reasons of this batch, and anything a writer could use to mark a favourite. It returns the concepts in a shuffled order that is stable for the batch (order by a hash of batch id and idea id). The critic subagent file says to call this view only. This needs no migration and is part of unit 0.

**Review input** (new optional fields of `ideas_pick`; the server saves them as one record with `kind: "concept_review"`, author `critic`, in the same D1 batch statement as the pick):

```json
{
  "batchId": "",
  "outcome": "select",
  "ids": ["idea_a", "idea_b", "idea_c"],
  "roles": { "idea_a": "tof", "idea_b": "tof", "idea_c": "bof" },
  "reserves": ["idea_d", "idea_e"],
  "review": {
    "concepts": [
      {
        "ideaId": "idea_a",
        "scores": { "originality": 4, "appropriateness": 5, "insight": 4, "headline": 4, "visual": 4,
                    "productRelevance": 5, "brandRecognition": 3, "commercialPurpose": 4, "executionPotential": 4 },
        "gates": { "falseClaim": false, "stereotype": false, "raceReligionInCopy": false, "misrepresentsProduct": false,
                   "inaccurateLogo": false, "headlineImageSplit": false, "needsRenderDefect": false, "noProductOrBrandLink": false },
        "optionB": "pass",
        "ownerGate": "pass",
        "works": "",
        "doesNotWork": "",
        "original": "",
        "insightCredible": "",
        "worthPaying": "",
        "verdict": "select"
      }
    ],
    "setVariety": "Why the three are not versions of one another.",
    "setReject": null
  },
  "promptVersion": "0.3.0"
}
```

`verdict` is `select`, `reserve`, `reject` or `rework`. `outcome: "rework"` has no ids; `review.setReject` then says what is missing and what the writer must do next.

**Selection rule (words for `plugin/agents/critic.md`, not code):**

```
Read every concept before you judge one. Read the brief: is the insight credible? Look at its basis and its quotes.
For each concept: the 8 gates (any true gate rejects it), the option B test, the owner gate, then 1 to 5 on the 9 dimensions.
A concept can be selected only if: no gate is true, option B and the owner gate pass,
originality is 4 or more AND appropriateness is 4 or more, and no dimension is under 3.
Do not add the scores. Do not pick by the average. The scores are your notes; your reasons decide.
Select the 3 strongest that are different from one another: at least 2 territories, and no 2 with the same
territory and the same mechanism. Variety does not beat quality: do not select a weak concept for variety.
If fewer than 3 concepts pass, do not lower the bar. Return outcome "rework" and say what the writer must do.
Name up to 3 reserves that also pass. They are the spares for the copy review.
After you select, give each selected concept its role: tof, mof or bof. The role is advice. Two concepts can have one role.
A tof concept has no price. If the best concept needs a price, its role is not tof.
Write, for each concept: what works, what does not, what makes it original, whether the insight is credible,
and whether it is worth paying to produce. Short and exact. No praise words.
```

The thresholds (4 and 3) are a start value. Phase 4 measures them against the owner's decisions; they change only through the canon process.

**Server behaviour of `ideas_pick` for an engine 3 batch:**

| Input | Behaviour |
|---|---|
| `outcome: "select"` with exactly 3 ids | Sets `picked` on the 3, clears it on the others, writes `format` from `roles` for the 3, saves the review record, saves the canon log id. One atomic D1 batch. |
| `outcome: "rework"` | Picks nothing. Saves the review record. `nextStep` becomes `concepts_rework`. |
| A selected id whose review has a true gate or verdict other than `select` | Returns `warnings[]`. No refusal (OD 2.2). |
| Fewer or more than 3 ids with `select`; an id that is not in the batch; scores outside 1 to 5; missing reasons | Refused (shape check). |
| `review` absent on an engine 3 batch | Refused: the review is required. |
| Any call after a render exists for a picked idea of the batch | Refused, as the role and the picks are then frozen. To change, the owner must say so and the main session uses `ideas_update` (OD 2.4). |
| Engine 2 batch | Exactly as today, including one for each stage. |

**Rework rounds.** The server counts the `concept_review` records with `outcome: "rework"`. After 3, `nextStep` is `owner_decision`: the main session tells the owner what the critic rejected and why, and asks whether to do more research, change the product angle or stop. No render is paid for.

### 2.6 Funnel role and the pick limit

- `ideas.format` stays NOT NULL with tof, mof or bof. It is now the **role**: first the writer's advice, then the critic's classification at the pick.
- The limit is 3 picked ideas for each batch (migration 0015 A). No limit for each stage in engine 3.
- The role is frozen when the first render of that idea exists, because ad names (`worker/pack.ts:61-63`), the ad key `stage_cNN` and the results pattern (`worker/results.ts:12`) use it. Two ads with the same role in one pack are already possible in the name pattern, because the counter is per brand and stage (P0 §6.2). Test this (test 2.12).
- The board (`app/src/views/Board.tsx:8-17`) groups by stage. With two picks in one stage it must show both. This is a Phase 6 change; until then the contact sheet in chat is the main way, as today. Check the board with such a batch before the first engine 3 batch reaches status `board`.
- The board gate (`worker/batch.ts:141-150`): engine 2 as today; engine 3 needs exactly 3 picked ideas, each with approved copy, a direction record and 3 eligible drafts or a recorded reason (3.6).
- `render_submit` refuses a draft for an idea that is not picked (unit 0; true for both engines).

### 2.7 Copy review (kept; conflict C2)

After a `select`, the main session stops and shows the owner, as text only: the headline and subline of the 3 picks with the concept name and one line of the idea, then the critic's reserves (up to 3) as spares. This replaces "2 spares for each stage". The owner approves, changes or swaps. `ideas_update copyApproved` saves his exact words, as today. The render gate stays.

When the owner changes the words, `ideas_update` keeps the first text: it writes `copy.written = { headline, subline }` once, before the first change (unit 0; the `copy` column is JSON, so no migration). Phase 4 uses it for the copy correction rate.

The owner is not asked to select concepts (v3 §7.5). The copy review is a yes or no on words. The reserves are shown only as the spares of today's copy review. If he rejects the words of a pick, the default is that the writer changes the words or the concept goes back to the critic (`concepts_rework` with his words). Only if he, in his own words, names a reserve to use in its place, the main session calls `ideas_pick` again with the new 3 ids, the same review and a note `ownerSwap` with his exact words. The record author is `owner`. The main session never suggests a swap.

### 2.8 MCP tools

| Tool | Change | Detail |
|---|---|---|
| `ideas_save` | EXTEND | Optional `territories` (3 to 5). Each idea can have `concept`. For engine 3: `concept` and `territories` are required; total concepts for the batch at most 24 (15 first round plus rework). Engine 2: as today. |
| `ideas_pick` | EXTEND | 2.5. |
| `ideas_update` | EXTEND | Keeps `copy.written`. Can change `concept` fields before the first render. |
| `batch_get` | EXTEND | `view: "critic"`; returns `territories`, `concept` for each idea, latest `conceptReview` (not in the writer's first round; yes after a rework), `nextStep`. The ideas limit of 60 (`worker/batch.ts:492`) stays. |
| `render_submit` | EXTEND | Refuses a draft for an idea that is not picked. |

### 2.9 State transitions

`brief` → `ideas_save` (territories and 6 to 15 concepts) → critic `ideas_pick`:
- `select` → copy review → owner approval → Phase 3.
- `rework` → writer adds concepts → critic again (at most 3 rework rounds) → `owner_decision`.

### 2.10 Failure handling

| Failure | Behaviour |
|---|---|
| The writer returns fewer than 3 territories | `ideas_save` refuses for engine 3. The main session checks the brief: too few insights means more research, not more words. |
| The critic selects 3 from one territory | Not refused. The critic file forbids it; `warnings[]` names it; the main session sends it back once. |
| The pick write fails in the middle | One D1 batch: all or nothing. |
| The critic subagent did not use the critic view | Cannot be proved by the server. The subagent tools list has only `batch_get`; the file names the view. Residual risk R2 in 2.14. |
| The owner rejects all 3 at the copy review | The main session saves his words (`batch_update ownerVerdicts`), and the flow goes to `concepts_rework` with his words as input for the writer. |

### 2.11 Compatibility

- Engine 2 batches: every tool behaves as today. All tests of P0 §15 stay green. The tests at `tests/batch.test.ts:51-66,304-330,487-502` and `tests/mcp.test.ts:127-207` describe engine 2 and stay; new tests are added for engine 3.
- Before migration 0015: `ideas.concept` and `batches.engine` do not exist. This unit merges after the migration is live.
- Old ideas have `concept: '{}'`. Readers must accept an empty concept.
- The MCP instructions (`worker/mcp.ts:30-31`), prompts (`worker/prompts.ts:47,57`), the subagent files and the playbook say "1 tof, 1 mof, 1 bof" in many places (P0 §6.1). Change them in the unit that ships the pick change, in one pull request, with a `docs/decisions.md` row for C1.
- Plugin version: a change to the subagent files is a new plugin version. The owner updates the plugin himself; tell him.

### 2.12 Test cases

| # | Test | Expected |
|---|---|---|
| 2.1 | `ideas_save` engine 3 with 4 territories and 10 concepts | Saved; `concept` JSON on each row; one territories record |
| 2.2 | 2 territories, or 6 territories | Refused |
| 2.3 | A concept whose territory key is not in the list | Refused |
| 2.4 | `ideas_save` engine 2 with the old shape | As today |
| 2.5 | `ideas_pick` select with 3 ids in two stages (tof, tof, bof) | 3 picked; formats written; review record saved |
| 2.6 | A fourth pick by direct SQL in the test database | The trigger aborts with "Pick limit: 3 ideas per batch." |
| 2.7 | `ideas_pick` select with 2 ids, or without `review`, on engine 3 | Refused |
| 2.8 | `ideas_pick` rework | No pick; review saved; `nextStep: "concepts_rework"` |
| 2.9 | 3 rework records, then `batch_get` | `nextStep: "owner_decision"` |
| 2.10 | Selected id with a true gate | Saved with a warning |
| 2.11 | `batch_get view: "critic"` | No notes, no ranks; the same order on two calls; a different order from insert order for a fixture batch |
| 2.12 | Pack and ad names for a batch with two tof picks | Two different ad names and ad keys; the results pattern matches both |
| 2.13 | `render_submit` draft for an idea that is not picked | Refused (both engines) |
| 2.14 | `ideas_update` headline change twice | `copy.written` has the first text; it does not change the second time |
| 2.15 | `ideas_pick` on engine 2 with two ideas of one stage | Refused as today |
| 2.16 | `ideas_pick` after a render exists | Refused |
| 2.17 | Migration test | New triggers exist; old triggers do not; columns have their defaults |

Evaluation fixtures for the critic contract (words, not code; used by hand or in the Phase 4 stability test): a set of 8 fictional concepts for the example brief, with 2 that break a gate (one false claim, one headline and picture split), 2 that are appropriate but generic, 1 that is original but wrong for the brand, and 3 strong. A correct critic selects the 3 strong ones and names the gate for the 2. A second set has 0 strong concepts: a correct critic returns `rework`. Keep the sets in `tests/fixtures/` as JSON. They are tools for a regression check, not ground truth for taste.

### 2.13 Acceptance criteria

1. A batch has 3 to 5 territories and 2 to 3 concepts for each (v3 Phase 2).
2. The critic's reasons are saved for every concept; a later session can read why a concept was selected.
3. The critic can reject the whole set; no render is possible then.
4. Three selected concepts can have any mix of roles.
5. The copy review still stops the batch before any render.
6. Engine 2 batches work as before. `npm run check` passes.

### 2.14 Open decisions and risks

| # | Decision | Default | Who |
|---|---|---|---|
| OD 2.1 | C1: v3 concept selection replaces "one for each stage" and "24 to 30 ideas" | V3 wins; decisions row when it ships | Owner (flagged) |
| OD 2.2 | Is a selected concept with a true gate a refusal? | Warning only | Owner, with rule budget |
| OD 2.3 | Start thresholds 4 and 3 | As written; Phase 4 checks them | Canon process |
| OD 2.4 | Change of picks after a render | Owner's word only | Owner |
| OD 2.5 | C4: sublines that are not facts; headline-only ads | Allowed as `second_beat` or `none` with the owner's word | Owner (flagged) |
| OD 2.6 | C8: scope in Goal 1 text | Decided 17-11-2026: F&B brands with packaged food or drinks, and all wellness brands except service-based wellness businesses with no packaged product. Practice stays on packaged F&B. | Owner |

| Risk | Control |
|---|---|
| R1. Fewer concepts give less range, and the batch has no strong ad (the opposite of the aim) | Rework rounds; Phase 7 comparison with engine 2; the owner pass rate metric. |
| R2. The critic's independence is prose | Critic view from the server; the subagent's tool list; no writer notes in data. |
| R3. Score inflation: every concept gets 4 | Phase 4 reports the score spread; the stability test with the fixed fixtures. |
| R4. A pack mixes roles in a way the client does not expect (three tof ads) | The role mix is shown to the owner at the copy review. Client deliverable count stays 3. |
| R5. Many text places still say "one for each stage" after the change | The list in P0 §6.1 is the checklist for the pull request; a test greps the MCP instructions and prompts for the old words. |

---

## 3. Phase 3: creative direction and draft diversity

No fal call was made for this design. Nothing here is proved to give better pictures. It is a contract to test in the first engine 3 batch.

### 3.1 Current behaviour

- The art director subagent writes 3 prompts and 3 layout plans for each picked idea and checks drafts and finals (`plugin/agents/art-director.md:4,13,17`). The plans are files on the session's disk. The checks are chat text. Nothing is in D1.
- The 3 drafts differ by the product-lock skeleton placement (playbook §7.4 A). The house recipe gives one look.
- A draft with a D item (D1 to D9, render checklist) is named and the owner is told not to pick it. He still sees it.
- If the session ends, the plans are lost. The reprint of the final needs the picked draft's plan.

### 3.2 Desired behaviour

1. For each picked concept the art director returns one direction as JSON. The main session saves it with `direction_save`. It has the reason for the look, the 3 draft variants, the question that each draft asks the owner, and the 3 layout plans.
2. The 3 drafts differ in ways that matter (rubric 3.4).
3. The look comes from the concept, inside the calm rules. The house recipe is the fallback.
4. Each draft gets a saved check. A draft that fails is made again once. The owner sees eligible drafts.
5. Each final gets a saved check against the 8 points of v3 §7.8.
6. The product lock, reprint, logo by construction, food checks, `photo_finish`, `headline.py` and the repair tools do not change.

### 3.3 Data structure: direction

A record with `kind: "direction"`, `idea_id` set, author `art-director`.

```json
{
  "why": "Why this look communicates the concept, in 2 or 3 sentences.",
  "mechanism": { "type": "product_obsession", "productionRisk": "low", "riskReason": "" },
  "shared": {
    "backdrop": "", "light": "", "colour": "", "supportingObjects": [""],
    "hierarchy": "What the eye reads first, second, third. Back products recede: shadow, soft focus.",
    "type": { "headlineFont": "", "weight": "", "case": "", "reason": "A brand font that is not the logo's font." },
    "logo": { "placement": "", "note": "Optically centred. Ignore the TM and R marks." },
    "recipe": "concept | house",
    "recipeApproval": null
  },
  "drafts": [
    {
      "n": 1,
      "question": "What this draft asks the owner, for example: is the idea clearer when the pouch is empty?",
      "axes": { "composition": "", "productPosition": "", "scale": "", "camera": "", "light": "", "environment": "",
                "negativeSpace": "", "staging": "" },
      "plan": { },
      "prompt": "",
      "renderId": null
    }
  ],
  "diversity": { "pairs": { "1-2": ["composition", "scale", "camera"], "1-3": ["..."], "2-3": ["..."] } },
  "elementCount": 3
}
```

- `plan` is the layout plan in the exact form that `scripts/product_lock.py layout` writes and `reprint` reads. Saving it in D1 closes the gap of 3.1: a new session can write the plan to a file and run the reprint for the final.
- `prompt` is the draft prompt before the server adds its suffix (`worker/fal.ts:18-23`).
- `renderId` is filled by a second `direction_save` version after the renders are submitted, or the main session matches by image order as today. The implementation session chooses; a version 2 record is the default.
- Size: 3 plans and 3 prompts are small (a few kB).

### 3.4 Diversity rubric and calm rules

**Axes:** composition and product position; scale; camera; light; environment; negative space and headline place; staging of the mechanism.

**Rule:** each pair of the 3 drafts differs on 3 or more axes, and at least one of them is composition, camera or scale. A change of background colour alone counts as 0. A change of the product's proportions is never a way to differ: the product lock holds.

**Each draft states its question.** The 3 drafts are 3 answers to "how do we show this idea", not 3 tries at one picture. Examples: full pack against tight crop; product as hero against product in a behaviour; empty against full.

**Production risk of a mechanism** (from the lessons of the approved batches; lowest risk first):

| Risk | Mechanism staging | Note |
|---|---|---|
| Low | Product state (open, empty, tipped, spilled), arrangement, scale and crop, light and shadow | The real pack print goes back with reprint. |
| Medium | One meaningful object; typography-led layouts; a second product that recedes | The object must have a reason. Type is set in code, never painted. |
| High | Hands; people; complex scenes; a pack in a mock-up shape | Use only when the concept needs it; say why in `riskReason`. A mock-up pack is rebuilt as real in the prompt. |

**Calm rules (the owner's taste; conflict C5):** one hero pack; 5 elements or fewer in the scene (`elementCount`); no filler prop; a plain, lit surface unless the concept needs a place; muted accent colours. "The look follows the concept" means the staging, the camera and the light change with the idea. It does not mean busy scenes.

**Fallback (owner decision, 17-11-2026):** the house recipe of playbook §7 is the fallback when the owner says that the output is not up to standard. Then `shared.recipe` is `house`. If the art director cannot find a concept-led look with acceptable risk, it says so and proposes the fallback; the main session asks the owner. A proposal is not an approval. The approval is saved: the direction record with `shared.recipe: "house"` must have `shared.recipeApproval` with the owner's exact words, and `direction_save` refuses a `house` direction without it (a shape check). The main session also saves his words with `batch_update ownerVerdicts`, as it does today for owner notes. A session that resumes reads the record; if the field is absent, the fallback is not approved. The use is recorded, so Phase 4 can count it.

The rubric is in words in the subagent file. `direction_save` checks shape only: 3 drafts, each with a question, a plan and a prompt; the `pairs` lists present. It returns a warning when a pair lists fewer than 3 axes. It does not refuse.

### 3.5 Art-director prompt contract and draft prompt structure

Contract for `plugin/agents/art-director.md` (direction part):

```
You get one batch id and one idea id. Read batch_get (the concept, the brief's productTruth and visual constraints),
brand_get (kit, fonts, logo, product pictures), canon_get, the playbook §7 and the render checklist.
1. Say in 2 or 3 sentences why your look communicates this concept. If you cannot, the concept is not ready: say so.
2. Choose the staging. Rate its production risk. Prefer low risk when two stagings say the idea equally well.
3. Write the shared look: backdrop, light, colour, objects (each with a reason), hierarchy, type, logo place.
   Headline font: a brand font that is not the logo's font. Leave real space for the approved words: count them.
4. Write 3 drafts. Each asks the owner a different question. Fill the axes. Check each pair against the rubric.
   If two drafts differ only in colour or small position, change one.
5. For each draft, make the layout plan with scripts/product_lock.py layout, so the product shape is exact.
6. Write each prompt in the structure below. No words painted in the picture.
7. Return one JSON object for direction_save. Do not call render_submit. The main session does that.
```

Draft prompt structure (one prompt for each draft; the product-lock skeleton is the only reference image, as today):

| Part | Content |
|---|---|
| 1. Scene sentence | What the picture shows, as a photograph: subject, state, place. One or two sentences. |
| 2. Product | The pack named as a real object: material, finish, how it stands or lies, its state. "Keep the product's outline and proportions exactly as in the reference." For a mock-up shape: describe the real pack to build. |
| 3. Concept staging | The one thing that carries the idea (the spill, the empty space, the object). |
| 4. Camera | Angle, distance, lens feeling, depth of field. Back products out of focus. |
| 5. Light | Direction, hardness, colour temperature, shadow. |
| 6. Surface and backdrop | Material and colour. |
| 7. Space | Where the picture is empty for the headline and the logo. |
| 8. Food (when food shows) | The real food's size, irregular shape, colour, surface, from the texture photo. |
| 9. Exclusions | No text, no logo drawn, no hands (unless the direction says so), no extra packs, no props that are not named. |

The server suffix `RENDER_SUFFIX` stays. After the render, the steps of today stay: measure the shape, reprint a flat printed face with the draft's plan, `photo_finish.py`, `headline.py` with the approved words.

### 3.6 Checks: drafts and finals

`checks_save` saves one record for each checked picture: `kind: "draft_check"` or `"final_check"`, `idea_id` set, author `art-director`.

```json
{
  "renderId": "",
  "eligible": true,
  "measured": { "shapeRatio": 0.667, "targetRatio": 0.667, "tolerance": 0.02 },
  "items": [ { "code": "D3", "found": false, "note": "" } ],
  "points": { "productShape": "pass", "label": "pass", "logo": "na", "food": "pass", "light": "pass", "scale": "pass",
              "props": "pass", "physics": "pass", "composition": "pass", "hierarchy": "pass", "headlineSpace": "pass", "defects": "pass" },
  "reason": "",
  "attempt": 1
}
```

- The 12 points are the list of v3 §7.4. `items` uses the D codes (drafts) and F codes (finals) of `docs/render-checklist.md`. Use the codes that the checklist has; do not invent codes.
- A draft is not eligible when a D item is found or a point fails. Eligibility is the art director's judgement, saved. The server does not judge.
- **Redo once (conflict C6):** a draft that is not eligible is made again one time (`attempt: 2`), with a changed prompt that names the fault. The cost is one low-quality render. If the second try fails, the owner is shown the eligible drafts for that concept and is told in one line why there are fewer than 3. If a concept has 0 or 1 eligible drafts after the redo, the direction is wrong: the art director writes a new direction (version 2) with lower risk, once. After that, tell the owner.
- `batch_get` returns each draft's latest check. The contact sheet and, in Phase 6, the board show eligible drafts only. Until the board changes, the main session names the drafts that are not eligible, as today.
- The critic ranks eligible drafts only (`drafts_rank`), blind.
- **Final check** (`final_check`): the 8 points of v3 §7.8 as `pass` or `fail` with a note: concept quality, product truth, brand identity, copy accuracy, food authenticity, composition, visual craft, render checklist. It also has `checkedAt: ["full", "phone"]`, `logoCentred`, `copyMatchesApproved` (the text on the picture equals the approved words). A final with a failed point does not go to the owner as ready. It is repaired (existing tools, as a rare step) or made again. `pack_publish` behaviour does not change in this phase; the owner's approval of the final is still the gate for a pack.

### 3.7 MCP tools

| Tool | Change | Detail |
|---|---|---|
| `direction_save` | NEW | `batchId`, `ideaId`, `direction`, `promptVersion` → `version`, `warnings[]`. Refuses if the idea is not picked or the copy is not approved. |
| `checks_save` | NEW | `batchId`, `ideaId`, `kind`, `check` → `version`. Refuses a `renderId` that is not a render of that idea. |
| `batch_get` | EXTEND | For each picked idea: latest `direction` (plans included only with `withPlans: true`, to keep the normal answer small), latest check for each render. |
| `render_submit` | KEEP | Copy gate and picked gate. No direction gate in code (the board gate has it; see 2.6). |
| `drafts_rank` | EXTEND | Accepts only eligible drafts when checks exist; saves a `rank_context` record (4.4). |

### 3.8 Agent responsibilities

| Agent | Responsibility |
|---|---|
| Art director | Direction JSON; layout plans; draft checks; final checks. It does not submit renders and does not rank. |
| Main session | Saves the direction, submits renders, runs the local scripts, saves checks that the art director returns, builds the contact sheet, stops for the owner. |
| Critic | Ranks eligible drafts blind. It does not see the direction's `question` or `why` (they would lead it); the critic view omits the direction. |
| Owner | Picks one draft for each concept or passes on all. His words are saved. |

### 3.9 State transitions and failure handling

Copy approved → `direction_save` → 3 × `render_submit` → local steps → `checks_save` × 3 → (redo once where needed) → `drafts_rank` → board → owner pick → `final_render` → local steps → `checks_save` final → owner verdict.

| Failure | Behaviour |
|---|---|
| The session ends after the renders | A new session reads the direction with plans from `batch_get withPlans`, writes the plan files, and continues at the first render with no check. |
| A render fails at fal | As today (`render_status`). The draft has no check; `nextStep` stays `drafts`. |
| The spend cap refuses a redo | Tell the owner; show the eligible drafts. |
| The owner passes on all 3 | Save his words (`batch_update ownerVerdicts`, as today). New direction version with his words as input, then 3 new drafts (v3 §7.5). Ask before the second full redo of one concept: it is paid. |
| The art director says the concept cannot be shown | The main session reports it; the concept goes back to the critic's reserves through the owner (2.7 swap). |

### 3.10 Compatibility

Engine 2 batches have no direction and no checks; every reader accepts their absence. The engine 2 board gate does not ask for them. The scripts do not change. The plugin subagent file changes; this is a new plugin version that the owner installs.

### 3.11 Test cases

| # | Test | Expected |
|---|---|---|
| 3.1 | `direction_save` for a picked idea with approved copy | Version 1 |
| 3.2 | For an idea that is not picked, or without approved copy | Refused |
| 3.3 | 2 drafts, or a draft with no question or no plan | Refused |
| 3.4 | A pair with 1 axis | Saved with a warning |
| 3.4b | `shared.recipe: "house"` without `recipeApproval`; and with the owner's words | Refused; saved |
| 3.5 | `batch_get` normal and with `withPlans` | Plans only in the second |
| 3.6 | `checks_save` draft, eligible false, then a second render with `attempt: 2` | Both saved; `batch_get` shows the latest check for each render |
| 3.7 | `checks_save` with a render of another idea | Refused |
| 3.8 | Board gate, engine 3, one concept with 2 eligible drafts and no reason | Refused; with 3 eligible, passes |
| 3.9 | `drafts_rank` with a draft that is not eligible | Refused |
| 3.10 | Plan round trip: a plan from `product_lock.py layout` saved and read back | Byte-equal JSON after parse; `reprint` accepts it (script test, no fal) |
| 3.11 | Engine 2 batch through the board gate | As today |

Image review checklist for the first engine 3 batch (done by the implementation session with the owner, paid, with his approval; not part of CI): for each concept, lay the 3 drafts side by side and answer: do they ask 3 different questions; does each pair differ on 3 axes; is the product ratio inside the tolerance; is the print real; are there 5 elements or fewer; is there space for the approved words; did the fallback recipe get used; how many redos. Save the answers in the pull request or the batch notes. Report the cost.

### 3.12 Acceptance criteria

1. Each picked concept has a saved direction with a reason and 3 different draft questions (v3 Phase 3).
2. Product proportions, the real logo and the food checks are as strict as today (no check removed).
3. Each draft and final has a saved check.
4. A new session can finish a batch that another session started, including the reprint.
5. At least one engine 3 practice batch shows drafts that the owner calls different. This needs a paid batch and the owner's word. Until then this item is not verified.

### 3.13 Open decisions and risks

| # | Decision | Default | Who |
|---|---|---|---|
| OD 3.1 | C5: concept-led look against the house recipe standard | Concept-led inside the calm rules; house recipe as recorded fallback | Owner (flagged) |
| OD 3.2 | C6: redo a failed draft once | Yes, one low-quality render | Owner (flagged; small cost for each redo) |
| OD 3.3 | C3: case of the headline on the picture | Text in sentence case; case on the picture is a type decision | Owner (flagged) |
| OD 3.4 | Does the board hide drafts that are not eligible? | Phase 6. Until then they are named. | Implementation session |

| Risk | Control |
|---|---|
| More variety brings more defects (the approved finals were calm and simple) | Risk rating; calm rules; fallback; product defect rate and render waste in Phase 4. |
| Redos raise cost | One redo for each draft at most; the report shows the count. |
| The rubric becomes box-ticking: 3 axes changed, same picture in effect | The owner's pass rate and his words are the real test; the draft question must be a real question. |
| The art director's self-check is not independent | The critic ranks blind; the owner decides; Phase 4 measures defects that the owner found after an "eligible" mark (false acceptance). |

---

## 4. Phase 4: critic calibration

Phase 4 is designed in less depth than Phases 1 to 3. If the remaining allowance is short, the implementation session completes the details. The method and the limits below are fixed.

### 4.1 Current behaviour and baseline

- One number exists: rank-1 agreement, from `tasteTally` (`worker/batch.ts:355-361`).
- Read on 16-11-2026 through `taste_log`: 12 reviewed draft sets; the critic's rank 1 was the owner's pick in 2. Ranks of the owner's pick: rank 1 twice, rank 2 six times, rank 3 four times.
- Rank-1 agreement: 2 of 12 = 0.17. Wilson 95% interval: about 0.05 to 0.45. Chance for 3 drafts is 0.33. Mean reciprocal rank: 0.53; chance is 0.61.
- **Reading:** on this small sample the critic is not better than chance at the owner's draft choice. The interval contains chance, so "worse than chance" is not shown. The sample mixes canon versions and plugin versions.
- 17 owner picks and 49 verdicts are saved (finals: 14 approve, 13 fix, 8 reject; draft sets: 7 pass, 5 fix).
- The text gold set has 264 items and no pictures. The last balanced accuracies were 0.590, 0.574, 0.609 and 0.689. It cannot test visual taste (v3 §10.1).
- The server sends rank and reason to the session and the browser before the owner picks (`worker/batch.ts:529`). The board hides them in the browser (`Board.tsx:129-146`); the main session is told not to read them.
- No reasons are saved for the idea pick. No stamp says which canon and plugin version made a rank.

### 4.2 Metrics

Every metric is reported with its count `n`, by engine (2 or 3) and by version stamp. No metric is reported as one global number across versions.

| Metric (v3 §10.3, §10.4) | Formula | Source |
|---|---|---|
| Draft-pick rank-1 agreement | Sets where the owner's pick has critic rank 1 ÷ sets with an owner pick and a rank made before the pick | `picks`, render ranks, `rank_context` |
| Draft-pick MRR | Mean of 1 ÷ (critic rank of the owner's pick) | Same |
| Owner pass rate | Draft sets with a full pass ÷ draft sets shown | `verdicts` (draft pass rows) |
| Concept selection agreement | Selected concepts that the owner kept at the copy review ÷ selected concepts | `concept_review` records with author `owner` (swaps) |
| Concept acceptance rate | Concepts with verdict `select` or `reserve` ÷ concepts reviewed; and batches with outcome `rework` ÷ batches | `concept_review` |
| Draft rework rate | Drafts with `attempt` 2, and directions with version above 1, ÷ drafts and directions | `draft_check`, `direction` |
| Final approval rate | Finals with owner verdict approve ÷ finals with a verdict | `verdicts` |
| Final approval agreement | Finals where the final check (all 8 pass) agrees with the owner's approve or not ÷ finals with both | `final_check`, `verdicts` |
| False acceptance | Finals or drafts marked pass or eligible that the owner rejected or marked fix for a defect ÷ items marked pass | Same |
| False rejection | Items not eligible that the owner later chose or approved ÷ items not eligible that the owner saw | Same (small n; possible only while such drafts are shown) |
| Product defect rate | Renders with a product point failed (shape, label, logo) ÷ renders checked | `draft_check`, `final_check` |
| Copy correction rate | Picked ideas where the approved text differs from `copy.written` ÷ picked ideas with approved copy | `ideas.copy` |
| Paid render waste | fal spend on renders that are not in an approved final's line (not the picked draft, not the approved final) ÷ fal spend | spend rows, picks, verdicts |
| Concept ranking stability | See 4.9 | `calibration_runs` |
| Client performance | Existing results tools against the client's baseline | `results_get`; no change |

**Primary measure:** prospective, blind draft-pick rank-1 agreement and MRR for one version stamp. It is the only measure in which the critic could not have seen the answer. All replay measures (4.5) are secondary.

Rule from v3 §10.3: a high agreement is not a goal alone. Read it with the owner pass rate and, later, client results. Do not tune one metric at the cost of the others.

### 4.3 The server holds the rank until the owner decides

For each idea, `batch_get` and `/api/batches/:id` omit `rank` and `reason` of its drafts until that idea has an owner pick or a full-pass verdict. They return `ranked: true` so the flow can go on. After the decision they return rank and reason as today (the board's comparison view keeps working).

- `view: "critic"` never returns ranks of the batch that is being judged.
- `taste_log` returns past ranks only for decided sets (check its query; change it if it returns undecided ranks).
- `drafts_rank` returns only `saved: n`, not the ranks back to the caller's context beyond what the critic already wrote.
- Part of unit 0. No migration. Tests: undecided idea → no rank in the MCP answer and in the API answer; after `picks_save` → rank present; after a full pass → rank present.

This closes the gap that the blind rule depended on the main session not reading a field.

### 4.4 Rank context stamp

`drafts_rank` and `ideas_pick` (engine 3) write a `rank_context` record, author `server`: the id of the latest canon log row, the `promptVersion` that the critic passed, the count of taste log rows at that time, and the ids of the drafts that were ranked. A metric row is then tied to the critic that made it. Ranks made before this unit have no stamp; report them as "unstamped".

### 4.5 Visual evaluation set

The set is **derived** from saved owner decisions. Nobody writes labels by hand. The critic's ranks are never labels.

| Task | Item | Label (from the owner) | Chance |
|---|---|---|---|
| Triplet choice | The 3 drafts of one idea that the owner saw, pictures from R2 | The draft he picked | 1/3 |
| Full-pass detection | The same triplets plus those he passed on | Picked one, or passed on all | Report the class balance |
| Final judgement | One final with the concept and the approved copy | Approve, fix or reject, with his words | Report the class balance |

Rules:

1. An item enters the set only when all its pictures are still in R2 (P0 U2: check first; report how many are lost) and the owner's decision is saved.
2. Each item keeps: picture keys, the concept or idea text, the copy, the owner's label, his exact words, the batch id, the decision date, the engine.
3. The set is defined by a date: `as_of`. "All decided items up to `as_of`" is reproducible. No copy of the pictures is made.
4. Report the size and the class balance each time. Today's upper bound: 17 picked triplets (12 with a rank), 7 full passes, 35 final verdicts. That is small. Say so in every report.
5. **Contamination:** the critic reads `taste_log` and the canon, which contain these same decisions. A replay on an item that is in the critic's context is not a test. For a replay, the item's own decision and all later decisions must be kept out: the calibration tool gives the critic a taste log cut at the item's decision time (`taste_log before:` filter, new optional field), and the report marks the canon as "current, may contain lessons from this item". Results with that mark are "contaminated replay" and are never the primary measure.
6. **Holdout:** split by time, not at random. Items decided after a fixed date are the holdout. The holdout is not used to write canon rules and is not shown in `taste_log` examples for the replay. Start: the newest 30% of items are holdout; the split date is saved in each `calibration_runs` row. With a set this small, the holdout says little; report it with its interval and do not act on it alone.
7. The text gold set stays as it is, for headlines and concepts as text. The gold tools get an optional set or filter argument (for example packaged F&B only) so a subset can be scored; today `gold_score` needs every item (`worker/canon.ts:263-264`) and compares with the previous run only (`:271`). This is an EXTEND, not a rebuild. Do not call the text set a visual benchmark.

### 4.6 Blind test setup

**Prospective (primary; no extra cost):** every engine 3 batch. The critic ranks eligible drafts in a fresh context from the critic view; the server holds the rank (4.3); the owner picks from the sheet; the pick and the stamp are saved. The report tool reads them.

**Replay (secondary; costs tokens, not money at fal):** a new MCP prompt or skill step gives a fresh critic one triplet at a time: 3 pictures through `image_get` in a shuffled order that the tool saves, the concept and copy, the taste log cut before the item, no ranks, no owner label. The critic answers with one choice and a reason. The tool compares with the label and writes one `calibration_runs` row with: kind, `as_of`, split, stamps, `n`, counts, agreement, MRR where it applies, the Wilson interval, and the list of item ids with right or wrong. The critic never gets the label back in the same context.

**Position bias check:** the shuffle order is saved. Report the share of choices by position (1, 2, 3). A critic that picks position 1 in 60% of items has a bias.

### 4.7 Tools

| Tool | Change | Detail |
|---|---|---|
| `calibration_report` | NEW, read only | Input: optional `engine`, `since`, `promptVersion`. Output: every metric of 4.2 with `n`, interval where it is a proportion, and the stamps. Computes from D1; no stored state. |
| `calibration_items` | NEW, read only | Returns the derived visual set for `as_of` and `split`, without labels (for the replay critic) or with labels (for the scorer; never called by the critic subagent: it is not in the critic's tool list). |
| `calibration_save` | NEW | Writes one `calibration_runs` row after a replay. |
| `taste_log` | EXTEND | Optional `before` (date) so a replay can cut the log. |
| `gold_get`, `gold_score` | EXTEND | Optional filter; the run row saves the filter. |

If the tool count matters (47 today), `calibration_items` and `calibration_save` can be one tool with a mode. The implementation session decides.

### 4.8 Baselines and confidence limits

- Baseline for engine 2: the numbers of 4.1, frozen in this document, marked "unstamped, mixed versions, n = 12".
- Every proportion is reported with its Wilson 95% interval. Under n = 30 the report prints "small sample: direction only, no conclusion".
- Two versions are called different only when their intervals do not overlap, or with a paired test on the same items in a replay (McNemar on right and wrong pairs). With today's counts neither will be possible for some weeks. Say that in the report instead of a claim.
- Rough size guide: to show 0.55 against chance 0.33 with a 95% interval that excludes chance needs about 25 to 30 triplets; to tell 0.50 from 0.60 between two versions needs several hundred. At 3 triplets for each batch and one batch each day, the first is about 10 days of practice; the second is not reachable soon. So: use calibration to catch large failures and regressions, not to rank small prompt changes.

### 4.9 Regression checks and stability

| Check | Method | Alarm |
|---|---|---|
| Concept ranking stability | Run the concept review twice in two fresh contexts on the same batch (or on the fixed fixture set of 2.12), without saving a pick. Compare the selected sets. | Fewer than 2 of 3 selected concepts in common, or a gate found in one run and not in the other |
| Fixture check | The fixture set with 2 gate breaks and the set with 0 strong concepts (2.12) | A gate break is selected; or the weak set is not sent to rework |
| Score spread | Share of scores that are 4 or 5 in a review | Over 0.8: the scale is not used |
| Position bias | 4.6 | One position over 0.5 with n of 20 or more |
| Draft-pick agreement by stamp | 4.2 | No alarm value at small n. Print both stamps with n and the intervals. |
| Product defect and waste | 4.2 | A rise for 3 batches in a row after a change to the direction contract |

The stability runs cost tokens only. Their rows go to `calibration_runs` with kind `concept_stability`.

### 4.10 Canon change tests and rollback criteria

A canon change that touches the critic (a rule that the critic reads) follows the learn flow that exists (`worker/prompts.ts:97`, `canonUpdate` at `worker/canon.ts:71-138`), with these additions:

1. Before the change: run the fixture check and, if the tuning split has 15 items or more, a triplet replay on the tuning split. Save the rows.
2. Make the change. Run the same again. Save the rows with the new canon log id.
3. Keep the change when: the fixture check passes; the text gold score does not fall by more than the existing rule allows; the replay agreement on the tuning split does not fall by more than 2 items (at small n a fall of 1 or 2 items is noise; more is a signal).
4. Run the holdout only once for each change, after the decision to keep, and report it. Do not tune on it.
5. **Roll back** (the canon undo that exists) when: a fixture gate break is selected; or the weak set is accepted; or the next 5 prospective triplets after the change have the owner's pick at rank 3 in 4 or more; or the owner says the critic's reasons got worse. Record the rollback and its reason in the canon log.
6. Each canon rule should name its origin (the owner's words and the item). Scopes for canon rules (brand, product, global) are Phase 5.

For code and plugin changes: the same fixture check before the pull request merges; the report after the next 3 batches.

### 4.11 Test cases

| # | Test | Expected |
|---|---|---|
| 4.1 | `batch_get` and the API for an undecided idea with ranks saved | No `rank`, no `reason`; `ranked: true` |
| 4.2 | After `picks_save` for that idea; after a full pass | Rank and reason present |
| 4.3 | `drafts_rank` writes a `rank_context` record | Record has canon log id and prompt version |
| 4.4 | `calibration_report` on a fixture database with 4 decided sets (ranks 1, 2, 2, 3) | Agreement 0.25, MRR 0.583, n = 4, small-sample text, Wilson interval present |
| 4.5 | Report by engine and stamp | Two groups, not one number |
| 4.6 | `calibration_items` without labels | No pick, no verdict, no owner words, no rank in the answer |
| 4.7 | An item with a missing R2 picture | Not in the set; counted as lost |
| 4.8 | `taste_log before` | No row at or after the date |
| 4.9 | Copy correction rate fixture (2 of 3 changed) | 0.67 |
| 4.10 | Paid waste fixture | Matches a hand-computed value |
| 4.11 | The critic subagent's tool list | Does not contain the labelled items tool |

### 4.12 Acceptance criteria

1. The critic can reject a weak concept before a paid render, and its reasons are saved (from Phase 2).
2. The critic's rank cannot reach the owner or the main session before the owner's decision (4.3).
3. The system records agreement with the owner's choices by version (4.2, 4.4).
4. Every report has `n` and an interval and makes no claim from a small sample.
5. Concept quality and render quality are separate numbers (concept review against draft and final checks).
6. The text gold set is never reported as a visual result.

### 4.13 Open decisions and risks

| # | Decision | Default | Who |
|---|---|---|---|
| OD 4.1 | Holdout share and date | Newest 30% by time | Implementation session; tell the owner |
| OD 4.2 | Is the replay worth its tokens at n under 20? | Run the fixture and stability checks now; start replays at 15 tuning items | Owner (token cost) |
| OD 4.3 | Filter for the text gold set | Packaged F&B items only as a second score beside the full score | Owner |
| OD 4.4 | Show the critic's rank to the owner after his pick? | Yes, as today on the board | Owner |

| Risk | Control |
|---|---|
| The critic is tuned to agree with the owner and stops finding better work than he expects | Agreement is read with pass rate and client results; the critic's reasons are saved; the owner sees them after his pick. |
| Contaminated replays look like progress | The mark in every row; the primary measure is prospective. |
| Small n leads to changes from noise | Intervals; the 2-item rule; no ranking of small prompt changes. |
| Lost pictures in R2 shrink the set | Count first (U2). Do not delete renders of decided sets. |
| More tools and records add work for each batch | The report is read only; stamps are written by the server; the replay is optional. |

---

## 5. What this pack does not design

- Phase 5 (learning stores, canon scopes, a lasting product entity), Phase 6 (board and application), Phase 7 (comparison and rollout). P0 §9, §17 give the facts for them.
- Any change to `ai-ad-generator`.
- Any change to packs that exist. Packs v1 to v4 of W47 stay; the v3 link stays live and unchanged.
- Final wording of prompts and subagent files. The contracts here give the content; the implementation session writes the text and the owner can change it.

## 6. All open decisions for the owner in one place

**Status: decided on 17-11-2026 SGT. The decisions table at the end of this section is the authority. The first table is history: the questions and the defaults before the owner decided.**

| # | Question | Default used |
|---|---|---|
| C1 / OD 2.1 | Best three concepts with free funnel roles, and 6 to 15 concepts in place of 24 to 30 ideas? | Yes (v3 is newer) |
| C2 | Keep the copy review before renders? | Yes |
| C3 / OD 3.3 | Sentence case as text; case on the picture by type taste? | Yes |
| C4 / OD 2.5 | Sublines that are a second beat, and headline-only ads with your word? | Yes |
| C5 / OD 3.1 | Look follows the concept, inside the calm rules; house recipe as fallback? | Yes |
| C6 / OD 3.2 | Redo a failed draft once so that you see 3 good ones? | Yes |
| C7 | Only a pointer in `AGENTS.md` now; full document updates as phases ship? | Yes |
| C8 / OD 2.6 | Packaged F&B only for now? | Yes |
| OD 1.2 | Do you want to approve the brief before concepts? | No; you get 5 lines |
| Migration 0015 | One live database change for Phases 1 to 4 | Needs your yes when the file is tested |

**Owner decisions, 17-11-2026 SGT.** The owner answered all eight. They are in `docs/decisions.md`. Where a line below differs from a default in this document, the line below wins.

| # | Decision |
|---|---|
| C1 | V3: 6 to 15 deeper concepts; the best 3 win, from any funnel stage. |
| C2 | The copy review stays. The owner approves the words before any picture. |
| C3 | Headlines can be in capitals on the picture when the type suits it. |
| C4 | A subline that is not a fact is allowed. It never states a claim that is not verified. |
| C5 | A new look for each concept. The house recipe (calm and plain) is the fallback when the owner says that the output is not up to standard. The art director can propose the fallback; it does not choose it alone. The owner's exact words are saved in the direction record (design pack 3.4). |
| C6 | A failed draft is made again once, so that the owner sees 3 good drafts where possible. If the second try also fails, the owner sees the good drafts only (fewer than 3) with a saved reason (design pack 3.6). No more automatic tries. |
| C7 | A pointer only now. Each document changes as its part is built. When all of v3 is built and works well, all documents are rewritten to describe the live tool. The exception is `docs/a11-engine-v3.md`: it is the owner's text and is never edited. |
| C8 | The target stays "F&B and wellness": F&B brands with packaged food or drinks, and all wellness brands except service-based wellness businesses with no packaged product. |

These decisions apply to engine 3. The live batch flow does not change until the engine 3 units are merged.
