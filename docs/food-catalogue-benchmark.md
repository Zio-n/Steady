# Food catalogue decision and benchmark

**Date:** 28 October 2026  
**Status:** Open-data mix imported and an initial local data-quality review completed. Coverage is not validated for scale; the product coverage requirement still needs a representative benchmark and a source decision if the open mix fails.

## Decision

Do not make a paid API, barcode scan, AI lookup, or a single generic nutrient table the food-search foundation. Keep private foods and personal corrections account-owned. Add a separate, indexed catalogue read model with source and licence metadata. The first candidate combines a current, broadly filtered Open Food Facts bulk export with CoFID and measured USDA Foundation/FNDDS generic supplements. Search locally over that index; do not call a remote search endpoint on each keystroke. Do not claim production-level coverage until the representative benchmark passes.

Open Food Facts is the best candidate for packaged UK labels because its product catalogue is user-contributed and has product identifiers, ingredients and label nutrition. It is not a nutrition authority: every record must show missing values, basis, brand and source, and the selected values remain editable in a private copy. Its API documentation caps searches at 10 requests per minute per IP and explicitly says not to use search-as-you-type. Bulk use should use a download. The data is ODbL; attribution and share-alike obligations need to be carried through any distributed database or derived database. Keep this source isolated from CoFID/USDA records and do not blend its records into private foods.

CoFID is the UK generic-food reference layer, not the branded grocery catalogue. The government page provides the 2021 spreadsheet and a separate old-foods spreadsheet; the guide says values are generally per 100 g, with alcoholic beverages per 100 ml. USDA FoodData Central is a useful public-domain generic supplement (CC0), but Foundation and FNDDS are not a substitute for UK supermarket coverage. USDA branded records may help with international products, but they are not a UK coverage guarantee. Do not import the multi-gigabyte branded dump without a measured reason.

## Operational shape

1. Preserve a small source adapter for each dataset. Store source ID, source name, source revision, licence, source URL, import timestamp, label basis, and nullable nutrients with every catalogue record.
2. Normalize into a separate catalogue table/index. Never change RLS on `foods` to expose one user's records to another.
3. Rank exact normalized name/brand and prefix matches first, then token matches. Use ordinary indexed text matching; no AI ranking or enrichment.
4. Require a human to choose a result. The user may copy it into their account, correct name/brand, kcal, protein and basis quickly, and save that as a private override. Keep source attribution and original values with the copy. An override never changes the shared catalogue or an old eaten snapshot.
5. Ship no barcode flow. A barcode can be a later shortcut to the same catalogue lookup if observed search failures justify it.

## Small search smoke test

Use these 12 exact queries and save the candidate results, ranks and missing-field notes in a checked-in benchmark file:

| Query | Expected type |
| --- | --- |
| semi-skimmed milk | Generic, UK staple |
| porridge oats | Generic, UK staple |
| raw chicken breast | Generic, preparation-specific |
| banana | Generic, edible portion |
| mature cheddar | Generic, UK staple |
| Heinz baked beans | Branded |
| Tesco Greek style yogurt | Branded, retailer |
| Warburtons seeded bread | Branded, variant |
| Alpro unsweetened soya | Branded, variant |
| Quaker oats | Branded, product family |
| high protein strawberry yogurt | Ambiguous branded/variant |
| chicken tikka ready meal | Ambiguous branded/serving |

For every query, record whether a useful result appears in the top five, exactness, brand/variant correctness, kcal and protein availability, nutrition basis, and whether a quick personal correction is possible. The smoke check expects at least 10/12 useful top-five results, at least 4/6 branded queries returning a matching UK brand/variant, and kcal plus protein basis visible for every result presented as a good match. Unknown must remain unknown; do not treat missing as zero. Search should return within 250 ms on the intended hosted database under the expected catalogue size. Re-run this check after each import refresh. Passing it is not a release decision; the representative coverage gate below governs that.

## What is known and what is not

- The source documentation supports the dataset suitability and API constraints above.
- A small local catalogue presence check has now been run and is recorded below. It checks whether query words occur in product name/brand fields; it does not measure ranking, correct variant selection, search latency, or frequency-weighted logging success.
- Open Food Facts' upstream search was not used for a live quality benchmark because it is rate-limited and unsuitable for typing; benchmark the downloaded local index instead.
- Before any public deployment, verify the current dataset licence notices, attribution text, share-alike implications, import terms, and database/storage cost. The current user decision avoids paid food-data vendors; a paid feed needs a separate product decision if the free mix fails. Any normal app-hosting spend still needs a measured estimate before deployment.

## Initial local presence check (30 October 2026)

The check used token-presence matching against the imported local catalogue, with tokens allowed across both product name and brand. It was a data-availability probe, not a simulation of the final ranked search. The catalogue is not yet connected to the app's food search.

| Query group | Results observed | What this says |
|---|---|---|
| Generic staples: banana, porridge oats, raw chicken breast, mature cheddar, semi-skimmed milk | All had candidates | Basic food concepts are represented, but the quick check showed noisy candidates for word-order variants such as semi-skimmed milk. Ranking still needs work. |
| UK branded: Heinz baked beans, Tesco Greek-style yogurt, Warburtons seeded bread, Alpro unsweetened soya, Quaker oats | Heinz and Quaker had matches; the other three had none | Current UK branded coverage is inadequate for the intended launch market. |
| Ambiguous/meal: high-protein strawberry yogurt, chicken tikka ready meal | Two yogurt candidates; no tikka ready-meal candidate | Variant and ready-meal coverage has clear gaps. |
| International: tofu, sushi, kimchi, tortilla, mango | All had candidates | The global product archive adds broad international examples; this alone does not establish market coverage. |

Database checks found 918,189 records total. CoFID nutrient parsing and USDA FNDDS nutrient-number matching were corrected and re-imported. Open Food Facts common nutrient units were normalized; malformed and out-of-range common values were removed. No duplicate barcodes were found within a source. CoFID has no portion records. Some optional Open Food Facts micronutrients still use mixed row-level units, and only 14 imported Open Food Facts products are tagged for the UK.

**Assessment:** the current dataset is useful as a global starting catalogue, but it does not establish that custom Add Food will be rare. UK branded coverage, portions for CoFID generics, remaining micronutrient units, and actual search ranking are outstanding gaps.

## Product goal: manual Add Food should be exceptional

**User direction (30 October 2026):** keep the custom Add Food flow as a safety net, but make the food database large and diverse enough that ordinary users rarely, if ever, need it.

**Assessment:** the initial local presence check does not establish this goal. Several UK branded and meal queries have no candidate, and it does not represent enough restaurant/takeaway, regional, newly launched, or personally prepared foods. Source record counts do not measure useful matches with correct variant, kcal/protein, basis, and usable portion. The 12-query smoke gate remains a proposed next check against an integrated, ranked catalogue search.

This is a **catalogue acquisition and maintenance problem**, not primarily a search-screen problem. The NHS Food Scanner's 2026 request for information describes hundreds of thousands of UK FMCG products and 25–30% annual product churn. An Open Food Facts presentation counted 152,952 UK-tagged products in April 2025, but that is neither a count of usable nutrition records nor directly comparable with all market products. Together these are evidence that a UK-only Open Food Facts snapshot cannot be assumed to deliver near-universal current branded coverage. CoFID and USDA generic datasets do not close branded retailer gaps.

**Source strategy:** build the open core first from a current Open Food Facts bulk export (UK relevance, with global records retained where useful), CoFID UK generics, and measured USDA generic supplements. Preserve exact source and licence boundaries. Deduplicate by barcode where appropriate, but retain distinct brand, flavour, size, preparation and nutrition variants. Refresh changes continuously, re-evaluate stale records, and track source age. Do not infer nutrition from a similar product or treat missing nutrient values as zero.

### Make generic foods a first-class catalogue layer

Build a carefully chosen UK-first set of common ingredients and ordinary foods from CoFID, supplemented where measured gaps justify USDA Foundation/FNDDS records. Give each entry familiar names and search aliases. Preserve materially different forms as distinct entries: raw/cooked, drained/undrained, with/without skin or bone, fat percentage, sweetened/unsweetened, and preparation method where those change nutrition. Store nutrients per known weight or volume basis, edible portion, source, source date, and only verified portion conversions such as a weighed serving or household measure. Generic entries should cover staples, home cooking and recipe ingredients especially well; a broad generic label must not imply that all branded versions have the same nutrition.

Allow a selected generic or branded catalogue food to become an editable **personal version**. The user can change nutrients, name, brand, preparation, serving size and other relevant attributes without re-entering the food from scratch. Keep the source record and the user's version distinct; edits to either must never rewrite past logged snapshots. Independently entered corrections can be proposed to a reviewed shared catalogue later, with deduplication, provenance and licence checks. Do not propagate a user's guessed nutrition to everyone.

The current private-food model already supports a nutrient basis, grams per serving, default portion, calories and additional nutrient values. The shared generic layer still needs source identity, aliases, preparation/form distinctions, multiple verified portions, provenance and a correction/version path. Make these catalogue capabilities explicit before importing a large number of generic rows.

### Proposed data model: shared food, personal food, meal use

Keep three distinct scopes so an edit cannot accidentally change the shared food or another meal:

1. **Shared catalogue (`catalog_foods`)** — one row per source product or generic food variant, with a stable ID, canonical name, source/source-record ID, data type (generic or branded), country/locale, brand and barcode when relevant, category, preparation/form, nutrient basis, known serving conversions, source dates, and licence/provenance. Keep searchable aliases, portions, and nutrients in child tables (`catalog_food_aliases`, `catalog_food_portions`, `catalog_food_nutrients`) so each can have multiple values and source metadata. Each nutrition value is nullable, typed by a standard nutrient key and unit, and records its basis and origin; unknown stays unknown.
2. **Personal food (`user_foods`)** — account-owned standalone foods or private variants linked optionally to `catalog_foods`. Store only user-specific attribute overrides and nutrient overrides, plus the user's preferred name/portion. Resolve the effective food as shared base plus the user's overrides. A new independent food has no catalogue link. A personal variant always records its base food and creator/creation time; it never writes back to the shared row. Keep an audit/version history when a user changes a saved variant.
3. **Meal use (`meal_components`)** — references a personal food or shared food, quantity/unit, position, and meal-specific attribute/nutrient overrides. This lets a person use “plain Greek yogurt” generally but set a different amount or nutrient/ingredient assumption for one saved recipe without changing their reusable food. Provide an explicit “save as my food variant” action that copies the resolved meal component into a new `user_foods` row, linked to its base and originating meal/component. Later edits to that saved variant do not rewrite the meal or past logs.

When logging food or a meal, copy the resolved names, portion, basis, nutrients, and source/version references into the existing immutable eaten snapshot. Later catalogue refreshes or edits to a personal variant must not change historical intake. If a planned item should follow a user's current saved food, resolve it when logging; once eaten, freeze its snapshot.

**Standard shared food attributes:** stable ID; canonical/display name and aliases; generic/branded type; brand; category; country/locale; raw/cooked and other preparation/form state; ingredients/allergens when supplied and licensed; barcode/GTIN and package size for branded products; nutrient values and units on a clearly declared per-100 g, per-100 ml, or explicit serving basis; edible portion where relevant; verified household/serving conversions; data source, source ID, source date, imported/updated timestamps, licence, and quality/completeness status. Optional values remain nullable. Use normalized nutrient keys and controlled units; do not make kcal, sodium/salt, serving size or raw/cooked state ambiguous. Put genuinely source-specific extras in metadata rather than adding unstructured columns for every supplier field.

**Private attributes:** user label/alias, preferred portion, corrected nutrient values, personal preparation notes and user-added fields. **Meal-specific attributes:** ingredient amount/unit, preparation/cooking state, optional component name/notes, and explicit nutrition overrides. Keep the three override sets sparse; do not duplicate the whole shared food unless the user intentionally creates an independent variant.

The current schema has `foods`, `food_nutrients`, `meals` and `meal_components`, and its save/log code is scoped to account-owned foods. The shared catalogue therefore needs its own tables and access policies, plus an explicit reference strategy from meal components to either a shared food or a personal food. This model is a proposal for the catalogue rebuild, not a claim that these shared tables already exist.

If the open core fails the representative coverage gate, identify the missing categories and assess a licensed UK branded feed, such as NIQ Brandbank, against its incremental usable matches, update cadence, redistribution terms and total cost. This is a **decision point**, not authorization to buy data: the current product decision avoids paid food-data services. A claim that both strict free-only sourcing and near-universal UK branded coverage are assured would be unsupported. Do not quietly weaken the coverage goal to keep the source plan intact. An opt-in, reviewed Steady community catalogue can address independently entered long-tail foods over time, but must not be counted as launch coverage and must remain separate from imported licensed data.

Keep manual Add Food as a reliable fallback. Aim to make it uncommon through the shared catalogue, private corrected copies, recent foods/meals, and recipe reuse. A near match should lead to a quick private correction rather than a full blank form. Do not assume USDA branded data covers UK retailers. Additional sources must have usable licences and provenance, and each must prove incremental coverage on the benchmark before import.

Before claiming this goal is met, run a benchmark of at least 500 real target-user items drawn from food diaries and shopping lists, across multiple households and retailers. Stratify generic ingredients, UK supermarket brands/variants, international products, restaurant/takeaway, and homemade foods; record misses separately by stratum. Hold out a portion of the sample from tuning. Record both distinct-item coverage and frequency-weighted logging coverage. Count a hit only when the exact product or a nutritionally credible generic can be logged with correct kcal/protein basis and known portion conversion, with at most a quick personal correction. Do not count a wrong flavour, preparation, pack size or nutrient basis as a hit. Measure full Add Food use **and** how often users must correct nutrients or attributes before logging; a low Add Food rate caused by frequent manual correction is not success. A proposed release target for the full Add Food flow is under 2% of frequency-weighted logging events in the representative sample; this is an aspiration to measure, not a claim the present sources achieve it. Track the actual share after launch, especially for first-time searches. The 12-query gate is only a smoke test.

For each import report total records, UK-relevant records, records with usable kcal/protein and basis, current records, unique branded variants, duplicate/conflicting records, and incremental benchmark matches over the previous sources. Publish the source-level miss list and reasons before changing the source mix. A million raw rows is not a success metric.

## Search and UI gate for scale

The current Add Choice picker loads every account-owned food and meal on opening, then filters and ranks them in the browser. The Library search also reads account-owned foods only. These implementations cannot simply be pointed at a large shared catalogue. Catalogue search must use a bounded, indexed server query; no full-catalogue fetch to the browser.

The logging flow should show recent/personal choices immediately, then search personal foods and the shared catalogue in one field. Rank exact brand and variant before close generic matches. Every result needs name, brand, source, nutrition basis, kcal/protein availability and a usable default portion; distinguish a source record from a personal corrected copy. Selecting a result goes to a short portion review with a direct log action. A near match goes to a quick private correction, not the full blank Add Food form. Keep Add Food reachable even when search returns imperfect matches.

At scale, measure more than catalogue row count: first-time distinct-item resolution, frequency-weighted logging resolution, wrong-variant selection, full Add Food rate, search latency at realistic concurrent load, import/update freshness, and storage cost. A low full Add Food rate produced only by repeatedly logging the same few foods is not proof of broad catalogue coverage. Resolve source duplicates and stale products without hiding the exact brand/variant the user needs.

## Sources

## Attribution and licensing note

**User direction (30 October 2026):** include a Food Data Sources & Licences page in Steady, similar to a copyright/credits page. List each imported dataset and link to its licence. For Open Food Facts, also provide the machine-readable derived data or a file describing Steady's changes when ODbL requires it. Keep Open Food Facts records identifiable and separable from CoFID, USDA and users' private foods. This is a data-licensing obligation; it does not require publishing Steady's application source code. Do not import Open Food Facts product images as part of the food-data import; they have separate rights.

- [Open Food Facts API documentation](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/)
- [CoFID 2021 on GOV.UK](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid)
- [CoFID user guide](https://assets.publishing.service.gov.uk/media/60538e66d3bf7f03249bac58/McCance_and_Widdowsons_Composition_of_Foods_integrated_dataset_2021.pdf)
- [USDA FoodData Central datasets](https://fdc.nal.usda.gov/download-datasets/)
- [USDA FoodData Central API guide and licence](https://fdc.nal.usda.gov/api-guide/)
- [USDA Global Branded Food Products Database documentation](https://fdc.nal.usda.gov/GBFPD_Documentation/)
- [Open Food Facts 2025 data presentation](https://blog.openfoodfacts.org/wp-content/uploads/2025/05/Webinar-Open-Food-Facts-Science.pdf)
- [UK Department of Health and Social Care, NHS Food Scanner database request for information](https://www.contractsfinder.service.gov.uk/Notice/Attachment/cb4a537a-d348-46cf-8830-48825bd1a154)
- [NIQ Brandbank content licensing](https://nielseniq.com/global/en/products/content-licensing/)
