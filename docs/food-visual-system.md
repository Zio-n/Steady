# Steady food visual language

Status: visual direction and AI classification approach agreed on 30 October 2026. Implementation and provider selection remain open.

## Agreed approach

- Use AI to choose from Steady's fixed visual types for catalog foods and foods users add. Generate the artwork programmatically from that choice; do not use AI image generation.
- Classify catalog foods in bulk before they enter the database. Classify a user-added food when it is saved, then store the result so viewing it does not trigger another model call.
- Pilot TypeSafe Jev first because this is a fixed-choice decision. Compare it with Gemini 2.5 Flash-Lite on representative Steady food names before selecting the production provider.
- Keep the food form free of category controls. If classification is uncertain or unavailable, use the neutral named visual.

## Agreed presentation

- **Food item:** show a recognizable specific form when Steady has one. Otherwise use a generic form appropriate to the food type (for example, a dairy vessel, grain container, or produce form). If the type cannot be identified confidently, use a polished neutral form with the exact food name on or beside it. Do not make every food use the same generic visual, and never require the user to select or correct a visual category.
- **Meal:** show a finished, ready-to-eat dish on a serving tray. Its food should be assembled and deliberately plated, rather than displayed as separate ingredient packages or loose category symbols. Choose a serving template suited to the dish, such as a bowl, plate, sandwich, wrap, or soup vessel.
- **Recipe:** show *all* ingredients being prepared on a kitchen counter or shared prep board. Use a natural mise en place composition: a main ingredient or vessel anchors the scene, with smaller bowls, jars, loose produce, and appropriate utensils arranged around it. Vary sizes and spacing, keep useful breathing room, and avoid equal-sized specimen tiles or a rigid grid.

## Agreed visual language

- Use Steady's paper, sage, olive, and deep green palette, with warm countertop tones and restrained food colours. Keep the look calm, clear, and recognizably part of Steady.
- Prefer a top-down view with simple ceramic vessels, a tray or prep board, subtle surface detail, and deliberate overlaps. Food must remain the focus; supporting props establish the setting.
- Draw the visuals programmatically with reusable SVG primitives and composition templates. AI chooses visual types and serving templates only; it does not create image assets. There is no per-item image generation service or image cost.
- Food, meal, and recipe visuals are related but convey different states: one item, a dish ready to eat, and ingredients ready to prepare.

## Drawing tools

- **Production renderer:** React components that return native SVG elements (`<svg>`, `<path>`, `<ellipse>`, gradients, and groups). The project already uses React, so no illustration library or image generation service is required.
- **Composition code:** small TypeScript functions choose the SVG food parts and arrange them in food, meal-tray, or recipe-counter templates from the saved visual specification. The same input should produce the same arrangement.
- **Current study:** [generate-food-scenes.mjs](../scripts/generate-food-scenes.mjs) writes [food-scenes.svg](food-scenes.svg), showing a finished breakfast bowl on a tray and its ingredients on a prep board. `rsvg-convert` was used to render a PNG for review; it is not part of the app runtime.
- **AI classifier:** TypeSafe Jev is the first provider to pilot for choosing visual types. The provider is not yet selected for production; Gemini 2.5 Flash-Lite is the comparison candidate. Neither model draws the SVG.

## AI decision engine design

An AI decision model classifies both catalog foods and user-added foods into Steady's fixed visual vocabulary. It never generates an image. The renderer uses its answer to draw SVG shapes. The engine should return a **visual specification**, not a nutritional classification. Example:

```ts
{
  primary: 'yoghurt',
  secondary: ['blueberry'],
  presentation: 'cup',
  source: 'jev-1.14.0',
  confidence: 0.94
}
```

Recommended flow:

1. Classify catalog foods in bulk before import, store their visual specifications, and review a sample plus low-confidence results.
2. When a user saves a new food, send its name and any useful brand/description through a server-side function to the same model. Store the selected visual specification and model version with that food. Keep the save usable with a neutral visual while classification is pending or unavailable.
3. Ask for a primary visual type from a fixed choice set. A second question can choose presentation (fresh produce, bowl, jar, carton, package, prepared dish) when that improves the drawing. Avoid asking the model to invent a visual key that the renderer cannot draw.
4. Use the model's probabilities and confidence to choose a specific visual, a broader category visual, or the neutral named fallback. Calibrate thresholds against Steady food names; confidence is not guaranteed correctness.
5. Reclassify only when the food name or relevant metadata changes, or when a new model/vocabulary version is intentionally adopted. Keep the model key on the server.

Keep the vocabulary small and presentation-oriented: e.g. berries, leafy greens, grains, yoghurt, cheese, bread, poultry, fish, beverage, sauce, packaged food, prepared dish, unknown. The model can choose yoghurt as the primary visual and berries as a secondary detail for `Greek yoghurt with blueberries`. `Oat milk` should select a beverage or carton visual, not loose oats.

For meals, ask a separate fixed choice question for the serving template: bowl, plate, sandwich, wrap, soup, and so on. The recipe view lays out ingredient visuals by prep role and size around a main anchor. All layouts remain deterministic and versioned so the same saved food gets the same visual on each device. Visual decisions never alter nutrition data.

## Provider candidates

- [TypeSafe Jev](https://docs.typesafe.ai/primitives/choice): agreed first pilot for fixed visual choices. Its [published model price](https://docs.typesafe.ai/models) is $0.042 per million input tokens with free output tokens. Pin the model version for repeatable classification.
- [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite): comparison candidate with structured output and a free tier, subject to quotas and the free tier's data terms. See [pricing](https://ai.google.dev/gemini-api/docs/pricing).
- [Cloudflare Workers AI Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/): alternate Jev host worth considering if Steady already uses Cloudflare; otherwise it adds another platform.

Before choosing a provider, compare both leading models on a small labelled set of ordinary foods, branded products, combinations, regional names, and intentionally ambiguous names. Measure exact visual type accuracy, acceptable broader fallback rate, latency, and real cost.
