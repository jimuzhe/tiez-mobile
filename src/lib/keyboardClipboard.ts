import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type KeyboardModule = {
  isHistoryEnabled(): Promise<boolean>;
  writeHistory(items: string[]): Promise<void>;
  writeClipboardHistory?(items: string): Promise<void>;
  disableHistory(): Promise<void>;
  isAutoRefreshEnabled(): Promise<boolean>;
  setAutoRefresh(settings: string | null): Promise<void>;
};

type KeyboardWebDAVConnection = {
  url: string;
  basePath: string;
  username: string;
  password: string;
  e2eKey: string;
  deviceID: string;
};

const keyboard = Platform.OS === 'ios'
  ? requireOptionalNativeModule<KeyboardModule>('TieZKeyboard')
  : null;

export const keyboardClipboardAvailable = keyboard !== null;
export const MAX_KEYBOARD_TEXT_LENGTH = 16_384;
export const MAX_KEYBOARD_HISTORY_ITEMS = 20;
export const KEYBOARD_INLINE_MEDIA_BUDGET = 2 * 1024 * 1024;

export type KeyboardClipboardItem = {
  kind: 'text' | 'richText' | 'image';
  text: string;
  html?: string;
  image?: string;
  blobHash?: string;
  timestamp?: number;
};

let lastRefresh = 0;
let lastPublished = 0;
let writes = Promise.resolve();

function enqueue(write: () => Promise<void>) {
  const pending = writes.then(write);
  writes = pending.catch(() => {});
  return pending;
}

export async function isKeyboardClipboardEnabled() {
  await writes;
  return await keyboard?.isHistoryEnabled() ?? false;
}

export async function isKeyboardAutoRefreshEnabled() {
  await writes;
  return await keyboard?.isAutoRefreshEnabled() ?? false;
}

export function setKeyboardAutoRefreshConnection(connection: () => Promise<KeyboardWebDAVConnection | null>) {
  return enqueue(async () => {
    if (keyboard && await keyboard.isHistoryEnabled()) {
      const settings = await connection();
      await keyboard.setAutoRefresh(settings ? JSON.stringify(settings) : null);
    }
  });
}

export function setKeyboardClipboardEnabled(enabled: boolean) {
  return enqueue(async () => {
    if (!keyboard || enabled === await keyboard.isHistoryEnabled()) return;
    lastPublished = ++lastRefresh;
    if (enabled) {
      await keyboard.writeHistory([]);
    } else {
      await keyboard.disableHistory();
    }
  });
}

export function clearKeyboardClipboardDuring(update: () => Promise<void>, disconnect = false) {
  if (!keyboard) return update();
  return enqueue(async () => {
    try {
      if (await keyboard.isHistoryEnabled()) {
        if (disconnect) await keyboard.setAutoRefresh(null);
        await keyboard.writeHistory([]);
      }
      await update();
    } finally {
      lastPublished = ++lastRefresh;
    }
  });
}

export function startKeyboardClipboardRefresh() {
  return ++lastRefresh;
}

export function publishKeyboardClipboard(
  refresh: number,
  buildItems: () => KeyboardClipboardItem[],
  isCurrentSource: () => Promise<boolean>
) {
  return enqueue(async () => {
    if (!keyboard || refresh <= lastPublished || !await keyboard.isHistoryEnabled() || !await isCurrentSource()) return;
    const items = buildItems();
    if (keyboard.writeClipboardHistory) {
      await keyboard.writeClipboardHistory(JSON.stringify(items));
    } else {
      await keyboard.writeHistory([...new Set(items.map(item => item.text).filter(Boolean))]);
    }
    lastPublished = refresh;
  });
}
