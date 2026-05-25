// atlases/inversion/shared/zip_store.js
// =====================================================================
// Minimal STORE-only ZIP writer for the manuscript bundle.
//
// Why STORE-only:
//   - All bundle contents are text (TSV/MD/JSON) and compress well at
//     the HTTP layer when transferred. A ZIP that's only used for
//     local download + manual unzip doesn't need DEFLATE.
//   - Adding DEFLATE pulls in either a heavy dep (pako) or the browser's
//     CompressionStream API (Chromium/Firefox; Safari coverage spotty
//     until 16.4). STORE keeps the writer deterministic, dependency-
//     free, and reviewable in ~150 lines.
//
// Compatibility:
//   - Produced files unzip cleanly in macOS Archive Utility, Windows
//     Explorer, 7-Zip, `unzip` (Info-ZIP), Python's `zipfile`.
//   - No ZIP64 — capped at 4 GB per file and 65535 entries; bundles
//     for ~100 candidates are <100 MB so this is fine.
//
// API:
//   const zip = createZip();
//   zip.addText('README.md', 'text…');
//   zip.addBytes('figures/F1.svg', new Uint8Array(...));
//   const blob = zip.toBlob();   // browser
//   const u8   = zip.toBytes();  // node tests
// =====================================================================

// ---------------------------------------------------------------------
// CRC-32 — standard IEEE 802.3 polynomial, lookup-table form.
// ---------------------------------------------------------------------

const _CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = _CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------
// ZIP writer
// ---------------------------------------------------------------------

export function createZip() {
  /** @type {Array<{ name: string, bytes: Uint8Array, crc: number, offset: number }>} */
  const entries = [];
  const enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;

  function _toUtf8(s) {
    if (enc) return enc.encode(s);
    // Node-fallback (Buffer present). TextEncoder is available in Node 12+
    // so this path is rarely taken.
    return new Uint8Array(Buffer.from(s, 'utf8'));
  }

  function addText(name, text) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('zip_store: addText needs a non-empty name');
    }
    addBytes(name, _toUtf8(String(text == null ? '' : text)));
  }

  function addBytes(name, bytes) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('zip_store: addBytes needs a non-empty name');
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('zip_store: addBytes expects a Uint8Array');
    }
    entries.push({ name, bytes, crc: crc32(bytes), offset: 0 });
  }

  function _assemble() {
    // Pass 1: compute total bytes so we can allocate one buffer.
    let total = 0;
    const nameUtf8 = entries.map(e => _toUtf8(e.name));
    for (let i = 0; i < entries.length; i++) {
      total += 30 + nameUtf8[i].length + entries[i].bytes.length;
    }
    const centralStart = total;
    for (let i = 0; i < entries.length; i++) {
      total += 46 + nameUtf8[i].length;
    }
    const eocdAt = total;
    total += 22;

    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);

    // Local file headers + data.
    let p = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const nm = nameUtf8[i];
      e.offset = p;
      dv.setUint32(p, 0x04034b50, true);        p += 4;   // signature
      dv.setUint16(p, 20, true);                p += 2;   // version needed
      dv.setUint16(p, 0,  true);                p += 2;   // flags
      dv.setUint16(p, 0,  true);                p += 2;   // method = STORE
      dv.setUint16(p, 0,  true);                p += 2;   // mod time
      dv.setUint16(p, 0,  true);                p += 2;   // mod date
      dv.setUint32(p, e.crc, true);             p += 4;   // crc
      dv.setUint32(p, e.bytes.length, true);    p += 4;   // compressed size
      dv.setUint32(p, e.bytes.length, true);    p += 4;   // uncompressed size
      dv.setUint16(p, nm.length, true);         p += 2;   // filename length
      dv.setUint16(p, 0, true);                 p += 2;   // extra length
      out.set(nm, p);                           p += nm.length;
      out.set(e.bytes, p);                      p += e.bytes.length;
    }

    // Central directory.
    const cdStart = p;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const nm = nameUtf8[i];
      dv.setUint32(p, 0x02014b50, true);        p += 4;   // signature
      dv.setUint16(p, 20, true);                p += 2;   // version made by
      dv.setUint16(p, 20, true);                p += 2;   // version needed
      dv.setUint16(p, 0, true);                 p += 2;   // flags
      dv.setUint16(p, 0, true);                 p += 2;   // method
      dv.setUint16(p, 0, true);                 p += 2;   // mod time
      dv.setUint16(p, 0, true);                 p += 2;   // mod date
      dv.setUint32(p, e.crc, true);             p += 4;   // crc
      dv.setUint32(p, e.bytes.length, true);    p += 4;   // compressed size
      dv.setUint32(p, e.bytes.length, true);    p += 4;   // uncompressed size
      dv.setUint16(p, nm.length, true);         p += 2;   // filename length
      dv.setUint16(p, 0, true);                 p += 2;   // extra length
      dv.setUint16(p, 0, true);                 p += 2;   // comment length
      dv.setUint16(p, 0, true);                 p += 2;   // disk number start
      dv.setUint16(p, 0, true);                 p += 2;   // internal attrs
      dv.setUint32(p, 0, true);                 p += 4;   // external attrs
      dv.setUint32(p, e.offset, true);          p += 4;   // local header offset
      out.set(nm, p);                           p += nm.length;
    }
    const cdSize = p - cdStart;

    // End of central directory record.
    dv.setUint32(p, 0x06054b50, true);          p += 4;   // signature
    dv.setUint16(p, 0, true);                   p += 2;   // disk number
    dv.setUint16(p, 0, true);                   p += 2;   // disk with cd
    dv.setUint16(p, entries.length, true);      p += 2;   // entries this disk
    dv.setUint16(p, entries.length, true);      p += 2;   // entries total
    dv.setUint32(p, cdSize, true);              p += 4;   // cd size
    dv.setUint32(p, cdStart, true);             p += 4;   // cd offset
    dv.setUint16(p, 0, true);                   p += 2;   // comment length

    // Sanity — should land exactly at total.
    if (p !== total) {
      throw new Error(`zip_store: wrote ${p} bytes, expected ${total}`);
    }
    if (cdStart !== centralStart || eocdAt !== centralStart + cdSize) {
      throw new Error('zip_store: central-directory layout mismatch');
    }
    return out;
  }

  return {
    addText,
    addBytes,
    toBytes: () => _assemble(),
    toBlob: () => new Blob([_assemble()], { type: 'application/zip' }),
    get fileCount() { return entries.length; },
  };
}
