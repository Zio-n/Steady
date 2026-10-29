const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function oneEditAway(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (a.length <= b.length) j++;
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}

/** Prefer exact names, then prefixes, phrase matches, word order, and small typos. */
export function choiceMatchScore(name: string, brand: string | null, search: string) {
  const query = normalize(search);
  if (!query) return -1;
  const title = normalize(name);
  const full = normalize(name + ' ' + (brand ?? ''));
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (full.includes(query)) return 60;
  const words = full.split(' ');
  const terms = query.split(' ');
  if (terms.every((term) => words.some((word) => word.startsWith(term)))) return 45;
  if (terms.every((term) => words.some((word) => oneEditAway(term, word)))) return 25;
  return -1;
}
