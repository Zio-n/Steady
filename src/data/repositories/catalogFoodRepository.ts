import type { Database, Json } from '../database.types';
import { DataError, toDataError } from '../dataError';
import { supabase } from '../supabaseClient';

type CatalogFoodRpcResult = Database['public']['Functions']['search_catalog_foods']['Returns'][number];
export type CatalogFoodNutrient = { value: number; unit: string };
export type CatalogFoodPortion = {
  amount: number;
  unit: string;
  label: string;
  grams_per_unit: number | null;
  millilitres_per_unit: number | null;
};
export type CatalogFoodSearchResult = Omit<CatalogFoodRpcResult, 'nutrients'> & {
  nutrients: Record<string, CatalogFoodNutrient>;
  portions: CatalogFoodPortion[];
  default_portion: (CatalogFoodPortion & { is_named: boolean }) | null;
};

function namedPortionLabel(label: string) {
  return label.trim().replace(/\s*\(\s*[\d.,]+\s*(?:g|grams?|kg|ml|millilit(?:er|re)s?|oz|lb)\s*\)\s*$/i, '').trim();
}

function portionCount(value: string | null, fallback: number) {
  if (!value) return fallback;
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  const count = fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(value.replace(',', '.'));
  return Number.isFinite(count) && count > 0 ? count : fallback;
}

function portionDescriptor(label: string, sourceUnit: string, sourceAmount: number, grams: number | null, millilitres: number | null) {
  const cleanLabel = namedPortionLabel(label);
  const quantityAndUnit = cleanLabel.match(/^\s*(\d+(?:[.,]\d+)?|\d+\/\d+)\s+(.+?)\s*$/);
  const sourceKey = sourceUnit.trim().toLocaleLowerCase();
  const isMeasureUnit = ['g', 'gram', 'grams', 'kg', 'ml', 'millilitre', 'milliliter', 'l', 'litre', 'liter'].includes(sourceKey);
  const unitText = quantityAndUnit?.[2]?.trim().replace(/[.,;:]$/, '') ?? '';
  const lowerUnit = unitText.toLocaleLowerCase();
  const normalizedUnit = lowerUnit.endsWith('ies') ? `${lowerUnit.slice(0, -3)}y`
    : lowerUnit.endsWith('sses') ? lowerUnit.slice(0, -2)
      : lowerUnit.endsWith('s') && !lowerUnit.endsWith('ss') && !lowerUnit.endsWith('us') && !lowerUnit.endsWith('is') ? lowerUnit.slice(0, -1) : lowerUnit;
  const isSafeNamedUnit = Boolean(unitText && normalizedUnit.length <= 24 && /^[\p{L}\p{N} -]+$/u.test(normalizedUnit));
  const isNamed = !isMeasureUnit && isSafeNamedUnit && (grams !== null || millilitres !== null);
  const amount = isNamed ? portionCount(quantityAndUnit?.[1] ?? null, sourceAmount > 0 ? sourceAmount : 1) : 0;
  return {
    amount: isNamed ? amount : grams ?? millilitres ?? 0,
    unit: isNamed ? normalizedUnit : grams !== null ? 'g' : 'ml',
    label: isNamed ? cleanLabel : '',
    is_named: isNamed,
    grams_per_unit: isNamed && grams !== null ? grams / amount : null,
    millilitres_per_unit: isNamed && millilitres !== null ? millilitres / amount : null,
  };
}

function parseNutrients(value: Json): Record<string, CatalogFoodNutrient> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).flatMap(([code, raw]) => {
    if (raw === null || Array.isArray(raw) || typeof raw !== 'object') return [];
    const nutrientValue = raw.value;
    const unit = raw.unit;
    if (typeof nutrientValue !== 'number' || typeof unit !== 'string') return [];
    return [[code, { value: nutrientValue, unit }]];
  }));
}

const nutrientCodeByStandardKey: Record<string, string> = {
  protein: 'protein_g', carbohydrate: 'carbohydrate_g', fat: 'fat_g', fibre: 'fibre_g',
  sugar: 'sugars_g', saturated_fat: 'saturated_fat_g', salt: 'salt_g',
};

/** Return only normalized catalogue nutrients with an exact unit match for the user's field. */
export function nutrientsForUserFields(food: CatalogFoodSearchResult, fields: { field_id: string; standard_key: string | null; unit: string }[]) {
  const values: Record<string, number> = {};
  for (const field of fields) {
    const code = field.standard_key ? nutrientCodeByStandardKey[field.standard_key] : field.field_id;
    const nutrient = code ? food.nutrients[code] : undefined;
    if (nutrient && nutrient.unit.toLocaleLowerCase() === field.unit.trim().toLocaleLowerCase()) values[field.field_id] = nutrient.value;
  }
  return values;
}

/** Search the bounded shared catalogue by canonical name, brand, or attributed alias. */
export async function searchCatalogFoods(query: string, locale: string | null = null, limit = 30): Promise<CatalogFoodSearchResult[]> {
  if (!supabase) throw new DataError('Connect Supabase before searching the food catalogue.', 'configuration');
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const args = {
    p_query: trimmed,
    p_limit: limit,
    ...(locale ? { p_locale: locale } : {}),
  };
  const { data, error } = await supabase.rpc('search_catalog_foods', {
    ...args,
  });
  if (error) throw toDataError(error);
  if (data.length === 0) return [];
  const { data: portions, error: portionError } = await supabase.from('catalog_food_portions')
    .select('food_id,label,amount,unit,grams,millilitres,is_default')
    .in('food_id', data.map((food) => food.food_id));
  if (portionError) throw toDataError(portionError);
  const portionsByFood = new Map<string, typeof portions>();
  for (const portion of portions) {
    const rows = portionsByFood.get(portion.food_id) ?? [];
    rows.push(portion);
    portionsByFood.set(portion.food_id, rows);
  }
  return data.map((food) => {
    const sourcePortions = portionsByFood.get(food.food_id) ?? [];
    const portionOptions = sourcePortions
      .filter((candidate) => candidate.grams !== null || candidate.millilitres !== null)
      .map((row) => portionDescriptor(row.label, row.unit, Number(row.amount) || 1, row.grams, row.millilitres))
      .filter((portion) => portion.is_named && (food.basis_unit === 'g' ? portion.grams_per_unit !== null : portion.millilitres_per_unit !== null))
      .map(({ amount, unit, label, grams_per_unit, millilitres_per_unit }) => ({ amount, unit, label, grams_per_unit, millilitres_per_unit }));
    const portion = sourcePortions
      .filter((candidate) => candidate.grams !== null || candidate.millilitres !== null)
      .sort((left, right) => Number(right.is_default) - Number(left.is_default)
        || left.label.length - right.label.length
        || left.label.localeCompare(right.label))[0];
    let defaultPortion = portion ? portionDescriptor(portion.label, portion.unit, Number(portion.amount) || 1, portion.grams, portion.millilitres) : null;
    if (defaultPortion?.is_named) {
      const basisUnit = food.basis_unit.trim().toLocaleLowerCase();
      const convertible = ['g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms'].includes(basisUnit) && defaultPortion.grams_per_unit !== null;
      if (!convertible) defaultPortion = {
        amount: food.basis_amount, unit: food.basis_unit, label: '', is_named: false,
        grams_per_unit: null, millilitres_per_unit: null,
      };
    }
    return {
      ...food,
      nutrients: parseNutrients(food.nutrients),
      portions: portionOptions,
      default_portion: defaultPortion,
    };
  });
}

export async function saveCatalogFoodCopy(input: {
  requestId: string;
  catalogFoodId: string;
  name: string;
  brand: string | null;
  basisAmount: number;
  basisUnit: string;
  defaultPortionAmount: number;
  defaultPortionUnit: string;
  caloriesKcal: number | null;
  nutrients: Record<string, number>;
  isPersonallyAdjusted: boolean;
}) {
  if (!supabase) throw new DataError('Connect Supabase before saving a catalogue food.', 'configuration');
  const { data, error } = await supabase.rpc('save_catalog_food_copy', {
    p_request_id: input.requestId,
    p_catalog_food_id: input.catalogFoodId,
    p_name: input.name,
    p_brand: input.brand as string,
    p_basis_amount: input.basisAmount,
    p_basis_unit: input.basisUnit,
    p_default_portion_amount: input.defaultPortionAmount,
    p_default_portion_unit: input.defaultPortionUnit,
    p_calories_kcal: input.caloriesKcal as number,
    p_nutrients: input.nutrients as unknown as Json,
    p_is_personally_adjusted: input.isPersonallyAdjusted,
  });
  if (error) throw toDataError(error);
  return data;
}
