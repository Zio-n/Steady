# Ingredient cost coverage review

**Status: shelved research, 31 October 2026.** Local UK estimates and generic-food links remain in the development database under the private `steady_research` schema and in historical migrations. No cost feature is connected to the running app or required for the current meal builder. This sample is not a claim that every catalogue food has a price.

## What is in the local database

- **179 UK price estimates** from the ONS September 2026 shopping-price workbook: every priced non-alcohol grocery row in that workbook. One grocery row with no published price is omitted. Estimates are normalized to 100 g, 100 ml, or one item and retain package size, package price, month, source, licence, and attribution.
- **55 reviewed links** from generic CoFID/USDA foods to **53 distinct cost keys**: 33 direct and 22 approximate after the purchased-weight correction for bananas. A key may link to multiple generic forms. Approximate matches are explicit; they should be displayed as estimates, not exact product prices.
- No branded Open Food Facts rows are linked. Cost data lives in Steady-owned tables, separately from licensed catalogue records.

## Small recipe benchmark

This deliberately varied, hand-authored sample checks whether common recipe ingredients can find a reviewed generic-food link. An ingredient counts as covered only if a generic food has a reviewed cost-key link. It is not based on user search logs or a claim about all diets and cuisines.

| Example recipe | Linked ingredients | Total ingredients | Coverage |
| --- | ---: | ---: | ---: |
| Porridge with fruit and honey | 3 | 4 | 75% |
| Chicken tomato pasta | 5 | 6 | 83% |
| Egg fried rice | 4 | 5 | 80% |
| Salmon, potatoes and broccoli | 4 | 4 | 100% |
| Chickpea curry and rice | 5 | 6 | 83% |
| Tuna sandwich | 4 | 5 | 80% |
| Vegetable omelette | 4 | 5 | 80% |
| Yoghurt and fruit bowl | 4 | 4 | 100% |
| **Total ingredient occurrences** | **35** | **39** | **90%** |

Of the 35 linked occurrences, 22 use direct links and 13 use approximate links. The 90% figure measures only whether a reviewed link exists. It does **not** measure whether the recipe amount can be priced: 12 of the 55 links have a food record measured in grams and an ONS price measured per item or per millilitre. These need a verified serving or density conversion when the recipe uses grams. The sample is also optimistic: the recipes were selected for a quick sanity check and do not represent actual user behaviour, cuisine-specific ingredients, dietary patterns, branded products, or regional price differences.

## Known gaps exposed by this sample

- Fresh garlic, soy sauce, and spinach have generic catalogue foods but no suitable ONS cost key in this seed.
- Many additional common foods still have no reviewed cost link, including plain/Greek yoghurt, lentils, tofu, fresh herbs, stock, spices, lemons/limes, and plain flour.
- An approximate link such as canned chickpeas to a broad canned-beans estimate or free-range ONS eggs to a generic egg record is not the exact price for every variant.
- A food identity match does not establish a usable quantity conversion. Whole-item prices for lettuce, cucumber, peppers, cauliflower, eggs, and crumpets cannot price a gram-based recipe amount without a verified item weight. Milk, oat milk, mayonnaise, and olive oil need a verified density or a millilitre amount when the recipe is recorded in grams.
- The ONS banana price uses purchased weight, while the CoFID banana record uses edible flesh. Its link is approximate until an edible-yield adjustment is applied.
- Prices are UK national average estimates for a stated month and package category, not a shop quote. Converting GBP to another currency does not make them local prices.

## Conditions if revisited

The cost feature is parked in Steady's Notion [Later Ideas — Parking Lot](https://app.notion.com/p/403dc7f9b1cb810db3b1fb080a653171). If revisited, use reviewed source-ID links only. A link yields a calculated cost only when the recipe quantity matches the price unit or has a verified conversion. Otherwise show cost as unavailable; keep the author's ingredient-level cost override optional.

The current crosswalk is too sparse and its unit gaps are too common to justify automatic bulk matching. A later implementation could add optional estimates as new global foods are curated, with ingredient-level author edits. A missing cost would leave the recipe total explicitly incomplete.

If broader coverage becomes valuable later, run one **offline** candidate pilot: propose links from normalized food names, source aliases, food form, preparation, and ONS category. A small model may rank ambiguous candidates for internal review, but should not publish matches or run during logging. Review a random, source-diverse sample of at least 200 proposed links. Continue automatic link generation only if at least 95% are reasonable rough-cost associations and no unsupported unit conversion is used. Measure separately how many ingredients in a larger cuisine-diverse recipe sample can actually be priced. If the pilot misses this quality bar or the extra coverage is not useful, keep the future-addition approach.

Any new estimate needs a suitable source, date, market, and licence. Keep the direct/approximate distinction and report missing-price rates rather than treating unknown cost as zero.

## Source

ONS Shopping Prices Comparison Tool, September 2026 data workbook. ONS says the tool covers a selected basket of everyday goods and services; the averages are not the average of every possible shop price. The source is released under the Open Government Licence v3.0. [ONS tool and methodology](https://www.ons.gov.uk/economy/inflationandpriceindices/articles/shoppingpricescomparisontool/latest).
