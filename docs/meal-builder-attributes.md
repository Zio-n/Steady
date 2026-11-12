# Food grouping and meal logging

**Updated:** 8 November 2026. Food grouping is retained functionality. This is the current grouping contract, not a recipe-authoring specification.

A food has a nutrient basis and supported quantity units. A saved meal is a private reusable group of food components and amounts. A dated meal occurrence captures what was planned or eaten; it is not automatically a saved Library group.

## Existing behaviour to retain

- Search private foods and the source-labelled catalogue, adjust amounts, and assemble one or more foods.
- Save/reuse a named food group without instructions, yield, cooking effort, finished weight or publication setup.
- Calculate group nutrition from components and quantities. Missing component nutrients make the relevant total incomplete; they do not become zero.
- Calendar multi-item saves are atomic and share an occurrence group ID. A saved Library meal logs its calculated nutrition as an entry; it does not expose or publish a reusable definition.
- Capture eaten nutrition independently of future food/group edits. Edit one occurrence's food snapshot without changing the saved definition or other dates.
- Keep retry identity, revision rejection, account ownership and unsaved-edit guards intact.

## Follow-on design

Persistent nutrient preferences should determine the details shown throughout choosing, editing and summarising. Close-match edits should become reusable private variants without a forced rename. Meal-group reuse should fit the same search → adjust → add flow. These improvements follow the Phase 0 gate; no new recipe authoring is included.

See the [data contract](rebuild-data-contract.md) and [implementation plan](product-reset-and-semi-rebuild-plan.md).
