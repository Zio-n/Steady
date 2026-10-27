export type NutrientCreateRequest = { signature: string; fieldId: string };

export function nextNutrientCreateRequest(
  previous: NutrientCreateRequest | null,
  name: string,
  unit: string,
  createId: () => string,
): NutrientCreateRequest {
  const signature = JSON.stringify([name.trim(), unit.trim()]);
  return previous?.signature === signature ? previous : { signature, fieldId: `custom_${createId().replaceAll('-', '')}` };
}

export function savedNutrientMatches(
  expected: { fieldId: string; name: string; unit: string },
  saved: { field_id: string; name: string; unit: string; standard_key: string | null; archived_at: string | null } | null,
) {
  return Boolean(saved && saved.field_id === expected.fieldId && saved.name === expected.name.trim()
    && saved.unit === expected.unit.trim() && saved.standard_key === null && saved.archived_at === null);
}
