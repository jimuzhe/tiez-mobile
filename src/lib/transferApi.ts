// Requests to the desktop's LAN transfer server. With a key from the pairing
// QR code everything goes through the sealed routes
// (docs/LAN-TRANSFER-ENCRYPTION.md); desktops without encryption get the old
// plaintext requests.
import { File } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { base64Decode } from './e2eCore';
import { buildUploadPayload, openDownloadStream, openLan, sealedDownloadPath, sealLan } from './lanSeal';
import { buildTransferHeaders, buildTransferUrl, type TransferConnection } from './transferConnection';

const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decodeJson = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
const OCTET = { 'Content-Type': 'application/octet-stream' };
const JSON_TYPE = { 'Content-Type': 'application/json' };

export function encodeSocketMessage(connection: TransferConnection, message: unknown): string | ArrayBuffer {
  if (!connection.lanKey) return JSON.stringify(message);
  const boxed = sealLan(connection.lanKey, 'ws', encodeJson(message));
  return boxed.buffer.slice(boxed.byteOffset, boxed.byteOffset + boxed.byteLength) as ArrayBuffer;
}

export function decodeSocketMessage(connection: TransferConnection, data: unknown) {
  if (!connection.lanKey) return JSON.parse(String(data));
  const plain = data instanceof ArrayBuffer ? openLan(connection.lanKey, 'ws', new Uint8Array(data)) : null;
  if (!plain) throw new Error('Unreadable sealed message');
  return decodeJson(plain);
}

export async function fetchTransferMessages(connection: TransferConnection, lastId = 0) {
  const path = connection.lanKey ? '/s/poll' : '/poll';
  const res = await fetch(buildTransferUrl(connection, `${path}?last_id=${lastId}`), {
    headers: buildTransferHeaders(connection),
  });
  if (!res.ok) throw new Error(`History request failed with status ${res.status}`);
  if (!connection.lanKey) return res.json();
  const plain = openLan(connection.lanKey, 'poll', new Uint8Array(await res.arrayBuffer()));
  if (!plain) throw new Error('Unreadable history');
  return decodeJson(plain);
}

export function sendTransferText(
  connection: TransferConnection,
  payload: { content: string; sender_id: string; sender_name: string },
  signal?: AbortSignal,
) {
  if (!connection.lanKey) {
    return fetch(buildTransferUrl(connection, '/send_text'), {
      method: 'POST',
      headers: buildTransferHeaders(connection, JSON_TYPE),
      body: JSON.stringify(payload),
      signal,
    });
  }
  return fetch(buildTransferUrl(connection, '/s/send-text'), {
    method: 'POST',
    headers: buildTransferHeaders(connection, OCTET),
    body: sealLan(connection.lanKey, 'text', encodeJson(payload)),
    signal,
  });
}

export function uploadTransferChunk(connection: TransferConnection, metadata: unknown, chunkBase64: string) {
  if (!connection.lanKey) {
    return fetch(buildTransferUrl(connection, '/upload-chunk-base64'), {
      method: 'POST',
      headers: buildTransferHeaders(connection, JSON_TYPE),
      body: JSON.stringify({ metadata, data_base64: chunkBase64 }),
    });
  }
  const chunk = chunkBase64 ? base64Decode(chunkBase64) : new Uint8Array(0);
  if (!chunk) throw new Error('Unreadable chunk');
  return fetch(buildTransferUrl(connection, '/s/upload-chunk'), {
    method: 'POST',
    headers: buildTransferHeaders(connection, OCTET),
    body: sealLan(connection.lanKey, 'upload', buildUploadPayload(metadata, chunk)),
  });
}

/** Saves a message's file to `targetUri` and returns it. */
export async function downloadTransferFile(connection: TransferConnection, url: string, targetUri: string) {
  if (!connection.lanKey) {
    const result = await LegacyFileSystem.downloadAsync(buildTransferUrl(connection, url), targetUri);
    return result.uri;
  }
  // The sealed stream goes to disk natively, then opens a frame at a time,
  // so memory holds one frame whatever the file's size. Both scratch files
  // get plain ASCII names; only the final move sees the real file name.
  const scratch = `${LegacyFileSystem.cacheDirectory ?? ''}tiez-lan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const sealedUri = `${scratch}.sealed`;
  const plainUri = `${scratch}.part`;
  try {
    const result = await LegacyFileSystem.downloadAsync(
      buildTransferUrl(connection, sealedDownloadPath(url)),
      sealedUri,
      { headers: buildTransferHeaders(connection) },
    );
    if (result.status !== 200) throw new Error(`Download failed with status ${result.status}`);
    const sealed = new File(sealedUri);
    const plain = new File(plainUri);
    plain.create({ overwrite: true });
    const input = sealed.open();
    const output = plain.open();
    let opened = false;
    try {
      opened = await openDownloadStream(
        connection.lanKey,
        sealed.size,
        (length) => input.readBytes(length),
        (bytes) => output.writeBytes(bytes),
      );
    } finally {
      input.close();
      output.close();
    }
    if (!opened) throw new Error('Unreadable download');
    await LegacyFileSystem.deleteAsync(targetUri, { idempotent: true });
    await LegacyFileSystem.moveAsync({ from: plainUri, to: targetUri });
    return targetUri;
  } finally {
    await LegacyFileSystem.deleteAsync(sealedUri, { idempotent: true });
    await LegacyFileSystem.deleteAsync(plainUri, { idempotent: true });
  }
}

const mediaCache = new Map<string, Promise<string>>();

/**
 * Where <Image>/<VideoView> can load a message's picture or video: the URL
 * itself without encryption, a decrypted cache file with it.
 */
export function resolveTransferMedia(connection: TransferConnection, url: string): Promise<string> {
  if (!connection.lanKey) return Promise.resolve(buildTransferUrl(connection, url));
  const cacheKey = `${connection.baseUrl}${url}`;
  let pending = mediaCache.get(cacheKey);
  if (!pending) {
    const token = url.split('?')[0].split('/').pop() || `${Date.now()}`;
    const name = decodeURIComponent(url.split('name=')[1] || '');
    const ext = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? '';
    const target = `${LegacyFileSystem.cacheDirectory ?? ''}tiez-lan-${token.replace(/[^\w-]/g, '')}${ext}`;
    pending = downloadTransferFile(connection, url, target).catch((error) => {
      mediaCache.delete(cacheKey);
      throw error;
    });
    mediaCache.set(cacheKey, pending);
  }
  return pending;
}
