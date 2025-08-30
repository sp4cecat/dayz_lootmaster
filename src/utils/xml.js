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
  const doc = safeParseXml(xml);

  const categories = readNamedChildren(doc, 'categories', ['category']);
  const usageflags = readNamedChildren(doc, 'usageflags', ['flag', 'usage']);
  const valueflags = readNamedChildren(doc, 'valueflags', ['flag', 'value']);
  const tags = readNamedChildren(doc, 'tags', ['tag']);

  return {
    // Keep categories sorted as before
    categories: categories.sort(),
    // Preserve original ordering of usage items with stable de-duplication
    usageflags: uniqStable(usageflags),
    // Keep value flags sorted for tiers consistency
    valueflags: uniq(valueflags).sort(),
    // Keep tags sorted
    tags: uniq(tags).sort(),
  };
}

/**
 * Stable unique: preserve first occurrence order.
 * @param {string[]} arr
 * @returns {string[]}
 */
function uniqStable(arr) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const v of arr) {
    if (v == null) continue;
    const s = String(v);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
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

    // Deduplicate entries within usage/value/tag
    const usage = uniq(Array.from(node.getElementsByTagName('usage')).map(u => u.getAttribute('name')).filter(Boolean));
    const value = uniq(Array.from(node.getElementsByTagName('value')).map(u => u.getAttribute('name')).filter(Boolean));
    const tag = uniq(Array.from(node.getElementsByTagName('tag')).map(u => u.getAttribute('name')).filter(Boolean));

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
 * Parse cfgeconomycore.xml and return group order and types file paths for each group.
 * Only <file> entries with attribute type="types" are included.
 * @param {string} xml
 * @returns {{ order: string[], filesByGroup: Record<string, string[]> }}
 */
export function parseEconomyCoreXml(xml) {
  const doc = safeParseXml(xml);
  const ceNodes = Array.from(doc.getElementsByTagName('ce'));

  console.log("CE Nodes", doc, ceNodes)

  /** @type {string[]} */
  const order = [];
  /** @type {Record<string, string[]>} */
  const filesByGroup = {};

  for (const ce of ceNodes) {
    const folder = ce.getAttribute('folder');
    console.log("Folder", folder)
    if (!folder) continue;
    const parts = folder.split('/').filter(Boolean);
    const group = parts[parts.length - 1] || folder;


      console.log("Parts/group",parts, group)

    const typeFileNodes = Array.from(ce.getElementsByTagName('file'))
      .filter(f => (f.getAttribute('type') || '').toLowerCase() === 'types');

    console.log("NODES", typeFileNodes)

    const files = typeFileNodes
      .map(f => f.getAttribute('name'))
      .filter(Boolean)
      .map(name => `/samples/${folder}/${name}`);

    if (files.length > 0) {
      order.push(group);
      filesByGroup[group] = files;
    }
  }

  return { order, filesByGroup };
}

/**
 * Generate types.xml string from array of Type
 * @param {Type[]} types
 */
export function generateTypesXml(types) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<types>'];
  // Ensure case-insensitive alphabetical order by type name
  const sorted = [...types].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })
  );
  for (const t of sorted) {
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
 * Generate cfglimitsdefinition.xml from in-memory definitions.
 * Uses <flag> elements for usage/value and <category>/<tag> for others.
 * @param {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}} defs
 * @returns {string}
 */
export function generateLimitsXml(defs) {
  const esc = (s) => escapeAttr(s);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<limitsdefinition>',
    '  <categories>',
    ...defs.categories.map(c => `    <category name="${esc(c)}"/>`),
    '  </categories>',
    '  <usageflags>',
    ...defs.usageflags.map(u => `    <usage name="${esc(u)}"/>`),
    '  </usageflags>',
    '  <valueflags>',
    ...defs.valueflags.map(v => `    <value name="${esc(v)}"/>`),
    '  </valueflags>',
    '  <tags>',
    ...defs.tags.map(t => `    <tag name="${esc(t)}"/>`),
    '  </tags>',
    '</limitsdefinition>'
  ];
  return lines.join('\n');
}

/**
 * Generate a single types.xml from multiple source files with comments indicating origin file.
 * @param {{file: string, types: Type[]}[]} files
 * @returns {string}
 */
export function generateTypesXmlFromFilesWithComments(files) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<types>'];
  // Sort files by name for deterministic output
  const sorted = [...files].sort((a, b) => String(a.file).localeCompare(String(b.file)));
  for (const { file, types } of sorted) {
    lines.push(`  <!-- ${escapeAttr(file)}.xml -->`);
    const perFileSorted = [...types].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' })
    );
    for (const t of perFileSorted) {
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

/**
 * Parse XML resiliently by retrying without XML declaration if a parser error occurs.
 * Throws if the document still fails to parse.
 * @param {string} xml
 * @returns {Document}
 */
function safeParseXml(xml) {
  let doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (hasParserError(doc)) {
    // Strip XML declaration (prolog) and retry
    const cleaned = xml.replace(/^\s*<\?xml[^>]*\?>\s*/i, '');
    doc = new DOMParser().parseFromString(cleaned, 'application/xml');
    if (hasParserError(doc)) {
      // Provide a terse error to callers; upstream catches and handles
      throw new Error('Failed to parse XML');
    }
  }
  return doc;
}

/**
 * Detects if a parsed Document contains a parsererror element.
 * @param {Document} doc
 * @returns {boolean}
 */
function hasParserError(doc) {
  const errs = doc.getElementsByTagName('parsererror');
  return errs && errs.length > 0;
}
