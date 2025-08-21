/**
 * Create a ZIP Blob (stored, no compression) from a list of files.
 * Each file: { name: string, data: Uint8Array }
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Blob}
 */
export function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const centralDir = [];
  let offset = 0;

  const now = new Date();
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((Math.floor(now.getSeconds() / 2)) & 0x1f);
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const size = data.length;

    // Local file header
    const localHeader = new Uint8Array(30 + nameBytes.length);
    let p = 0;
    p = writeU32(localHeader, p, 0x04034b50); // signature
    p = writeU16(localHeader, p, 20);         // version needed
    p = writeU16(localHeader, p, 0);          // flags
    p = writeU16(localHeader, p, 0);          // method: store
    p = writeU16(localHeader, p, dosTime);
    p = writeU16(localHeader, p, dosDate);
    p = writeU32(localHeader, p, crc);
    p = writeU32(localHeader, p, size);
    p = writeU32(localHeader, p, size);
    p = writeU16(localHeader, p, nameBytes.length);
    p = writeU16(localHeader, p, 0);          // extra len
    localHeader.set(nameBytes, p);

    chunks.push(localHeader, data);
    const localHeaderOffset = offset;
    offset += localHeader.length + data.length;

    // Central directory header
    const central = new Uint8Array(46 + nameBytes.length);
    p = 0;
    p = writeU32(central, p, 0x02014b50); // central signature
    p = writeU16(central, p, 20);         // version made by
    p = writeU16(central, p, 20);         // version needed
    p = writeU16(central, p, 0);          // flags
    p = writeU16(central, p, 0);          // method
    p = writeU16(central, p, dosTime);
    p = writeU16(central, p, dosDate);
    p = writeU32(central, p, crc);
    p = writeU32(central, p, size);
    p = writeU32(central, p, size);
    p = writeU16(central, p, nameBytes.length);
    p = writeU16(central, p, 0);          // extra len
    p = writeU16(central, p, 0);          // comment len
    p = writeU16(central, p, 0);          // disk number
    p = writeU16(central, p, 0);          // internal attrs
    p = writeU32(central, p, 0);          // external attrs
    p = writeU32(central, p, localHeaderOffset); // relative offset
    central.set(nameBytes, p);

    centralDir.push(central);
  }

  // Central dir size and offset
  const centralOffset = offset;
  for (const c of centralDir) {
    chunks.push(c);
    offset += c.length;
  }
  const centralSize = offset - centralOffset;

  // End of central directory record
  const end = new Uint8Array(22);
  let p2 = 0;
  p2 = writeU32(end, p2, 0x06054b50);
  p2 = writeU16(end, p2, 0); // disk
  p2 = writeU16(end, p2, 0); // start disk
  p2 = writeU16(end, p2, files.length);
  p2 = writeU16(end, p2, files.length);
  p2 = writeU32(end, p2, centralSize);
  p2 = writeU32(end, p2, centralOffset);
  p2 = writeU16(end, p2, 0); // comment length
  chunks.push(end);

  return new Blob(chunks, { type: 'application/zip' });
}

function writeU16(buf, p, v) {
  buf[p++] = v & 0xff;
  buf[p++] = (v >>> 8) & 0xff;
  return p;
}
function writeU32(buf, p, v) {
  buf[p++] = v & 0xff;
  buf[p++] = (v >>> 8) & 0xff;
  buf[p++] = (v >>> 16) & 0xff;
  buf[p++] = (v >>> 24) & 0xff;
  return p;
}

/**
 * CRC32 of a Uint8Array
 * @param {Uint8Array} data
 * @returns {number}
 */
function crc32(data) {
  let crc = ~0;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  return ~crc >>> 0;
}

const table = (() => {
  let c;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();
