import AsyncStorage from '@react-native-async-storage/async-storage';

export type RecentLimit = number;
export type PushStrategy = 'mqtt' | 'webdav';
export type MqttProtocol = 'ws://' | 'wss://';

export type MobileSyncSettings = {
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavBasePath: string;
  mqttServer: string;
  mqttPort: string;
  mqttUsername: string;
  mqttPassword: string;
  mqttTopic: string;
  mqttClientId: string;
  mqttProtocol: MqttProtocol;
  mqttWsPath: string;
  mqttTlsInsecure: boolean;
  autoPushOnLaunch: boolean;
  pushStrategy: PushStrategy;
  recentLimit: RecentLimit;
};

import { publishToMqtt, publishBatchToMqtt } from './mqtt_client';

export type SyncedEntry = {
  id: string;
  content_type: string;
  content: string;
  html_content?: string | null;
  source_app: string;
  timestamp: number;
  preview: string;
  is_pinned?: boolean;
  tags: string[];
  use_count?: number;
  pinned_order?: number;
};

export type WebDavDisplayRecord = {
  tags: string[];
  entriesByTag: Record<string, SyncedEntry[]>;
  recentEntries: SyncedEntry[];
};

export type LocalClipboardEntry = {
  id: string;
  content: string;
  createdAt: number;
};

type CloudSyncItem = {
  content_type: string;
  content: string;
  content_hash: number;
  deleted_at: number;
  html_content?: string | null;
  content_blob_hash?: string | null;
  html_blob_hash?: string | null;
  source_app: string;
  timestamp: number;
  preview: string;
  is_pinned: boolean;
  tags: string[];
  use_count: number;
  pinned_order: number;
};

type WebDavDeviceSnapshot = {
  device_id: string;
  updated_at: number;
  latest_op_seq: number;
  entries: CloudSyncItem[];
};

type WebDavOpsBatch = {
  device_id: string;
  seq: number;
  updated_at: number;
  entries: CloudSyncItem[];
};

type WebDavDeviceHead = {
  latest_op_seq: number;
  snapshot_updated_at: number;
  snapshot_op_seq: number;
  settings_updated_at: number;
};

type WebDavSyncHead = {
  updated_at: number;
  devices: Record<string, WebDavDeviceHead>;
};

type WebDavOpRef = {
  device_id: string;
  seq: number;
};

type WebDavPaths = {
  devicesPath: string;
  settingsPath: string;
  opsPath: string;
  headPath: string;
  blobsPath: string;
};

export const STORAGE_KEYS = {
  webdavUrl: 'mobile.cloud_sync_webdav_url',
  webdavUsername: 'mobile.cloud_sync_webdav_username',
  webdavPassword: 'mobile.cloud_sync_webdav_password',
  webdavBasePath: 'mobile.cloud_sync_webdav_base_path',
  mqttServer: 'mobile.sync_mqtt_server',
  mqttPort: 'mobile.sync_mqtt_port',
  mqttUsername: 'mobile.sync_mqtt_username',
  mqttPassword: 'mobile.sync_mqtt_password',
  mqttTopic: 'mobile.sync_mqtt_topic',
  mqttClientId: 'mobile.sync_mqtt_client_id',
  mqttProtocol: 'mobile.sync_mqtt_protocol',
  mqttWsPath: 'mobile.sync_mqtt_ws_path',
  mqttTlsInsecure: 'mobile.sync_mqtt_tls_insecure',
  autoPushOnLaunch: 'mobile.auto_push_on_launch',
  pushStrategy: 'mobile.push_strategy',
  recentLimit: 'mobile.home_recent_limit',
  lastDeviceIp: 'lastDeviceIp',
  pushHistory: 'mobile.push_clipboard_history',
  webdavDeviceId: 'mobile.cloud_sync_webdav_device_id',
  webdavLocalSeq: 'mobile.cloud_sync_webdav_local_seq',
  webdavOpCursorMap: 'mobile.cloud_sync_webdav_op_cursor_map',
  webdavLocalIndex: 'mobile.cloud_sync_webdav_local_index',
  webdavLocalItems: 'mobile.cloud_sync_webdav_local_items',
  webdavPulledItems: 'mobile.cloud_sync_webdav_pulled_items',
} as const;

const LOCAL_SYNC_CACHE_KEYS = [
  STORAGE_KEYS.webdavLocalSeq,
  STORAGE_KEYS.webdavOpCursorMap,
  STORAGE_KEYS.webdavLocalIndex,
  STORAGE_KEYS.webdavLocalItems,
  STORAGE_KEYS.webdavPulledItems,
] as const;

const DEFAULT_SETTINGS: MobileSyncSettings = {
  webdavUrl: '',
  webdavUsername: '',
  webdavPassword: '',
  webdavBasePath: 'tiez-sync',
  mqttServer: '',
  mqttPort: '443',
  mqttUsername: '',
  mqttPassword: '',
  mqttTopic: '',
  mqttClientId: `tiez_mobile_${Math.random().toString(36).substring(2, 10)}`,
  mqttProtocol: 'wss://',
  mqttWsPath: '/mqtt',
  mqttTlsInsecure: false,
  autoPushOnLaunch: false,
  pushStrategy: 'mqtt',
  recentLimit: 10,
};

const MAX_LOCAL_SYNC_ITEMS = 200;
const MAX_REMOTE_SYNC_ITEMS = 400;
const WEBDAV_HEAD_FILENAME = 'head.json';
const WEBDAV_DEBUG_LOG = __DEV__;
const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getlastmodified />
  </d:prop>
</d:propfind>`;
const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function nowMs() {
  return Date.now();
}

function estimateStorageBytes(value: string | null) {
  if (!value) return 0;
  return value.length * 2;
}

export function formatCacheSize(bytes: number) {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function getLocalSyncCacheSize() {
  const pairs = await AsyncStorage.multiGet([...LOCAL_SYNC_CACHE_KEYS]);
  return pairs.reduce((total, [, value]) => total + estimateStorageBytes(value), 0);
}

export async function clearLocalSyncCache() {
  await AsyncStorage.multiRemove([...LOCAL_SYNC_CACHE_KEYS]);
}

function truncateLogText(value: string, limit = 240) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
}

function logWebDavDebug(message: string, extra?: Record<string, unknown>) {
  if (!WEBDAV_DEBUG_LOG) return;
  if (extra) {
    console.log(`[WebDAV] ${message}`, extra);
  } else {
    console.log(`[WebDAV] ${message}`);
  }
}

function encodeBase64(input: string) {
  let output = '';
  let i = 0;

  while (i < input.length) {
    const chr1 = input.charCodeAt(i++);
    const chr2 = input.charCodeAt(i++);
    const chr3 = input.charCodeAt(i++);

    const enc1 = chr1 >> 2;
    const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
    let enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
    let enc4 = chr3 & 63;

    if (Number.isNaN(chr2)) {
      enc3 = 64;
      enc4 = 64;
    } else if (Number.isNaN(chr3)) {
      enc4 = 64;
    }

    output +=
      base64Chars.charAt(enc1) +
      base64Chars.charAt(enc2) +
      base64Chars.charAt(enc3) +
      base64Chars.charAt(enc4);
  }

  return output;
}

function normalizeWebDavBasePath(raw: string) {
  return raw.trim().replace(/^\/+|\/+$/g, '');
}

function encodeRelativePath(relativePath: string) {
  return relativePath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function joinWebDavUrl(baseUrl: string, relativePath: string) {
  const trimmedBase = baseUrl.trim().replace(/\/+$/g, '');
  const encodedPath = encodeRelativePath(relativePath);
  return encodedPath ? `${trimmedBase}/${encodedPath}` : trimmedBase;
}

function buildAuthHeaders(settings: MobileSyncSettings, extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    ...extra,
  };

  if (settings.webdavUsername.trim()) {
    headers.Authorization = `Basic ${encodeBase64(
      `${settings.webdavUsername.trim()}:${settings.webdavPassword.trim()}`
    )}`;
  }

  return headers;
}

function buildWebDavPaths(settings: MobileSyncSettings): WebDavPaths {
  const base = normalizeWebDavBasePath(settings.webdavBasePath);
  return {
    devicesPath: base ? `${base}/devices` : 'devices',
    settingsPath: base ? `${base}/settings` : 'settings',
    opsPath: base ? `${base}/ops` : 'ops',
    headPath: base ? `${base}/${WEBDAV_HEAD_FILENAME}` : WEBDAV_HEAD_FILENAME,
    blobsPath: base ? `${base}/blobs` : 'blobs',
  };
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function computeSyncContentHash(contentType: string, content: string) {
  return hashString(`${contentType}:${content}`);
}

function resolvedContentHash(item: CloudSyncItem) {
  return item.content_hash || computeSyncContentHash(item.content_type, item.content);
}

function syncKeyForItem(item: CloudSyncItem) {
  const hash = resolvedContentHash(item);
  if (!hash) return null;
  return `${item.content_type}:${hash}`;
}

function syncDigestForItem(item: CloudSyncItem) {
  const digestSeed = JSON.stringify({
    contentHash: resolvedContentHash(item),
    contentBlobHash: item.content_blob_hash ?? '',
    deletedAt: item.deleted_at,
    htmlContent: item.html_content ?? '',
    htmlBlobHash: item.html_blob_hash ?? '',
    isPinned: item.is_pinned,
    pinnedOrder: item.pinned_order,
    preview: item.preview,
    sourceApp: item.source_app,
    tags: item.tags,
    timestamp: item.timestamp,
    useCount: item.use_count,
  });
  return String(hashString(digestSeed));
}

function normalizeCloudItem(item: Partial<CloudSyncItem> & Pick<CloudSyncItem, 'content_type' | 'content'>): CloudSyncItem {
  return {
    content_type: item.content_type,
    content: item.content,
    content_hash: item.content_hash ?? computeSyncContentHash(item.content_type, item.content),
    deleted_at: item.deleted_at ?? 0,
    html_content: item.html_content ?? null,
    content_blob_hash: item.content_blob_hash ?? null,
    html_blob_hash: item.html_blob_hash ?? null,
    source_app: item.source_app ?? 'mobile',
    timestamp: item.timestamp ?? nowMs(),
    preview: item.preview ?? item.content.slice(0, 160),
    is_pinned: item.is_pinned ?? false,
    tags: item.tags ?? [],
    use_count: item.use_count ?? 0,
    pinned_order: item.pinned_order ?? 0,
  };
}

function toSyncedEntry(item: CloudSyncItem, index: number): SyncedEntry {
  const isRichText = item.content_type === 'rich_text';
  return {
    id: `${resolvedContentHash(item)}-${item.timestamp}-${index}`,
    content_type: isRichText ? 'text' : item.content_type,
    content: item.content,
    html_content: null,
    source_app: item.source_app,
    timestamp: item.timestamp,
    preview: item.preview,
    is_pinned: item.is_pinned,
    tags: item.tags,
    use_count: item.use_count,
    pinned_order: item.pinned_order,
  };
}

function collapseItemsBySyncKey(items: CloudSyncItem[]) {
  const map = new Map<string, CloudSyncItem>();

  items.forEach((rawItem) => {
    const item = normalizeCloudItem(rawItem);
    const syncKey = syncKeyForItem(item);
    if (!syncKey) return;

    const existing = map.get(syncKey);
    if (!existing || item.timestamp >= existing.timestamp) {
      map.set(syncKey, item);
    }
  });

  return map;
}

function sortCloudItemsDesc(items: CloudSyncItem[]) {
  return [...items].sort((left, right) => right.timestamp - left.timestamp);
}

function parseSnapshotIds(xml: string) {
  const ids = new Set<string>();
  const hrefMatches = xml.matchAll(/<[^>]*href[^>]*>(.*?)<\/[^>]*href>/gi);

  for (const match of hrefMatches) {
    const href = decodeURIComponent(match[1] ?? '').trim();
    const normalized = href.replace(/\/+$/g, '');
    const fileName = normalized.split('/').pop();
    if (!fileName?.endsWith('.json')) continue;
    const id = fileName.replace(/\.json$/i, '');
    if (!id || id === 'head') continue;
    ids.add(id);
  }

  return Array.from(ids);
}

function parseWebDavOpRefs(xml: string) {
  const refs = new Map<string, WebDavOpRef>();
  const hrefMatches = xml.matchAll(/<[^>]*href[^>]*>(.*?)<\/[^>]*href>/gi);

  for (const match of hrefMatches) {
    const href = decodeURIComponent(match[1] ?? '').trim().replace(/\/+$/g, '');
    const fileName = href.split('/').pop();
    if (!fileName) continue;

    const parsed = fileName.match(/^(.+)__(\d+)\.json$/);
    if (!parsed) continue;

    const deviceId = parsed[1];
    const seq = Number(parsed[2]);
    if (!deviceId || Number.isNaN(seq)) continue;

    refs.set(`${deviceId}:${seq}`, {
      device_id: deviceId,
      seq,
    });
  }

  return Array.from(refs.values()).sort((left, right) =>
    left.device_id.localeCompare(right.device_id) || left.seq - right.seq
  );
}

function getBlobPath(baseBlobs: string, kind: string, hash: string) {
  const prefix = hash.length >= 2 ? hash.slice(0, 2) : 'xx';
  return `${baseBlobs}/${prefix}/${kind}_${hash}.blob`;
}

function guessImageMime(bytes: Uint8Array) {
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6) {
    const header = String.fromCharCode(...bytes.slice(0, 6));
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  }
  return 'image/png';
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return encodeBase64(binary);
}

function imageDataUrlFromBytes(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes).trim();
  if (text.startsWith('data:image/')) {
    return text;
  }
  const mime = guessImageMime(bytes);
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

async function fetchWebDavBlob(settings: MobileSyncSettings, blobsPath: string, kind: string, hash: string) {
  const relativePath = getBlobPath(blobsPath, kind, hash);
  const url = joinWebDavUrl(settings.webdavUrl, relativePath);
  logWebDavDebug('BLOB request', { url, kind, hash });
  const response = await fetch(url, {
    headers: buildAuthHeaders(settings),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logWebDavDebug('BLOB failed', {
      url,
      status: response.status,
      body: truncateLogText(text),
    });
    throw new Error(`WebDAV blob 读取失败：${response.status}${text ? ` ${text}` : ''}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  logWebDavDebug('BLOB success', {
    url,
    status: response.status,
    bytes: buffer.length,
  });
  return buffer;
}

async function enrichCloudItemsAfterPull(items: CloudSyncItem[], settings: MobileSyncSettings, blobsPath: string) {
  for (const item of items) {
    if (item.content_blob_hash) {
      const kind = item.content_type === 'image' ? 'image' : 'content';
      const bytes = await fetchWebDavBlob(settings, blobsPath, kind, item.content_blob_hash);
      item.content = item.content_type === 'image'
        ? imageDataUrlFromBytes(bytes)
        : new TextDecoder().decode(bytes);
    }

    if (item.content_type === 'rich_text') {
      item.html_content = null;
      item.html_blob_hash = null;
    } else if (item.html_blob_hash) {
      const bytes = await fetchWebDavBlob(settings, blobsPath, 'html', item.html_blob_hash);
      item.html_content = new TextDecoder().decode(bytes);
    }

    if (!item.preview.trim()) {
      if (item.content_type === 'image') {
        item.preview = '图片';
      } else {
        item.preview = item.content.slice(0, 160);
      }
    }
  }

  return items;
}

function isVisibleCloudItem(item: CloudSyncItem) {
  if (item.deleted_at > 0) return false;
  return ['text', 'code', 'url', 'rich_text', 'image'].includes(item.content_type);
}

function dedupeEntries(entries: SyncedEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = [
      entry.content_type,
      entry.content,
      entry.preview,
      entry.timestamp,
      entry.tags.join('|'),
    ].join('::');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadJsonStorage<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function saveJsonStorage(key: string, value: unknown) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function getMobileWebDavDeviceId() {
  const existing = await AsyncStorage.getItem(STORAGE_KEYS.webdavDeviceId);
  if (existing?.trim()) return existing;

  const generated = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(STORAGE_KEYS.webdavDeviceId, generated);
  return generated;
}

async function loadLocalWebDavSeq() {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.webdavLocalSeq);
  return raw ? Number(raw) || 0 : 0;
}

async function saveLocalWebDavSeq(seq: number) {
  await AsyncStorage.setItem(STORAGE_KEYS.webdavLocalSeq, String(seq));
}

async function loadWebDavOpCursorMap() {
  return loadJsonStorage<Record<string, number>>(STORAGE_KEYS.webdavOpCursorMap, {});
}

async function saveWebDavOpCursorMap(map: Record<string, number>) {
  await saveJsonStorage(STORAGE_KEYS.webdavOpCursorMap, map);
}

async function loadWebDavLocalIndex() {
  return loadJsonStorage<Record<string, string>>(STORAGE_KEYS.webdavLocalIndex, {});
}

async function saveWebDavLocalIndex(index: Record<string, string>) {
  await saveJsonStorage(STORAGE_KEYS.webdavLocalIndex, index);
}

async function loadWebDavLocalItems() {
  const rawItems = await loadJsonStorage<CloudSyncItem[]>(STORAGE_KEYS.webdavLocalItems, []);
  return rawItems.map((item) => normalizeCloudItem(item)).slice(0, MAX_LOCAL_SYNC_ITEMS);
}

async function saveWebDavLocalItems(items: CloudSyncItem[]) {
  await saveJsonStorage(
    STORAGE_KEYS.webdavLocalItems,
    sortCloudItemsDesc(items).slice(0, MAX_LOCAL_SYNC_ITEMS)
  );
}

async function loadWebDavPulledItems() {
  const rawItems = await loadJsonStorage<CloudSyncItem[]>(STORAGE_KEYS.webdavPulledItems, []);
  return rawItems.map((item) => normalizeCloudItem(item)).slice(0, MAX_REMOTE_SYNC_ITEMS);
}

async function saveWebDavPulledItems(items: CloudSyncItem[]) {
  await saveJsonStorage(
    STORAGE_KEYS.webdavPulledItems,
    sortCloudItemsDesc(items).slice(0, MAX_REMOTE_SYNC_ITEMS)
  );
}

async function ensureWebDavDirectories(settings: MobileSyncSettings) {
  const paths = buildWebDavPaths(settings);
  const base = normalizeWebDavBasePath(settings.webdavBasePath);
  let current = '';

  for (const segment of base.split('/').filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    await mkcolIfNeeded(settings, current);
  }

  await mkcolIfNeeded(settings, paths.devicesPath);
  await mkcolIfNeeded(settings, paths.settingsPath);
  await mkcolIfNeeded(settings, paths.opsPath);
  await mkcolIfNeeded(settings, paths.blobsPath);

  return paths;
}

async function mkcolIfNeeded(settings: MobileSyncSettings, relativePath: string) {
  const url = joinWebDavUrl(settings.webdavUrl, relativePath);
  logWebDavDebug('MKCOL request', { url, relativePath });
  const response = await fetch(url, {
    method: 'MKCOL',
    headers: buildAuthHeaders(settings),
  });

  logWebDavDebug('MKCOL response', { url, status: response.status });

  if (
    response.ok ||
    response.status === 301 ||
    response.status === 405 ||
    response.status === 409
  ) {
    return;
  }

  throw new Error(`WebDAV 目录创建失败：${response.status}`);
}

async function listWebDavCollection(settings: MobileSyncSettings, relativePath: string) {
  const url = joinWebDavUrl(settings.webdavUrl, relativePath);
  logWebDavDebug('PROPFIND request', { url, relativePath });
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: buildAuthHeaders(settings, {
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    }),
    body: PROPFIND_BODY,
  });

  if (!response.ok && response.status !== 207) {
    const text = await response.text().catch(() => '');
    logWebDavDebug('PROPFIND failed', {
      url,
      status: response.status,
      body: truncateLogText(text),
    });
    throw new Error(`WebDAV 列表读取失败：${response.status}${text ? ` ${text}` : ''}`);
  }

  const text = await response.text();
  logWebDavDebug('PROPFIND success', {
    url,
    status: response.status,
    body: truncateLogText(text),
  });
  return text;
}

async function fetchWebDavJson<T>(settings: MobileSyncSettings, relativePath: string) {
  const url = joinWebDavUrl(settings.webdavUrl, relativePath);
  logWebDavDebug('GET request', { url, relativePath });
  const response = await fetch(url, {
    headers: buildAuthHeaders(settings),
  });

  if (response.status === 404 || response.status === 409) {
    logWebDavDebug('GET missing', { url, status: response.status });
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logWebDavDebug('GET failed', {
      url,
      status: response.status,
      body: truncateLogText(text),
    });
    throw new Error(`WebDAV 读取失败：${response.status}${text ? ` ${text}` : ''}`);
  }

  const text = await response.text();
  logWebDavDebug('GET success', {
    url,
    status: response.status,
    body: truncateLogText(text),
  });
  return JSON.parse(text) as T;
}

async function putWebDavJson(settings: MobileSyncSettings, relativePath: string, payload: unknown) {
  const url = joinWebDavUrl(settings.webdavUrl, relativePath);
  logWebDavDebug('PUT request', {
    url,
    relativePath,
    body: truncateLogText(JSON.stringify(payload)),
  });
  const response = await fetch(url, {
    method: 'PUT',
    headers: buildAuthHeaders(settings, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logWebDavDebug('PUT failed', {
      url,
      status: response.status,
      body: truncateLogText(text),
    });
    throw new Error(`WebDAV 写入失败：${response.status}${text ? ` ${text}` : ''}`);
  }

  logWebDavDebug('PUT success', { url, status: response.status });
}

async function listWebDavSnapshotIds(settings: MobileSyncSettings, devicesPath: string) {
  return parseSnapshotIds(await listWebDavCollection(settings, devicesPath));
}

async function fetchWebDavSnapshot(
  settings: MobileSyncSettings,
  devicesPath: string,
  blobsPath: string,
  deviceId: string
) {
  const snapshot = await fetchWebDavJson<WebDavDeviceSnapshot>(
    settings,
    `${devicesPath}/${deviceId}.json`
  );
  if (!snapshot) return null;

  const normalized = {
        ...snapshot,
        latest_op_seq: snapshot.latest_op_seq ?? 0,
        entries: Array.isArray(snapshot.entries)
          ? snapshot.entries.map((entry) => normalizeCloudItem(entry))
          : [],
      };

  await enrichCloudItemsAfterPull(normalized.entries, settings, blobsPath);
  return normalized;
}

function webDavOpsFilename(deviceId: string, seq: number) {
  return `${deviceId}__${String(Math.max(seq, 0)).padStart(20, '0')}.json`;
}

async function listWebDavOpRefs(settings: MobileSyncSettings, opsPath: string) {
  return parseWebDavOpRefs(await listWebDavCollection(settings, opsPath));
}

async function fetchWebDavOpsBatch(
  settings: MobileSyncSettings,
  opsPath: string,
  blobsPath: string,
  opRef: WebDavOpRef
) {
  const batch = await fetchWebDavJson<WebDavOpsBatch>(
    settings,
    `${opsPath}/${webDavOpsFilename(opRef.device_id, opRef.seq)}`
  );

  if (!batch) return null;

  const normalized = {
        ...batch,
        entries: Array.isArray(batch.entries)
          ? batch.entries.map((entry) => normalizeCloudItem(entry))
          : [],
      };

  await enrichCloudItemsAfterPull(normalized.entries, settings, blobsPath);
  return normalized;
}

async function fetchWebDavSyncHead(settings: MobileSyncSettings, headPath: string) {
  const head = await fetchWebDavJson<WebDavSyncHead>(settings, headPath);
  if (!head) return null;

  const normalizedDevices = Object.fromEntries(
    Object.entries(head.devices ?? {}).map(([deviceId, deviceHead]) => [
      deviceId,
      {
        latest_op_seq: deviceHead.latest_op_seq ?? 0,
        snapshot_updated_at: deviceHead.snapshot_updated_at ?? 0,
        snapshot_op_seq: deviceHead.snapshot_op_seq ?? 0,
        settings_updated_at: deviceHead.settings_updated_at ?? 0,
      },
    ])
  );

  return {
    updated_at: head.updated_at ?? 0,
    devices: normalizedDevices,
  };
}

async function uploadWebDavSyncHead(
  settings: MobileSyncSettings,
  headPath: string,
  head: WebDavSyncHead
) {
  await putWebDavJson(settings, headPath, head);
}

async function uploadWebDavOpsBatch(
  settings: MobileSyncSettings,
  opsPath: string,
  deviceId: string,
  seq: number,
  entries: CloudSyncItem[]
) {
  const batch: WebDavOpsBatch = {
    device_id: deviceId,
    seq,
    updated_at: nowMs(),
    entries,
  };

  await putWebDavJson(settings, `${opsPath}/${webDavOpsFilename(deviceId, seq)}`, batch);
}

async function uploadWebDavSnapshot(
  settings: MobileSyncSettings,
  devicesPath: string,
  deviceId: string,
  latestOpSeq: number,
  entries: CloudSyncItem[]
) {
  const snapshot: WebDavDeviceSnapshot = {
    device_id: deviceId,
    updated_at: nowMs(),
    latest_op_seq: latestOpSeq,
    entries,
  };

  await putWebDavJson(settings, `${devicesPath}/${deviceId}.json`, snapshot);
}

function updateWebDavHeadDevice(
  head: WebDavSyncHead,
  deviceId: string,
  updater: (device: WebDavDeviceHead) => void
) {
  const current = head.devices[deviceId] ?? {
    latest_op_seq: 0,
    snapshot_updated_at: 0,
    snapshot_op_seq: 0,
    settings_updated_at: 0,
  };
  updater(current);
  head.devices[deviceId] = current;
}

async function rebuildWebDavSyncHead(settings: MobileSyncSettings, paths: WebDavPaths) {
  const head: WebDavSyncHead = {
    updated_at: nowMs(),
    devices: {},
  };

  const [opRefs, snapshotIds] = await Promise.all([
    listWebDavOpRefs(settings, paths.opsPath).catch(() => []),
    listWebDavSnapshotIds(settings, paths.devicesPath).catch(() => []),
  ]);

  opRefs.forEach((opRef) => {
    updateWebDavHeadDevice(head, opRef.device_id, (device) => {
      device.latest_op_seq = Math.max(device.latest_op_seq, opRef.seq);
    });
  });

  const snapshots = await Promise.all(
    snapshotIds.map(async (deviceId) => ({
      deviceId,
      snapshot: await fetchWebDavSnapshot(settings, paths.devicesPath, paths.blobsPath, deviceId).catch(() => null),
    }))
  );

  snapshots.forEach(({ deviceId, snapshot }) => {
    if (!snapshot) return;
    updateWebDavHeadDevice(head, deviceId, (device) => {
      device.latest_op_seq = Math.max(device.latest_op_seq, snapshot.latest_op_seq ?? 0);
      device.snapshot_updated_at = Math.max(device.snapshot_updated_at, snapshot.updated_at ?? 0);
      device.snapshot_op_seq = Math.max(device.snapshot_op_seq, snapshot.latest_op_seq ?? 0);
    });
  });

  return head;
}

async function resolveWebDavSyncHead(settings: MobileSyncSettings, paths: WebDavPaths) {
  const existing = await fetchWebDavSyncHead(settings, paths.headPath).catch(() => null);
  if (existing) return existing;

  return rebuildWebDavSyncHead(settings, paths);
}

function mergeCloudItems(current: CloudSyncItem[], incoming: CloudSyncItem[], maxItems: number) {
  const merged = collapseItemsBySyncKey([...current, ...incoming]);
  return sortCloudItemsDesc(Array.from(merged.values())).slice(0, maxItems);
}

function localEntryToCloudItem(entry: LocalClipboardEntry): CloudSyncItem {
  const content = entry.content.trim();
  return normalizeCloudItem({
    content_type: 'text',
    content,
    source_app: 'mobile',
    timestamp: entry.createdAt,
    preview: content.slice(0, 160),
  });
}

async function collectLocalIncrementalItems(localItems: CloudSyncItem[]) {
  const collapsed = collapseItemsBySyncKey(localItems);
  const previousIndex = await loadWebDavLocalIndex();
  const nextIndex: Record<string, string> = {};
  const deltas: CloudSyncItem[] = [];

  for (const [syncKey, item] of collapsed.entries()) {
    const digest = syncDigestForItem(item);
    nextIndex[syncKey] = digest;
    if (previousIndex[syncKey] !== digest) {
      deltas.push(item);
    }
  }

  deltas.sort((left, right) => left.timestamp - right.timestamp);
  return { deltas, nextIndex, collapsedItems: Array.from(collapsed.values()) };
}

async function syncEntriesToWebDavIncrementally(
  entries: LocalClipboardEntry[],
  settings: MobileSyncSettings
) {
  if (!entries.length || !isWebDavConfigured(settings)) return;

  const deviceId = await getMobileWebDavDeviceId();
  const paths = await ensureWebDavDirectories(settings);
  const syncHead = await resolveWebDavSyncHead(settings, paths);
  const existingLocalItems = await loadWebDavLocalItems();
  const incomingLocalItems = entries.map((entry) => localEntryToCloudItem(entry));
  const nextLocalItems = mergeCloudItems(existingLocalItems, incomingLocalItems, MAX_LOCAL_SYNC_ITEMS);
  const { deltas, nextIndex, collapsedItems } = await collectLocalIncrementalItems(nextLocalItems);

  let nextSeq = await loadLocalWebDavSeq();
  if (deltas.length > 0) {
    nextSeq += 1;
    await uploadWebDavOpsBatch(settings, paths.opsPath, deviceId, nextSeq, deltas);
    await saveLocalWebDavSeq(nextSeq);
  }

  await saveWebDavLocalItems(nextLocalItems);
  await saveWebDavLocalIndex(nextIndex);
  await uploadWebDavSnapshot(settings, paths.devicesPath, deviceId, nextSeq, collapsedItems);

  updateWebDavHeadDevice(syncHead, deviceId, (device) => {
    device.latest_op_seq = Math.max(device.latest_op_seq, nextSeq);
    device.snapshot_updated_at = nowMs();
    device.snapshot_op_seq = Math.max(device.snapshot_op_seq, nextSeq);
  });
  syncHead.updated_at = nowMs();
  await uploadWebDavSyncHead(settings, paths.headPath, syncHead);
}

async function pullRemoteWebDavOpsFromHead(
  settings: MobileSyncSettings,
  paths: WebDavPaths,
  head: WebDavSyncHead
) {
  const localDeviceId = await getMobileWebDavDeviceId();
  const cursorMap = await loadWebDavOpCursorMap();
  const existingRemoteItems = await loadWebDavPulledItems();
  let nextRemoteItems = existingRemoteItems;
  let headStale = false;

  for (const [deviceId, deviceHead] of Object.entries(head.devices)) {
    if (deviceId === localDeviceId || deviceHead.latest_op_seq <= 0) continue;

    let lastSeq = cursorMap[deviceId] ?? 0;
    if (lastSeq === 0 && (deviceHead.snapshot_op_seq ?? 0) > 0) {
      // PC 端可能已经清理了早期 ops，只保留 snapshot 之后的增量。
      lastSeq = deviceHead.snapshot_op_seq ?? 0;
      cursorMap[deviceId] = lastSeq;
      logWebDavDebug('Use snapshot_op_seq as incremental baseline', {
        deviceId,
        snapshotOpSeq: deviceHead.snapshot_op_seq ?? 0,
        latestOpSeq: deviceHead.latest_op_seq,
      });
    }
    if (deviceHead.latest_op_seq <= lastSeq) continue;

    for (let seq = lastSeq + 1; seq <= deviceHead.latest_op_seq; seq += 1) {
      const batch = await fetchWebDavOpsBatch(settings, paths.opsPath, paths.blobsPath, {
        device_id: deviceId,
        seq,
      }).catch(() => null);

      if (!batch || batch.device_id !== deviceId) {
        headStale = true;
        break;
      }

      nextRemoteItems = mergeCloudItems(nextRemoteItems, batch.entries, MAX_REMOTE_SYNC_ITEMS);
      lastSeq = Math.max(lastSeq, batch.seq, seq);
      cursorMap[deviceId] = lastSeq;
    }
  }

  await saveWebDavOpCursorMap(cursorMap);
  await saveWebDavPulledItems(nextRemoteItems);
  return { headStale, items: nextRemoteItems };
}

async function pullRemoteWebDavSnapshotsFromHead(
  settings: MobileSyncSettings,
  paths: WebDavPaths,
  head: WebDavSyncHead
) {
  const localDeviceId = await getMobileWebDavDeviceId();
  let nextRemoteItems = await loadWebDavPulledItems();

  const remoteDeviceIds = Object.entries(head.devices)
    .filter(([deviceId, deviceHead]) => deviceId !== localDeviceId && deviceHead.snapshot_updated_at > 0)
    .sort((left, right) => right[1].snapshot_updated_at - left[1].snapshot_updated_at)
    .map(([deviceId]) => deviceId);

  for (const deviceId of remoteDeviceIds) {
    const snapshot = await fetchWebDavSnapshot(settings, paths.devicesPath, paths.blobsPath, deviceId).catch(() => null);
    if (!snapshot) continue;
    nextRemoteItems = mergeCloudItems(nextRemoteItems, snapshot.entries, MAX_REMOTE_SYNC_ITEMS);
  }

  await saveWebDavPulledItems(nextRemoteItems);
  return nextRemoteItems;
}

export async function loadMobileSyncSettings(): Promise<MobileSyncSettings> {
  const [
    webdavUrl, 
    webdavUsername, 
    webdavPassword, 
    webdavBasePath, 
    recentLimitRaw,
    mqttServer,
    mqttPort,
    mqttUsername,
    mqttPassword,
    mqttTopic,
    mqttClientId,
    mqttProtocol,
    mqttWsPath,
    mqttTlsInsecure,
    autoPushOnLaunch,
    pushStrategy,
  ] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.webdavUrl),
    AsyncStorage.getItem(STORAGE_KEYS.webdavUsername),
    AsyncStorage.getItem(STORAGE_KEYS.webdavPassword),
    AsyncStorage.getItem(STORAGE_KEYS.webdavBasePath),
    AsyncStorage.getItem(STORAGE_KEYS.recentLimit),
    AsyncStorage.getItem(STORAGE_KEYS.mqttServer),
    AsyncStorage.getItem(STORAGE_KEYS.mqttPort),
    AsyncStorage.getItem(STORAGE_KEYS.mqttUsername),
    AsyncStorage.getItem(STORAGE_KEYS.mqttPassword),
    AsyncStorage.getItem(STORAGE_KEYS.mqttTopic),
    AsyncStorage.getItem(STORAGE_KEYS.mqttClientId),
    AsyncStorage.getItem(STORAGE_KEYS.mqttProtocol),
    AsyncStorage.getItem(STORAGE_KEYS.mqttWsPath),
    AsyncStorage.getItem(STORAGE_KEYS.mqttTlsInsecure),
    AsyncStorage.getItem(STORAGE_KEYS.autoPushOnLaunch),
    AsyncStorage.getItem(STORAGE_KEYS.pushStrategy),
  ]);

  const parsedLimit = recentLimitRaw ? parseInt(recentLimitRaw, 10) : 10;

  return {
    webdavUrl: webdavUrl ?? DEFAULT_SETTINGS.webdavUrl,
    webdavUsername: webdavUsername ?? DEFAULT_SETTINGS.webdavUsername,
    webdavPassword: webdavPassword ?? DEFAULT_SETTINGS.webdavPassword,
    webdavBasePath: webdavBasePath ?? DEFAULT_SETTINGS.webdavBasePath,
    recentLimit: isNaN(parsedLimit) ? 10 : parsedLimit,
    mqttServer: mqttServer ?? DEFAULT_SETTINGS.mqttServer,
    mqttPort: mqttPort ?? DEFAULT_SETTINGS.mqttPort,
    mqttUsername: mqttUsername ?? DEFAULT_SETTINGS.mqttUsername,
    mqttPassword: mqttPassword ?? DEFAULT_SETTINGS.mqttPassword,
    mqttTopic: mqttTopic ?? DEFAULT_SETTINGS.mqttTopic,
    mqttClientId: mqttClientId ?? DEFAULT_SETTINGS.mqttClientId,
    mqttProtocol: (mqttProtocol as MqttProtocol) ?? DEFAULT_SETTINGS.mqttProtocol,
    mqttWsPath: mqttWsPath ?? DEFAULT_SETTINGS.mqttWsPath,
    mqttTlsInsecure: mqttTlsInsecure === 'true',
    autoPushOnLaunch: autoPushOnLaunch === 'true',
    pushStrategy: (pushStrategy as PushStrategy) ?? DEFAULT_SETTINGS.pushStrategy,
  };
}

export async function saveMobileSyncSettings(settings: MobileSyncSettings) {
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.webdavUrl, settings.webdavUrl.trim()],
    [STORAGE_KEYS.webdavUsername, settings.webdavUsername.trim()],
    [STORAGE_KEYS.webdavPassword, settings.webdavPassword],
    [STORAGE_KEYS.webdavBasePath, normalizeWebDavBasePath(settings.webdavBasePath)],
    [STORAGE_KEYS.recentLimit, String(settings.recentLimit)],
    [STORAGE_KEYS.mqttServer, settings.mqttServer.trim()],
    [STORAGE_KEYS.mqttPort, settings.mqttPort.trim()],
    [STORAGE_KEYS.mqttUsername, settings.mqttUsername.trim()],
    [STORAGE_KEYS.mqttPassword, settings.mqttPassword],
    [STORAGE_KEYS.mqttTopic, settings.mqttTopic.trim()],
    [STORAGE_KEYS.mqttClientId, settings.mqttClientId.trim()],
    [STORAGE_KEYS.mqttProtocol, settings.mqttProtocol],
    [STORAGE_KEYS.mqttWsPath, settings.mqttWsPath.trim()],
    [STORAGE_KEYS.mqttTlsInsecure, String(settings.mqttTlsInsecure)],
    [STORAGE_KEYS.autoPushOnLaunch, String(settings.autoPushOnLaunch)],
    [STORAGE_KEYS.pushStrategy, settings.pushStrategy],
  ]);
}

export async function loadPushClipboardHistory(): Promise<LocalClipboardEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.pushHistory);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as LocalClipboardEntry[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.createdAt - a.createdAt) : [];
  } catch {
    return [];
  }
}

export async function savePushClipboardHistory(entries: LocalClipboardEntry[]) {
  await AsyncStorage.setItem(STORAGE_KEYS.pushHistory, JSON.stringify(entries.slice(0, 20)));
}

export async function addClipboardSnapshotToHistory(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return loadPushClipboardHistory();

  const existing = await loadPushClipboardHistory();
  const deduped = existing.filter((entry) => entry.content !== trimmed);
  const nextEntry: LocalClipboardEntry = {
    id: `local-${Date.now()}`,
    content: trimmed,
    createdAt: Date.now(),
  };
  const next = [nextEntry, ...deduped].slice(0, 20);
  await savePushClipboardHistory(next);
  return next;
}

export function isWebDavConfigured(settings: MobileSyncSettings) {
  return settings.webdavUrl.trim().length > 0;
}

export function isMqttConfigured(settings: MobileSyncSettings) {
  return settings.mqttServer.trim().length > 0 && settings.mqttTopic.trim().length > 0;
}

export async function fetchWebDavEntries(settings: MobileSyncSettings): Promise<SyncedEntry[]> {
  if (!isWebDavConfigured(settings)) {
    return [];
  }

  const paths = await ensureWebDavDirectories(settings);
  const cachedItems = await loadWebDavPulledItems();

  try {
    let syncHead = await resolveWebDavSyncHead(settings, paths);
    const { headStale } = await pullRemoteWebDavOpsFromHead(settings, paths, syncHead);

    if (headStale) {
      syncHead = await rebuildWebDavSyncHead(settings, paths);
      syncHead.updated_at = nowMs();
      await uploadWebDavSyncHead(settings, paths.headPath, syncHead);
    }

    const pulledItems = await pullRemoteWebDavSnapshotsFromHead(settings, paths, syncHead);
    return dedupeEntries(
      pulledItems
        .filter((item) => isVisibleCloudItem(item))
        .map((item, index) => toSyncedEntry(item, index))
    ).sort((left, right) => right.timestamp - left.timestamp);
  } catch (error) {
    if (cachedItems.length > 0) {
      return dedupeEntries(
        cachedItems
          .filter((item) => isVisibleCloudItem(item))
          .map((item, index) => toSyncedEntry(item, index))
      ).sort((left, right) => right.timestamp - left.timestamp);
    }

    throw error;
  }
}

export async function syncClipboardTextToPc(content: string) {
  const rawIp = await AsyncStorage.getItem(STORAGE_KEYS.lastDeviceIp);
  if (!rawIp?.trim()) {
    throw new Error('请先在文件传输页扫码连接电脑');
  }

  const baseIp = rawIp.startsWith('http') ? rawIp : `http://${rawIp}`;
  const response = await fetch(`${baseIp}/send_text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      sender_id: 'mobile-home-sync',
      sender_name: '手机端',
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `同步失败：${response.status}`);
  }
}

export async function pushClipboardBatchToPc(entries: LocalClipboardEntry[]) {
  const settings = await loadMobileSyncSettings();
  const isStrategyMqtt = settings.pushStrategy === 'mqtt';
  
  // 1. 检查配置
  const mqttOk = isMqttConfigured(settings);
  const webdavOk = isWebDavConfigured(settings);

  if (!mqttOk && !webdavOk) {
    throw new Error('未发现同步配置。推送失败，请先在设置中配置 MQTT 或 WebDAV。');
  }

  if (isStrategyMqtt && !mqttOk) {
    throw new Error('当前选择了 MQTT 策略但尚未配置。请先在设置中填写服务器和主题，或切换回 WebDAV。');
  }
  if (!isStrategyMqtt && !webdavOk) {
    throw new Error('当前选择了 WebDAV 策略但尚未配置。请先在设置中填写 WebDAV 详细信息，或切换到 MQTT。');
  }

  // 2. 本地局域网传输 (如果在线)
  try {
    for (const entry of entries) {
      await syncClipboardTextToPc(entry.content).catch(() => {});
    }
  } catch (e) {}

  // 3. 执行云同步
  if (isStrategyMqtt) {
    // 异步推送，不阻塞 UI 体验
    pushClipboardBatchToMqtt(entries, settings).catch(e => {
      console.error('MQTT Push Failed:', e);
    });
  } else {
    // WebDAV 必须同步等待以确保增量逻辑正确
    await syncEntriesToWebDavIncrementally(entries, settings);
  }
}

export async function pushClipboardBatchToMqtt(entries: LocalClipboardEntry[], settings: MobileSyncSettings) {
  const contents = entries.map(e => e.content);
  try {
    await publishBatchToMqtt(contents, settings);
  } catch (error) {
    console.error('Batch MQTT push failed:', error);
  }
}

export function collectTags(entries: SyncedEntry[]) {
  const tagLatestMap = new Map<string, number>();

  entries.forEach((entry) => {
    entry.tags.forEach((tag) => {
      const current = tagLatestMap.get(tag) ?? 0;
      if (entry.timestamp > current) {
        tagLatestMap.set(tag, entry.timestamp);
      }
    });
  });

  return Array.from(tagLatestMap.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([tag]) => tag);
}

export function buildWebDavDisplayRecord(
  entries: SyncedEntry[],
  limit: RecentLimit
): WebDavDisplayRecord {
  const sortedEntries = [...entries].sort((left, right) => right.timestamp - left.timestamp);
  const entriesByTag: Record<string, SyncedEntry[]> = {};

  sortedEntries.forEach((entry) => {
    const uniqueTags = Array.from(
      new Set(entry.tags.map((tag) => tag.trim()).filter(Boolean))
    );

    uniqueTags.forEach((tag) => {
      if (!entriesByTag[tag]) {
        entriesByTag[tag] = [];
      }
      entriesByTag[tag].push(entry);
    });
  });

  return {
    tags: collectTags(sortedEntries),
    entriesByTag,
    recentEntries: sortedEntries.slice(0, limit),
  };
}

export function formatRelativeTime(timestamp: number) {
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}天前`;

  return new Date(timestamp).toLocaleDateString();
}
