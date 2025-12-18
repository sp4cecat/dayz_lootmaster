import { describe, it, expect } from 'vitest';
import { lintXml, lintJson } from '../../src/utils/lint.js';

describe('lintXml', () => {
  it('accepts a simple well-formed XML', () => {
    const xml = `<?xml version="1.0"?>\n<root><a/><b>text<![CDATA[<weird>&stuff]]></b><!--comment--></root>`;
    const res = lintXml(xml);
    expect(res.ok).toBe(true);
  });

  it('rejects mismatched tags', () => {
    const xml = `<root><a></b></root>`;
    const res = lintXml(xml);
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain('Mismatched');
    expect(typeof res.line).toBe('number');
    expect(typeof res.column).toBe('number');
  });

  it('rejects unclosed tag', () => {
    const xml = `<root><a>`;
    const res = lintXml(xml);
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain('Unclosed');
    expect(typeof res.line).toBe('number');
    expect(typeof res.column).toBe('number');
  });
});

describe('lintJson', () => {
  it('accepts valid JSON', () => {
    const res = lintJson('{"a":1, "b":[true, false]}');
    expect(res.ok).toBe(true);
  });
  it('rejects invalid JSON', () => {
    const res = lintJson('{ a: 1 }');
    expect(res.ok).toBe(false);
    expect(String(res.error).toLowerCase()).toContain('json');
    expect(typeof res.line).toBe('number');
    expect(typeof res.column).toBe('number');
  });
});
