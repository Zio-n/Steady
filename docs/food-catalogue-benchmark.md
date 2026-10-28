# Food catalogue decision and benchmark

**Date:** 28 October 2026  
**Status:** Candidate architecture selected; representative data-quality run is still required before enabling catalogue results in the product.

## Decision

Do not make a paid API, barcode scan, AI lookup, or a single generic nutrient table the food-search foundation. Keep private foods and personal corrections account-owned. Add a separate, indexed catalogue read model with source and licence metadata. The first candidate is an Open Food Facts UK branded-food snapshot, complemented by CoFID and USDA Foundation/FNDDS generic foods. Search locally over that index; do not call a remote search endpoint on each keystroke. If the source data cannot meet the quality bar below, show private foods and fast manual entry until it can.

Open Food Facts is the best candidate for packaged UK labels because its product catalogue is user-contributed and has product identifiers, ingredients and label nutrition. It is not a nutrition authority: every record must show missing values, basis, brand and source, and the selected values remain editable in a private copy. Its API documentation caps searches at 10 requests per minute per IP and explicitly says not to use search-as-you-type. Bulk use should use a download. The data is ODbL; attribution and share-alike obligations need to be carried through any distributed database or derived database. Keep this source isolated from CoFID/USDA records and do not blend its records into private foods.

CoFID is the UK generic-food reference layer, not the branded grocery catalogue. The government page provides the 2021 spreadsheet and a separate old-foods spreadsheet; the guide says values are generally per 100 g, with alcoholic beverages per 100 ml. USDA FoodData Central is a useful public-domain generic supplement (CC0), but Foundation and FNDDS are not a substitute for UK supermarket coverage. USDA branded records may help with international products, but they are not a UK coverage guarantee. Do not import the multi-gigabyte branded dump without a measured reason.

## Operational shape

1. Preserve a small source adapter for each dataset. Store source ID, source name, source revision, licence, source URL, import timestamp, label basis, and nullable nutrients with every catalogue record.
2. Normalize into a separate catalogue table/index. Never change RLS on `foods` to expose one user's records to another.
3. Rank exact normalized name/brand and prefix matches first, then token matches. Use ordinary indexed text matching; no AI ranking or enrichment.
4. Require a human to choose a result. The user may copy it into their account, correct name/brand, kcal, protein and basis quickly, and save that as a private override. Keep source attribution and original values with the copy. An override never changes the shared catalogue or an old eaten snapshot.
5. Ship no barcode flow. A barcode can be a later shortcut to the same catalogue lookup if observed search failures justify it.

## Quality gate before activation

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

For every query, record whether a useful result appears in the top five, exactness, brand/variant correctness, kcal and protein availability, nutrition basis, and whether a quick personal correction is possible. Acceptance is at least 10/12 useful top-five results, at least 4/6 branded queries returning a matching UK brand/variant, and kcal plus protein basis visible for every result presented as a good match. Unknown must remain unknown; do not treat missing as zero. Search should return within 250 ms on the intended hosted database under the expected catalogue size. Re-run the benchmark after each import refresh.

## What is known and what is not

- The source documentation supports the dataset suitability and API constraints above.
- No representative query run has yet been recorded. Therefore this is a go-ahead for an isolated adapter/import prototype, **not** a claim that either source already passes the quality gate.
- Open Food Facts' upstream search was not used for a live quality benchmark because it is rate-limited and unsuitable for typing; benchmark the downloaded local index instead.
- Before any public deployment, verify the current dataset licence notices, attribution text, share-alike implications, import terms, and database/storage cost. The user's no-paid-database instruction means this cannot introduce an additional paid data vendor or a separately billable catalogue service. Any normal app-hosting spend still needs a measured estimate before deployment.

## Sources

- [Open Food Facts API documentation](https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/)
- [CoFID 2021 on GOV.UK](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid)
- [CoFID user guide](https://assets.publishing.service.gov.uk/media/60538e66d3bf7f03249bac58/McCance_and_Widdowsons_Composition_of_Foods_integrated_dataset_2021.pdf)
- [USDA FoodData Central datasets](https://fdc.nal.usda.gov/download-datasets/)
- [USDA FoodData Central API guide and licence](https://fdc.nal.usda.gov/api-guide/)
- [USDA Global Branded Food Products Database documentation](https://fdc.nal.usda.gov/GBFPD_Documentation/)
