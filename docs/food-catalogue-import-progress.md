# Food catalogue import and quality review

**Updated:** 30 October 2026 · **Database:** local Supabase development database; no hosted database was changed.

## Catalogue totals

| Source | Records | Usable* | Incomplete* | Energy | Protein | Portion records |
|---|---:|---:|---:|---:|---:|---:|
| CoFID 2021 | 2,886 | 2,853 | 33 | 2,853 | 2,886 | 0 |
| Open Food Facts | 909,447 | 886,008 | 23,439 | 896,435 | 897,761 | 642,333 |
| USDA FNDDS | 5,432 | 5,431 | 1 | 5,431 | 5,431 | 22,045 |
| USDA Foundation Foods | 424 | 374 | 50 | 374 | 407 | 298 |
| **Total** | **918,189** | **894,666** | **23,523** | — | — | **664,676** |

\*Source-level status rules differ: CoFID and USDA mark records usable when energy is present; Open Food Facts requires both energy and protein. “Usable” is an import flag, not a claim that every nutrient is complete or every product is the correct search match.

## Quality review findings

- **Generic nutrient import repaired.** CoFID values were stored as text, and its importer had treated non-nutrient food factors as nutrients. It now parses numeric strings, records trace values separately, maps common nutrients, and excludes fatty-acid ratios measured per 100 g of fat. FNDDS nutrient IDs are matched by the source's nutrient number. CoFID has 2,853 foods with energy, 2,886 with protein, 1,547 with fibre, and 31 alcoholic drinks on the published per-100-ml basis.
- **Units and implausible values cleaned for core nutrients.** Recognized Open Food Facts core units were converted to the catalogue unit. 4,679 common nutrient rows with unusable unit labels and 41,642 clearly out-of-range common values were removed. No core-unit mismatches or over-limit core values remain. Open Food Facts rows now marked incomplete when energy or protein is missing.
- **Supplemental nutrient units still need work.** 295,510 Open Food Facts values outside the core set have a `source_unit` that differs from the single nutrient definition's `standard_unit`. The row-level source unit is retained; these optional micronutrients must be displayed with that row's unit or normalized before being used in calculations.
- **Portions are uneven.** Portion data exists for 642,332 Open Food Facts products, 5,395 FNDDS foods, and 291 Foundation Foods. CoFID has no portion records, so its generic foods currently require a weight/volume amount rather than a household portion.
- **No duplicate barcodes found** within a source in the imported catalogue. One FNDDS item currently has no nutrient rows.
- **UK branded coverage is very low.** Only 14 imported Open Food Facts products retain the `en:united-kingdom` tag. CoFID supplies 2,886 UK generic foods, but the initial UK retailer-brand queries were mostly absent. The Open Food Facts import currently requires energy data, which excludes many tagged products.
- **Global presence is broad, but search quality is unproven.** A simple all-token check found results for generic and international queries such as banana, porridge oats, tofu, sushi, kimchi, tortilla, and mango. It found Heinz baked beans and Quaker oats, but no matches for Tesco Greek-style yogurt, Warburtons seeded bread, Alpro unsweetened soya, or chicken tikka ready meal. This check measures candidate presence only: catalogue search is not integrated into the app, and ranking, real-world coverage, and latency have not been benchmarked.

## Overall assessment

The current local catalogue is large and global, and the generic nutrient import is now substantially healthier. It is **not yet sufficient to claim users will rarely need Add Food**: UK branded products are sparsely represented, CoFID lacks portions, optional micronutrient units are mixed, and the app does not yet search this catalogue. The agreed 500-item, frequency-weighted coverage benchmark has not been run because real user food logs/searches are not available in the project.

## Import tooling and provenance

- Schema: `supabase/migrations/20261030120000_food_catalogue.sql`.
- Importers: `scripts/import-food-catalogue.py` (CoFID), `scripts/import-usda-foods.py` (FNDDS/Foundation), and `scripts/import-openfoodfacts.py` (global Open Food Facts).
- Open Food Facts source archive: `/Users/zion/TemporaryDownloads/openfoodfacts-products.jsonl.gz`; streamed directly without extraction. The source provides 4,884,059 product rows; the catalogue retains rows that pass the importer’s name and energy-data filters.
- Open Food Facts records remain separate by `source_id`; source/licence details are stored in `catalog_sources`. The source is ODbL 1.0. The hosted database has not been updated.

## Recommended next work

1. Improve Open Food Facts UK coverage and retain products with useful partial nutrients as `incomplete`, while ranking complete calorie/protein matches first.
2. Normalize or unit-scope optional micronutrients before exposing them in nutrition calculations.
3. Add verified default portions for common CoFID foods where a credible source exists.
4. Connect catalogue search to the app, implement useful name/brand/token ranking, and rerun the smoke benchmark. Then benchmark at least 500 real target-user items before claiming Add Food will be rare.
