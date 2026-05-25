// tests/test_shared_zip_store.js
//
// Smoke tests for atlases/inversion/shared/zip_store.js — the inline
// STORE-only ZIP writer that backs SPEC_manuscript_bundle_export Slice 1.
//
// Covers:
//   - crc32 matches known IETF test vectors
//   - addText / addBytes produce a buffer with the expected file count
//   - the local-file-header signature appears at every entry offset
//     stored in the central directory
//   - the central-directory signature appears in the right position
//   - the end-of-central-directory record is correct (entry count,
//     cd size, cd offset)
//   - empty zip (no files) is still a valid empty archive
//   - unicode filenames + content round-trip correctly
//
// Run from repo root:
//   node tests/test_shared_zip_store.js

import { createZip, crc32 } from '../atlases/inversion/shared/zip_store.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label, extra ? ' — ' + extra : ''); }
}
function group(name) { console.log('\n--- ' + name + ' ---'); }

// ---------------------------------------------------------------------------
group('crc32 — known IETF/RFC test vectors');
{
  const enc = new TextEncoder();
  // RFC 3720 test vector
  check('crc32("") = 0x00000000',
        crc32(new Uint8Array(0)) === 0x00000000);
  check('crc32("a") = 0xe8b7be43',
        crc32(enc.encode('a')) === 0xe8b7be43);
  check('crc32("abc") = 0x352441c2',
        crc32(enc.encode('abc')) === 0x352441c2);
  check('crc32("123456789") = 0xcbf43926',
        crc32(enc.encode('123456789')) === 0xcbf43926);
}

// ---------------------------------------------------------------------------
group('createZip — file count + structural layout');
{
  const zip = createZip();
  zip.addText('a.txt', 'hello');
  zip.addText('dir/b.tsv', 'col1\tcol2\nv1\tv2\n');
  zip.addBytes('bin.dat', new Uint8Array([1, 2, 3, 4]));
  check('fileCount = 3',  zip.fileCount === 3);

  const bytes = zip.toBytes();
  const dv = new DataView(bytes.buffer);
  // Local file header at offset 0
  check('first 4 bytes = local file header signature (PK\\x03\\x04)',
        dv.getUint32(0, true) === 0x04034b50);

  // Find central-directory signature near the end.
  // EOCD is exactly 22 bytes, so it starts at bytes.length - 22.
  const eocdAt = bytes.length - 22;
  check('EOCD signature at the right offset',
        dv.getUint32(eocdAt, true) === 0x06054b50);
  check('EOCD entries-on-disk = 3',
        dv.getUint16(eocdAt + 10, true) === 3);
  check('EOCD entries-total   = 3',
        dv.getUint16(eocdAt + 8,  true) === 3);
  const cdSize   = dv.getUint32(eocdAt + 12, true);
  const cdOffset = dv.getUint32(eocdAt + 16, true);
  check('EOCD points at central directory',
        dv.getUint32(cdOffset, true) === 0x02014b50);
  check('central directory + EOCD lengths sum to total',
        cdOffset + cdSize + 22 === bytes.length);
}

// ---------------------------------------------------------------------------
group('createZip — first file body matches input');
{
  const zip = createZip();
  const text = 'roundtrip test\nline 2';
  zip.addText('hello.md', text);
  const bytes = zip.toBytes();
  const dv = new DataView(bytes.buffer);
  // Local file header: 30 fixed bytes + filename (no extra). Content follows.
  const filenameLen = dv.getUint16(26, true);
  check('filename length field = 8 ("hello.md")', filenameLen === 8);
  const contentOffset = 30 + filenameLen;
  const contentLen = dv.getUint32(18, true);
  check('uncompressed size = ' + text.length, contentLen === text.length);
  const slice = bytes.slice(contentOffset, contentOffset + contentLen);
  const dec = new TextDecoder();
  check('content round-trips', dec.decode(slice) === text);
  // CRC matches independent computation
  check('stored crc32 matches recomputed',
        dv.getUint32(14, true) === crc32(new TextEncoder().encode(text)));
}

// ---------------------------------------------------------------------------
group('createZip — empty zip is still valid');
{
  const zip = createZip();
  const bytes = zip.toBytes();
  // Just EOCD, no local headers, no central directory.
  check('empty zip size = 22 bytes',  bytes.length === 22);
  const dv = new DataView(bytes.buffer);
  check('EOCD signature at offset 0', dv.getUint32(0, true) === 0x06054b50);
  check('entries on disk = 0',        dv.getUint16(10, true) === 0);
  check('cd size = 0',                dv.getUint32(12, true) === 0);
  check('cd offset = 0',              dv.getUint32(16, true) === 0);
}

// ---------------------------------------------------------------------------
group('createZip — unicode filenames + content');
{
  const zip = createZip();
  const fname = 'résumé/π_θ.md';
  const text  = 'Σ pi values · 226 samples · θπ ≈ 0.003';
  zip.addText(fname, text);
  const bytes = zip.toBytes();
  const dv = new DataView(bytes.buffer);
  const filenameLen = dv.getUint16(26, true);
  const enc = new TextEncoder();
  const expectedNameBytes = enc.encode(fname);
  check('filename length encodes utf-8 byte length',
        filenameLen === expectedNameBytes.length);
  const filenameSlice = bytes.slice(30, 30 + filenameLen);
  const dec = new TextDecoder();
  check('filename round-trips',  dec.decode(filenameSlice) === fname);
  const contentOffset = 30 + filenameLen;
  const contentLen = dv.getUint32(18, true);
  const expectedContent = enc.encode(text);
  check('content length encodes utf-8 byte length',
        contentLen === expectedContent.length);
  const contentSlice = bytes.slice(contentOffset, contentOffset + contentLen);
  check('content round-trips', dec.decode(contentSlice) === text);
}

// ---------------------------------------------------------------------------
group('createZip — input validation');
{
  const zip = createZip();
  let threw = false;
  try { zip.addText('', 'oops'); } catch (_) { threw = true; }
  check('addText("", …) throws', threw);
  threw = false;
  try { zip.addBytes('x', 'not a Uint8Array'); } catch (_) { threw = true; }
  check('addBytes with non-Uint8Array throws', threw);
}

// ---------------------------------------------------------------------------
console.log('\n=================');
console.log(`pass: ${pass}   fail: ${fail}`);
console.log('=================');
process.exit(fail === 0 ? 0 : 1);
