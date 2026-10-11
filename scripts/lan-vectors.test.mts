// LAN transfer encryption: vectors sealed by the desktop (src-tauri sealed.rs)
// must open here, and our own boxes must survive only intact. The opposite
// direction lives in sealed.rs (`opens_what_the_app_seals`).
import assert from 'node:assert/strict';
import { buildUploadPayload, openDownloadStream, openLan, parseLanKey, sealedDownloadPath, sealLanWithNonce } from '../src/lib/lanSealCore.ts';

const hex = (text: string) => Uint8Array.from(text.match(/../g)!.map((b) => parseInt(b, 16)));
// openDownloadStream over an in-memory stream, the way the app feeds it from a file.
async function openDownloadFrames(key: Uint8Array, stream: Uint8Array) {
  let at = 0;
  const out: number[] = [];
  const read = (n: number) => stream.subarray(at, (at += n));
  const ok = await openDownloadStream(key, stream.length, read, (plain) => out.push(...plain));
  return ok ? Uint8Array.from(out) : null;
}
const key = parseLanKey('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
assert.ok(key);
assert.deepEqual([...key], Array.from({ length: 32 }, (_, i) => i));
assert.equal(parseLanKey('too-short'), null);
assert.equal(parseLanKey(null), null);

// Sealed by the desktop with key 0..=31.
const DESKTOP_FRAME = '0000002f545a4c31c384d2a28e531997488679c091bb5ef29810c8bc7b7a394235681e2f4d30b0934e68a4e8aa2bd12fde8f34';
const DESKTOP_POLL = '545a4c31ed57751d18aa27212f5e465e3cf85769523acf4fe4f2f40d8264b0db40b37553ab59ab4ba2cf';
assert.equal(new TextDecoder().decode((await openDownloadFrames(key, hex(DESKTOP_FRAME)))!), 'TieZ LAN v1 ✓');
assert.deepEqual(JSON.parse(new TextDecoder().decode(openLan(key, 'poll', hex(DESKTOP_POLL))!)), [{ id: 7 }]);
assert.equal(openLan(key, 'text', hex(DESKTOP_POLL)), null, 'kind is bound');

// Multi-frame streams: intact opens; dropped, reordered or cut-off frames do not.
const nonce = (n: number) => Uint8Array.from({ length: 12 }, (_, i) => n + i);
const frame = (index: number, last: boolean, plain: Uint8Array) => {
  const box = sealLanWithNonce(key, `download/${index}/${last ? 1 : 0}`, plain, nonce(index * 16));
  const out = new Uint8Array(4 + box.length);
  new DataView(out.buffer).setUint32(0, box.length);
  out.set(box, 4);
  return out;
};
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const a = new TextEncoder().encode('first '), b = new TextEncoder().encode('second');
const f0 = frame(0, false, a), f1 = frame(1, true, b);
assert.equal(new TextDecoder().decode((await openDownloadFrames(key, join(f0, f1)))!), 'first second');
assert.equal(await openDownloadFrames(key, f0), null, 'last frame dropped');
assert.equal(await openDownloadFrames(key, join(f1, f0)), null, 'reordered');
assert.equal(await openDownloadFrames(key, join(f0, f1).subarray(0, 40)), null, 'cut mid-frame');
const tampered = join(f0, f1); tampered[10] ^= 1;
assert.equal(await openDownloadFrames(key, tampered), null, 'tampered');
assert.equal(await openDownloadFrames(key, new Uint8Array(0)), null, 'empty stream');
const huge = join(f0, f1); new DataView(huge.buffer).setUint32(0, 0x7fffffff);
assert.equal(await openDownloadFrames(key, huge), null, 'oversized frame length');
// Many frames, so the stream yields to the event loop along the way.
const many = Array.from({ length: 20 }, (_, i) => frame(i, i === 19, new Uint8Array([i])));
assert.deepEqual([...(await openDownloadFrames(key, join(...many)))!], Array.from({ length: 20 }, (_, i) => i));

// Upload payload layout matches the desktop's split_upload.
const payload = buildUploadPayload({ upload_id: 'x' }, new Uint8Array([1, 2, 3]));
assert.equal(new DataView(payload.buffer).getUint32(0), '{"upload_id":"x"}'.length);
assert.deepEqual([...payload.subarray(payload.length - 3)], [1, 2, 3]);

assert.equal(sealedDownloadPath('/download/abc?name=a.png'), '/s/download/abc');
console.log('lan vectors ok');
