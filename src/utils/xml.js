/**
 * @typedef Flags
 * @property {boolean} count_in_cargo
 * @property {boolean} count_in_hoarder
 * @property {boolean} count_in_map
 * @property {boolean} count_in_player
 * @property {boolean} crafted
 * @property {boolean} deloot
 */

/**
 * @typedef Type
 * @property {string} name
 * @property {string=} category
 * @property {number} nominal
 * @property {number} min
 * @property {number} lifetime
 * @property {number} restock
 * @property {number} quantmin
 * @property {number} quantmax
 * @property {string[]} usage
 * @property {string[]} value
 * @property {string[]} tag
 * @property {Flags} flags
 */

/**
 * Parse cfglimitsdefinition.xml into definitions object.
 * Supports flexibly reading <categories><category name="..."/></categories>, <usageflags><flag name="..."/></usageflags>, <valueflags><flag name="..."/></valueflags>, <tags><tag name="..."/></tags>
 * @param {string} xml
 * @returns {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}}
 */
export function parseLimitsXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const categories = readNamedChildren(doc, 'categories', ['category']);
  const usageflags = readNamedChildren(doc, 'usageflags', ['flag', 'usage']);
  const valueflags = readNamedChildren(doc, 'valueflags', ['flag', 'value']);
  const tags = readNamedChildren(doc, 'tags', ['tag']);

  return {
    categories: categories.sort(),
    usageflags: uniq(usageflags).sort(),
    valueflags: uniq(valueflags).sort(),
    tags: uniq(tags).sort(),
  };
}

/**
 * Parse types.xml into an array of Type
 * @param {string} xml
 * @returns {Type[]}
 */
export function parseTypesXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const typeNodes = Array.from(doc.getElementsByTagName('type'));
  return typeNodes.map(node => {
    const name = node.getAttribute('name') || '';
    const getNum = (tag, fallback = 0) => {
      const el = node.getElementsByTagName(tag)[0];
      if (!el || !el.textContent) return fallback;
      const n = Number(el.textContent.trim());
      return Number.isFinite(n) ? n : fallback;
    };
    const flagsEl = node.getElementsByTagName('flags')[0];
    /** @type {Flags} */
    const flags = {
      count_in_cargo: toBool(flagsEl?.getAttribute('count_in_cargo')),
      count_in_hoarder: toBool(flagsEl?.getAttribute('count_in_hoarder')),
      count_in_map: toBool(flagsEl?.getAttribute('count_in_map')),
      count_in_player: toBool(flagsEl?.getAttribute('count_in_player')),
      crafted: toBool(flagsEl?.getAttribute('crafted')),
      deloot: toBool(flagsEl?.getAttribute('deloot')),
    };
    const categoryEl = node.getElementsByTagName('category')[0];
    const category = categoryEl?.getAttribute('name') || undefined;

    const usage = Array.from(node.getElementsByTagName('usage')).map(u => u.getAttribute('name')).filter(Boolean);
    const value = Array.from(node.getElementsByTagName('value')).map(u => u.getAttribute('name')).filter(Boolean);
    const tag = Array.from(node.getElementsByTagName('tag')).map(u => u.getAttribute('name')).filter(Boolean);

    return {
      name,
      category,
      nominal: getNum('nominal'),
      min: getNum('min'),
      lifetime: getNum('lifetime'),
      restock: getNum('restock'),
      quantmin: getNum('quantmin'),
      quantmax: getNum('quantmax'),
      usage: /** @type {string[]} */(usage),
      value: /** @type {string[]} */(value),
      tag: /** @type {string[]} */(tag),
      flags
    };
  });
}

/**
 * Generate types.xml string from array of Type
 * @param {Type[]} types
 */
export function generateTypesXml(types) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<types>'];
  for (const t of types) {
    lines.push(`  <type name="${escapeAttr(t.name)}">`);
    lines.push(`    <nominal>${t.nominal}</nominal>`);
    lines.push(`    <min>${t.min}</min>`);
    lines.push(`    <lifetime>${t.lifetime}</lifetime>`);
    lines.push(`    <restock>${t.restock}</restock>`);
    lines.push(`    <quantmin>${t.quantmin}</quantmin>`);
    lines.push(`    <quantmax>${t.quantmax}</quantmax>`);
    lines.push(`    <flags count_in_cargo="${to01(t.flags.count_in_cargo)}" count_in_hoarder="${to01(t.flags.count_in_hoarder)}" count_in_map="${to01(t.flags.count_in_map)}" count_in_player="${to01(t.flags.count_in_player)}" crafted="${to01(t.flags.crafted)}" deloot="${to01(t.flags.deloot)}"/>`);
    if (t.category) lines.push(`    <category name="${escapeAttr(t.category)}"/>`);
    for (const u of t.usage) lines.push(`    <usage name="${escapeAttr(u)}"/>`);
    for (const v of t.value) lines.push(`    <value name="${escapeAttr(v)}"/>`);
    for (const g of t.tag) lines.push(`    <tag name="${escapeAttr(g)}"/>`);
    lines.push('  </type>');
  }
  lines.push('</types>');
  return lines.join('\n');
}

/**
 * Helper to read entries with "name" attribute under a parent element.
 * @param {Document} doc
 * @param {string} parentTag
 * @param {string[]} childTags
 * @returns {string[]}
 */
function readNamedChildren(doc, parentTag, childTags) {
  const parent = doc.getElementsByTagName(parentTag)[0];
  if (!parent) return [];
  const arr = [];
  childTags.forEach(tag => {
    arr.push(...Array.from(parent.getElementsByTagName(tag)).map(n => n.getAttribute('name')).filter(Boolean));
  });
  return arr;
}

function toBool(attrVal) {
  if (attrVal == null) return false;
  return attrVal === '1' || attrVal.toLowerCase() === 'true';
}
function to01(b) {
  return b ? '1' : '0';
}
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function uniq(arr) {
  return Array.from(new Set(arr));
}
