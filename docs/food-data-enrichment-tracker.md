# Food data enrichment tracker (temporary)

**Purpose:** Track enrichment of Steady's food catalogue and recipe attributes before implementation/publication. This is an internal progress document; do not put food rows, user data, or full source extracts in this file or the application repository.

**Current scope:** Local development catalogue and project docs only. The last recorded import is local; no hosted database or public food-data export is part of this work.

## Source import baseline

| Source | Current state | Licence/provenance handling | Enrichment boundary |
| --- | --- | --- | --- |
| CoFID 2021 | Imported locally: 2,886 generic records | Open Government Licence v3.0; retain provider/source attribution and source record IDs | Can be enriched for internal use and commercial use subject to OGL attribution/terms. Keep rows source-labelled. |
| Open Food Facts global | Imported locally: 909,447 branded records | ODbL 1.0 database; retain source IDs and attribution. Product images are excluded. | Keep OFF rows and OFF-derived corrections separable. Do not publish an enriched OFF-derived dump or expose a derivative-data feature until attribution, share-alike, and machine-readable access obligations are reviewed and implemented. |
| USDA FNDDS | Imported locally: 5,432 generic records | CC0; retain source IDs and source credit | Keep provenance; no share-alike requirement identified in the source terms. |
| USDA Foundation Foods | Imported locally: 424 generic records | CC0; retain source IDs and source credit | Keep provenance; no share-alike requirement identified in the source terms. |
| USDA SR Legacy | Imported locally: 7,793 generic records (April 2018 final release) | CC0; retain source IDs and source credit | Stable legacy composition data; use alongside newer UK CoFID rather than treating it as a current UK source. |

## Enrichment workstreams

| ID | Workstream | Status | Next action / completion evidence | Data boundary |
| --- | --- | --- | --- | --- |
| E0 | Source lineage and licensing gate | In progress | Keep `source_id`, source record ID, licence, and import revision on every imported record; review any public/API/export use before release | OFF remains a separately identifiable ODbL source. No public derived-data export is currently authorized by this tracker. |
| E1 | Normalize supplemental nutrient units | **Done locally; ambiguous units retained** | 12,322,169 OFF nutrient rows classified: 10,769,450 normalized, 130,691 retained as `source_unit_only`, and 1,422,028 scores/other attributes marked `not_a_nutrient`. Original values/units are preserved; 116,879 values are currently converted. Applied the FDA vitamin D factor of 1 IU = 0.025 µg. Precision QA restored trace amounts that would round to zero. Final read-only QA found 0 normalized-unit mismatches, 0 changed source-only values, and 0 converted positive values rounded to zero. Importer now writes provenance/status fields and applies the vitamin D rule to future imports. | Preserve OFF provenance and keep OFF changes in its source partition. Unsupported units remain out of calculations; additional conversion rules need nutrient-specific evidence. |
| E2 | Search aliases and locale names | **Partial; both pickers and copy flow implemented locally, coverage gate open** | Added 37,950 source aliases and 127 reviewed Steady UK/US generic synonyms. Search is connected to both meal building and calendar logging/planning, with indexed token-prefix search across names, brands, and aliases, locale hints, generic-first ranking, and normalized nutrient payloads. Selecting a result opens a correction form; a transaction creates a private copy with a source-origin link. Later private edits set `is_personally_adjusted`; shared rows remain untouched. A synthetic 30-query sample found candidates for 27 queries, but only 3/6 UK-branded searches and some top results use the wrong variant. Run the documented 500-query frequency-weighted quality gate when a representative query set exists. | OFF aliases and copy origins retain source lineage. Personal nutrient/name corrections stay on user-owned rows and do not become shared catalogue data. Steady synonyms remain separately marked `origin='steady'`. |
| E3 | Verified portions and conversions | **Partial; local factor enrichment and coverage audit done** | Applied 2,852 distinct CoFID food-factor records locally and verified all joins; found 54 specific-gravity records and no invalid factors. Portion coverage: OFF 642,332 foods / 642,333 gram portions; FNDDS 5,395 / 22,045; Foundation Foods 291 / 298; SR Legacy 7,533 / 14,430; CoFID 0 portions. No imported portion is marked default. Next expose sourced measures clearly and add household portions only when a source provides them. | Never infer grams from volume without a credible food-specific conversion. Do not turn edible proportion into a serving size or choose an arbitrary default portion. |
| E4 | Generic food forms and variants | **Partial; priority family audit done, SR Legacy added** | Reviewed source-attributed records and raw/cooked/preserved/fat/skin terms for oats, rice, potatoes, chicken, beef, milk, eggs, legumes, pasta, and tomatoes. CoFID, FNDDS, Foundation Foods, and SR Legacy provide distinct source-backed forms across these families. Added USDA SR Legacy April 2018: 7,793 records with energy and protein; 7,533 also have sourced portions. Generic top-match ranking still needs review for wrong preparation/form. | Keep materially different food forms as separate source records. Do not infer missing variants or combine values across different source records. |
| E5 | Allergen coverage and completeness | **Partial; source fields separated locally** | Audited all 909,447 imported Open Food Facts rows. 215,430 have `allergens_tags` (source-listed allergen tags); 14,471 have separate `traces_tags`; 217,939 retain non-empty ingredient/user evidence fields. Added `allergen_traces` and refreshed 909,445 matched products locally; 2 legacy rows absent from the archive were left untouched. CoFID/FNDDS/Foundation have no imported allergen values. No source field proves a product is allergen-free; null/empty remains unknown. | Keep contains tags, possible-trace tags, and evidence source fields distinct. Never infer allergen-free status from missing data or use AI for allergen claims. |
| E6 | Ingredient cost estimates | **Shelved; future improvement** | Local research is archived in the private `steady_research` schema: 179 dated UK ONS estimates and 55 reviewed generic-food links across 53 cost keys. App roles have no schema access. The 8-recipe sample checked link existence only; 12 links need verified unit conversions for gram-based recipes. No cost UI, matching expansion, currency conversion, or cost-specific recipe fields are in the current build. See the [research checkpoint](ingredient-cost-coverage-review.md) if this is revisited. | Keep source and licence attribution with the dormant local research. Do not treat missing cost as zero or infer incompatible units. |
| E7 | Recipe attribute suggestions | Not started | For recipe text only, let a lightweight decision model suggest prep/cook/wait times, equipment, and cleanup effort with supporting text/confidence; author can edit; cache by recipe revision | Recipe/user data stays outside the shared imported food catalogue; no invented instructions, allergens, or food-safety claims. |
| E8 | Publication and export review | Not started | Before any public catalogue API, dump, or feature exposing substantial OFF-derived data, complete an ODbL compliance review and implement required attribution/access terms; recheck other sources' attribution | Do not treat “separate tables” alone as proof that an app's public use has no ODbL obligations. |

## Licence safeguards

- Keep each imported source identifiable at row and nutrient-value level; never remove source IDs or licence provenance during normalization.
- Keep Steady-owned cost estimates, user-private corrections, AI suggestions, and authored recipe content in separate tables/scopes with explicit ownership and visibility. Do not merge them into an OFF-derived export.
- This separation supports provenance and limits accidental licensing spillover; it does **not** by itself settle the legal treatment of a public service that uses OFF-derived data.
- ODbL 1.0 permits commercial use subject to its conditions. Section 4.6 can require a machine-readable copy of a derivative database or an alterations file when publicly using a derivative database or a produced work from it. Resolve applicability and compliance before launch/public data release.
- OGL source material requires attribution under its terms. USDA FoodData Central states its data are CC0 and requests source credit.
- Do not copy OFF product images into this catalogue; image rights are separate from database rights.
- Never add raw source dumps, private user data, or enriched database exports to Git. Keep data-processing scripts and non-sensitive schemas/docs in source control.

## Status definitions

**Not started** = no enrichment action yet. **In progress** = active audit or implementation. **Partial** = source provides some records/fields but coverage is incomplete. **Done** = checked against a defined coverage/quality measure and recorded. **Shelved** = preserved research with no current build work. **Imported** means source rows exist locally; it does not mean enrichment or quality review is complete.

## Current blocker

There is no active blocker for local E1-E3 enrichment. CoFID factors have been added and checked in local Supabase; no hosted database was changed. E1 retains 130,691 source-unit-only rows pending stronger evidence. E2's main remaining gap is search coverage and exact-variant quality, especially UK-branded records; the 30-query sample is not an at-scale claim. E3's main data gap is household portions for generic CoFID foods; the workbook provides edible-yield and limited density factors, not serving sizes.

## References

- [Open Food Facts licence guidance](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/)
- [Open Database Licence 1.0, official text](https://opendatacommons.org/licenses/odbl/1-0/)
- [The National Archives: Open Government Licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)
- [USDA FoodData Central licence](https://fdc.nal.usda.gov/api-guide/)
- [Open Food Facts Product Ingredients schema](https://openfoodfacts.github.io/documentation/docs/Product-Opener/schemas/schemas/product_ingredients/) (separate allergen and traces fields)
- [UK Government allergen ingredient-list guidance](https://www.gov.uk/food-labelling-and-packaging/ingredients-list)
- [ONS Shopping prices comparison tool](https://www.ons.gov.uk/visualisations/dvc2523/shopping-prices-comparison-tool/index.html) (September 2026 average prices; OGL v3.0)
- [Ingredient cost coverage review](ingredient-cost-coverage-review.md) (179-item local baseline, reviewed generic links, and limited recipe benchmark)
- [Current catalogue quality review](food-catalogue-import-progress.md)
- [Meal builder attributes and implementation plan](meal-builder-attributes.md)
