// Cross-platform check for src/lib/e2eCore.ts. The expected values are the
// ones the desktop asserts in src-tauri/src/services/e2e.rs (computed
// independently with Python's `cryptography`). Run:
//   node --experimental-strip-types scripts/e2e-vectors.test.mts
import assert from 'node:assert/strict';
import {
  blobName,
  isSealedMqttText,
  openBox,
  parseE2eKey,
  sealMqttTextWithNonce,
  sealWithNonce,
  toHex,
  base64Decode,
} from '../src/lib/e2eCore.ts';

const keys = parseE2eKey('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
assert.ok(keys);
assert.equal(keys.fingerprint, '630D-CD29');

const nonce = new Uint8Array(12).fill(7);
const sealed = sealWithNonce(keys, 'snapshot', new TextEncoder().encode('{"hello":1}'), nonce);
assert.equal(
  toHex(sealed),
  '545a4531070707070707070707070707dc4695fd4174557c625f7db3184af24a0b750b0879bca117e59877',
);
assert.equal(new TextDecoder().decode(openBox(keys, 'snapshot', sealed)!), '{"hello":1}');
assert.equal(openBox(keys, 'ops', sealed), null);
assert.equal(
  blobName(keys, new TextEncoder().encode('hello')),
  'b91001f940c067a8658ea440653e662976cc302d43d2d20426903f32fbdefd65',
);

const text = sealMqttTextWithNonce(keys, '{"msg":"hi"}', nonce);
assert.ok(isSealedMqttText(text));
assert.equal(new TextDecoder().decode(openBox(keys, 'mqtt', base64Decode(text.slice(5))!)!), '{"msg":"hi"}');
assert.equal(parseE2eKey('too-short'), null);

console.log('e2e vectors ok');
