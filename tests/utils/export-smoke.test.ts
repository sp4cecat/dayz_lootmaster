import { describe, it, expect } from 'vitest';
import { generateTypesXmlFromFilesWithComments } from '../../src/utils/xml';
import { createZip } from '../../src/utils/zip.js';

// Verifies the shapes ExportModal now passes actually work end-to-end.
describe('export path smoke', () => {
  const types = [
    { name: 'Foo', lifetime: 3600, usage: [], value: [], tag: [], flags: {}, _present: {}, _edited: {} },
  ];

  it('generateTypesXmlFromFilesWithComments accepts {file, types}[] and emits the origin comment', () => {
    const xml = generateTypesXmlFromFilesWithComments([{ file: 'mymod', types }]);
    expect(xml).toContain('<!-- mymod.xml -->');
    expect(xml).toContain('<type name="Foo">');
  });

  it('createZip accepts {name, data: Uint8Array}[] and returns a Blob', async () => {
    const enc = new TextEncoder();
    const blob = await createZip([{ name: 'a.xml', data: enc.encode('<types/>') }]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});
