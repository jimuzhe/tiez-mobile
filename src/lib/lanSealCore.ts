// LAN transfer encryption, pure functions (no Expo imports, so Node can test
// them). Follows docs/LAN-TRANSFER-ENCRYPTION.md in the desktop repo byte for
// byte: "TZL1" || nonce || AES-256-GCM ciphertext || tag, AAD
// "tiez-lan-v1/<kind>".
import { gcm } from '@noble/ciphers/aes';

export type LanKind = 'poll' | 'text' | 'upload' | 'ws' | `download/${number}/${0 | 1}`;

const MAGIC = new Uint8Array([0x54, 0x5a, 0x4c, 0x31]); // "TZL1"
const NONCE_LEN = 12;
const OVERHEAD = MAGIC.length + NONCE_LEN + 16;

const utf8 = (text: string) => new TextEncoder().encode(text);
const aad = (kind: string) => utf8(`tiez-lan-v1/${kind}`);

/** The `k` value of the pairing URL's fragment: 43 base64url characters. */
export function parseLanKey(text: string | null | undefined): Uint8Array | null {
  const value = (text || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '=';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of b64) {
    if (ch === '=') break;
    buffer = (buffer << 6) | alphabet.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out.length === 32 ? Uint8Array.from(out) : null;
}

export function sealLanWithNonce(key: Uint8Array, kind: string, plain: Uint8Array, nonce: Uint8Array) {
  const body = gcm(key, nonce, aad(kind)).encrypt(plain);
  const out = new Uint8Array(OVERHEAD - 16 + body.length);
  out.set(MAGIC, 0);
  out.set(nonce, MAGIC.length);
  out.set(body, MAGIC.length + NONCE_LEN);
  return out;
}

/** Null when the box is malformed, for another kind, or tampered with. */
export function openLan(key: Uint8Array, kind: string, data: Uint8Array): Uint8Array | null {
  if (data.length < OVERHEAD || MAGIC.some((byte, i) => data[i] !== byte)) return null;
  try {
    return gcm(key, data.subarray(4, 16), aad(kind)).decrypt(data.subarray(16));
  } catch {
    return null;
  }
}

/** Upload payload: u32 BE metadata length || metadata JSON || chunk bytes. */
export function buildUploadPayload(metadata: unknown, chunk: Uint8Array) {
  const meta = utf8(JSON.stringify(metadata));
  const out = new Uint8Array(4 + meta.length + chunk.length);
  new DataView(out.buffer).setUint32(0, meta.length);
  out.set(meta, 4);
  out.set(chunk, 4 + meta.length);
  return out;
}

/**
 * A sealed download (`u32 BE length || box` frames) back to the file's bytes.
 * Frame i opens only as `download/<i>/<last>`, and the last frame is the one
 * nothing follows, so dropped, reordered or cut-off frames all fail.
 */
export function openDownloadFrames(key: Uint8Array, stream: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  let offset = 0;
  let index = 0;
  let total = 0;
  while (offset < stream.length) {
    if (stream.length - offset < 4) return null;
    const len = new DataView(stream.buffer, stream.byteOffset + offset, 4).getUint32(0);
    const end = offset + 4 + len;
    if (end > stream.length) return null;
    const last = end === stream.length;
    const plain = openLan(key, `download/${index}/${last ? 1 : 0}`, stream.subarray(offset + 4, end));
    if (!plain) return null;
    parts.push(plain);
    total += plain.length;
    offset = end;
    index++;
  }
  if (index === 0) return null;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Message links point at /download/<token>?name=; the sealed stream lives at /s/download/<token>. */
export const sealedDownloadPath = (url: string) => url.replace(/^\/download\//, '/s/download/').split('?')[0];
