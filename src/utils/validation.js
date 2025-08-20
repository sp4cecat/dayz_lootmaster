/**
 * Validate a single Type against the given definitions.
 * @param {import('./xml.js').Type} t
 * @param {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}} defs
 * @returns {Record<string, string>} map of field -> error message
 */
export function validateTypeAgainstDefinitions(t, defs) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (t.category && !defs.categories.includes(t.category)) {
    errors.category = `Unknown category: ${t.category}`;
  }
  const notIn = (arr, allowed) => arr.filter(x => !allowed.includes(x));
  const badUsage = notIn(t.usage, defs.usageflags);
  if (badUsage.length) errors.usage = `Unknown usage: ${badUsage.join(', ')}`;
  const badValue = notIn(t.value, defs.valueflags);
  if (badValue.length) errors.value = `Unknown value: ${badValue.join(', ')}`;
  const badTag = notIn(t.tag, defs.tags);
  if (badTag.length) errors.tag = `Unknown tag: ${badTag.join(', ')}`;

  const nums = ['nominal', 'min', 'lifetime', 'restock', 'quantmin', 'quantmax'];
  nums.forEach(n => {
    const v = t[n];
    if (!Number.isFinite(v)) {
      errors[n] = `Invalid number for ${n}`;
    }
  });

  return errors;
}

/**
 * Build unknowns summary across all types vs definitions.
 * @param {import('./xml.js').Type[]} types
 * @param {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}} defs
 */
export function validateUnknowns(types, defs) {
  const usage = new Set();
  const value = new Set();
  const tag = new Set();
  const category = new Set();
  /** @type {Record<string, { category?: string[], usage: string[], value: string[], tag: string[] }>} */
  const byType = {};
  for (const t of types) {
    const tu = [];
    const tv = [];
    const tt = [];
    if (t.category && !defs.categories.includes(t.category)) category.add(t.category);
    for (const u of t.usage) if (!defs.usageflags.includes(u)) { usage.add(u); tu.push(u); }
    for (const v of t.value) if (!defs.valueflags.includes(v)) { value.add(v); tv.push(v); }
    for (const g of t.tag) if (!defs.tags.includes(g)) { tag.add(g); tt.push(g); }
    if (tu.length || tv.length || tt.length || (t.category && !defs.categories.includes(t.category))) {
      byType[t.name] = {
        category: (t.category && !defs.categories.includes(t.category)) ? [t.category] : undefined,
        usage: tu, value: tv, tag: tt
      };
    }
  }
  return {
    hasAny: usage.size > 0 || value.size > 0 || tag.size > 0 || category.size > 0,
    sets: { usage, value, tag, category },
    byType
  };
}
