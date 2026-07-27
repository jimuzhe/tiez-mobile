import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export type TransferConnection = {
  baseUrl: string;
  accessToken: string | null;
};

const STORED_TRANSFER_CONNECTION_KEY = 'lastDeviceIp';

export function parseTransferConnection(rawValue: string): TransferConnection {
  const value = rawValue.trim();
  if (!value) {
    throw new Error('连接地址为空');
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `http://${value}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('不支持的连接协议');
  }
  if (!parsed.hostname || !parsed.port) {
    throw new Error('连接地址缺少设备 IP 或端口');
  }

  return {
    baseUrl: `${parsed.protocol}//${parsed.host}`,
    accessToken: parsed.searchParams.get('auth')?.trim() || null,
  };
}

export function buildTransferUrl(connection: TransferConnection, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${connection.baseUrl}${normalizedPath}`;
}

export function buildTransferWebSocketUrl(connection: TransferConnection): string {
  const url = new URL(buildTransferUrl(connection, '/ws'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (connection.accessToken) {
    url.searchParams.set('auth', connection.accessToken);
  }
  return url.toString();
}

export function buildTransferHeaders(
  connection: TransferConnection,
  headers: Record<string, string> = {},
): Record<string, string> {
  if (!connection.accessToken) return headers;
  return {
    ...headers,
    Authorization: `Bearer ${connection.accessToken}`,
  };
}

async function canUseSecureStore() {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function loadStoredTransferConnection() {
  const legacyValue = await AsyncStorage.getItem(STORED_TRANSFER_CONNECTION_KEY);
  if (!(await canUseSecureStore())) return legacyValue;

  const secureValue = await SecureStore.getItemAsync(STORED_TRANSFER_CONNECTION_KEY);
  if (secureValue != null) {
    if (legacyValue != null) {
      await AsyncStorage.removeItem(STORED_TRANSFER_CONNECTION_KEY);
    }
    return secureValue;
  }

  if (legacyValue != null) {
    await SecureStore.setItemAsync(STORED_TRANSFER_CONNECTION_KEY, legacyValue);
    await AsyncStorage.removeItem(STORED_TRANSFER_CONNECTION_KEY);
  }
  return legacyValue;
}

export async function saveStoredTransferConnection(value: string) {
  if (!(await canUseSecureStore())) {
    await AsyncStorage.setItem(STORED_TRANSFER_CONNECTION_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORED_TRANSFER_CONNECTION_KEY, value);
  await AsyncStorage.removeItem(STORED_TRANSFER_CONNECTION_KEY);
}

export async function clearStoredTransferConnection() {
  await AsyncStorage.removeItem(STORED_TRANSFER_CONNECTION_KEY);
  if (await canUseSecureStore()) {
    await SecureStore.deleteItemAsync(STORED_TRANSFER_CONNECTION_KEY);
  }
}
