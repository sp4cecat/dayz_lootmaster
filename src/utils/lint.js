// Lightweight lint utilities for validating JSON and XML text content.
// Designed to work in both browser (UI) and Node (server) ESM environments without extra deps.

/**
 * Validate JSON by parsing. On error, include line/column when derivable.
 * @param {string} text
 * @returns {{ ok: true } | { ok: false, error: string, line?: number, column?: number }}
 */
export function lintJson(text) {
  try {
    JSON.parse(text);
    return { ok: true };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'Invalid JSON';
    // Try to extract character position from V8 error message: "at position X"
    let line, column;
    const m = /position\s+(\d+)/i.exec(msg);
    if (m) {
      const pos = Number(m[1]);
      if (Number.isFinite(pos)) {
        const lc = computeLineCol(text, pos);
        line = lc.line; column = lc.column;
      }
    }
    return line && column ? { ok: false, error: msg, line, column } : { ok: false, error: msg };
  }
}

/**
 * Very lightweight XML well-formedness check without external dependencies.
 * Handles comments, CDATA, processing instructions and self-closing tags.
 * Does NOT validate attributes or namespaces beyond basic well-formed tag nesting.
 * Returns approximate line/column for detected errors.
 * @param {string} xml
 * @returns {{ ok: true } | { ok: false, error: string, line?: number, column?: number }}
 */
export function lintXml(xml) {
  if (typeof xml !== 'string') return { ok: false, error: 'XML must be a string' };
  if (xml.trim().length === 0) return { ok: false, error: 'Empty XML document' };
  // Create a masked copy that preserves indices: replace ignorable regions with whitespace of equal length
  let s = xml
    .replace(/<\?xml[^>]*\?>/gi, (m) => ' '.repeat(m.length))              // XML declaration
    .replace(/<!--([\s\S]*?)-->/g, (m) => ' '.repeat(m.length))            // comments
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => ' '.repeat(m.length)) // CDATA
    .replace(/<!DOCTYPE[\s\S]*?>/gi, (m) => ' '.repeat(m.length))          // doctype
    .replace(/<\?[^>]*\?>/g, (m) => ' '.repeat(m.length));                 // processing instructions

  /** @type {string[]} */
  const stack = [];
  const tagRe = /<\/?([A-Za-z_][A-Za-z0-9_.:-]*)([^>]*)>/g;
  let lastIndex = 0;
  let m;
  while ((m = tagRe.exec(s)) !== null) {
    // Ensure text between tags doesn't contain stray '<'
    const between = s.slice(lastIndex, m.index);
    if (between.includes('<')) {
      const off = lastIndex + between.indexOf('<');
      const { line, column } = computeLineCol(xml, off);
      return { ok: false, error: 'Unexpected < in text content', line, column };
    }
    lastIndex = tagRe.lastIndex;

    const full = m[0];
    const name = m[1];
    const tail = m[2] || '';
    if (full.startsWith('</')) {
      // Closing tag
      if (stack.length === 0) {
        const { line, column } = computeLineCol(xml, m.index);
        return { ok: false, error: `Unexpected closing tag </${name}>`, line, column };
      }
      const open = stack.pop();
      if (open !== name) {
        const { line, column } = computeLineCol(xml, m.index);
        return { ok: false, error: `Mismatched closing tag </${name}> for <${open}>`, line, column };
      }
    } else {
      // Self-closing?
      const selfClosing = /\/(\s*)$/.test(tail.trim());
      if (!selfClosing) {
        stack.push(name);
      }
    }
  }
  // After last tag, ensure remainder has no stray '<'
  const rest = s.slice(lastIndex);
  if (rest.includes('<')) {
    const off = lastIndex + rest.indexOf('<');
    const { line, column } = computeLineCol(xml, off);
    return { ok: false, error: 'Unexpected < in trailing content', line, column };
  }
  if (stack.length) {
    const unclosed = stack[stack.length - 1];
    // Try to point to the opening tag position
    const openIdx = s.indexOf('<' + unclosed, 0);
    const idx = openIdx >= 0 ? openIdx : s.length - 1;
    const { line, column } = computeLineCol(xml, idx);
    return { ok: false, error: `Unclosed tag <${unclosed}>`, line, column };
  }
  return { ok: true };
}

/**
 * Lint text by type ('json' | 'xml').
 * @param {'json'|'xml'} kind
 * @param {string} text
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function lintText(kind, text) {
  return kind === 'json' ? lintJson(text) : lintXml(text);
}

/**
 * Compute 1-based line/column from a 0-based index into text.
 * @param {string} text
 * @param {number} index
 */
function computeLineCol(text, index) {
  let line = 1;
  let column = 1;
  const lim = Math.max(0, Math.min(index, text.length));
  for (let i = 0; i < lim; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 10) { // \n
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
