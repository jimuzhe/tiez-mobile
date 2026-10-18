// End-to-end encryption, format v1. Specified in tiez-clipboard
// docs/E2E-ENCRYPTION.md and implemented on the desktop in
// src-tauri/src/services/e2e.rs; the two must stay byte-compatible.
// No platform imports here, so scripts/e2e-vectors.test.mts can run it in Node.
import { gcm } from '@noble/ciphers/aes';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

export type E2eKind = 'mqtt' | 'snapshot' | 'ops' | 'settings' | 'blob';

export type E2eKeys = {
  mqtt: Uint8Array;
  webdav: Uint8Array;
  blobName: Uint8Array;
  fingerprint: string;
};

const MAGIC = new Uint8Array([0x54, 0x5a, 0x45, 0x31]); // "TZE1"
const MQTT_PREFIX = 'tze1:';
const NONCE_LEN = 12;
const TAG_LEN = 16;
/** MQTT messages further than this from our clock are treated as replays. */
export const MQTT_MAX_SKEW_MS = 10 * 60 * 1000;

const utf8 = (text: string) => new TextEncoder().encode(text);

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

/** Standard or URL-safe alphabet, padding optional. Null on bad input. */
export function base64Decode(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, '').replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    value = (value << 6) | B64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

function aad(kind: E2eKind) {
  return utf8(`tiez-e2e-v1/${kind}`);
}

function keyFor(keys: E2eKeys, kind: E2eKind) {
  return kind === 'mqtt' ? keys.mqtt : keys.webdav;
}

export function keysFromMaster(master: Uint8Array): E2eKeys {
  const hex = toHex(sha256(master).slice(0, 4)).toUpperCase();
  return {
    mqtt: hmac(sha256, master, utf8('tiez-e2e-v1 mqtt')),
    webdav: hmac(sha256, master, utf8('tiez-e2e-v1 webdav')),
    blobName: hmac(sha256, master, utf8('tiez-e2e-v1 blob-name')),
    fingerprint: `${hex.slice(0, 4)}-${hex.slice(4)}`,
  };
}

/** Parse a shared key (base64url, 32 bytes). Null if it isn't one. */
export function parseE2eKey(text: string | null | undefined): E2eKeys | null {
  if (!text?.trim()) return null;
  const master = base64Decode(text.trim());
  return master && master.length === 32 ? keysFromMaster(master) : null;
}

export function isSealed(data: Uint8Array) {
  return data.length >= MAGIC.length && MAGIC.every((b, i) => data[i] === b);
}

export function sealWithNonce(keys: E2eKeys, kind: E2eKind, plaintext: Uint8Array, nonce: Uint8Array) {
  const sealed = gcm(keyFor(keys, kind), nonce, aad(kind)).encrypt(plaintext);
  const out = new Uint8Array(MAGIC.length + NONCE_LEN + sealed.length);
  out.set(MAGIC, 0);
  out.set(nonce, MAGIC.length);
  out.set(sealed, MAGIC.length + NONCE_LEN);
  return out;
}

/** Null for anything that isn't a valid box for this key and kind. */
export function openBox(keys: E2eKeys, kind: E2eKind, data: Uint8Array): Uint8Array | null {
  if (!isSealed(data) || data.length < MAGIC.length + NONCE_LEN + TAG_LEN) return null;
  const nonce = data.slice(MAGIC.length, MAGIC.length + NONCE_LEN);
  try {
    return gcm(keyFor(keys, kind), nonce, aad(kind)).decrypt(data.slice(MAGIC.length + NONCE_LEN));
  } catch {
    return null;
  }
}

/** Keyed blob file name, so names don't reveal content hashes. */
export function blobName(keys: E2eKeys, plaintext: Uint8Array) {
  return toHex(hmac(sha256, keys.blobName, plaintext));
}

export function sealMqttTextWithNonce(keys: E2eKeys, json: string, nonce: Uint8Array) {
  return MQTT_PREFIX + base64Encode(sealWithNonce(keys, 'mqtt', utf8(json), nonce));
}

export function isSealedMqttText(payload: string) {
  return payload.trimStart().startsWith(MQTT_PREFIX);
}

export { toHex };
