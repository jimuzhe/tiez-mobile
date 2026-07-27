import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import packageJson from '../../package.json';

export type ReleaseChannel = 'stable' | 'beta';

export interface ReleaseInfo {
  target: string;
  channel: ReleaseChannel;
  version: string;
  notes: string;
  url: string;
  pubDate?: string;
  important: boolean;
  minSupportedVersion?: string;
  checksumSha256?: string;
}

const DEFAULT_UPDATE_ENDPOINT = 'https://tiez.name666.top/api/v1/latest-version';
const REQUEST_TIMEOUT_MS = 12_000;
const AUTO_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const LAST_AUTO_CHECK_KEY = 'tiez:last-auto-update-check';

export const RELEASE_CHANNEL: ReleaseChannel =
  process.env.EXPO_PUBLIC_TIEZ_RELEASE_CHANNEL === 'beta' ? 'beta' : 'stable';

const UPDATE_ENDPOINT =
  process.env.EXPO_PUBLIC_TIEZ_UPDATE_ENDPOINT?.trim() || DEFAULT_UPDATE_ENDPOINT;

function getAndroidArch(): string {
  const supportedAbis = ((Platform.constants as { SupportedAbis?: string[] }).SupportedAbis || [])
    .map(abi => abi.toLowerCase());

  if (supportedAbis.includes('arm64-v8a')) return 'arm64-v8a';
  if (supportedAbis.includes('armeabi-v7a')) return 'armeabi-v7a';
  if (supportedAbis.includes('x86_64')) return 'x86_64';
  return 'universal';
}

function getUpdateTarget(): { target: string; arch?: string } | null {
  if (Platform.OS === 'android') {
    return { target: 'android', arch: getAndroidArch() };
  }
  if (Platform.OS === 'ios') {
    return {
      target: RELEASE_CHANNEL === 'beta' ? 'ios-testflight' : 'ios-app-store',
    };
  }
  return null;
}

function buildUpdateUrl(currentVersion: string): string | null {
  const platformTarget = getUpdateTarget();
  if (!platformTarget) return null;

  const url = new URL(UPDATE_ENDPOINT);
  url.searchParams.set('target', platformTarget.target);
  if (platformTarget.arch) url.searchParams.set('arch', platformTarget.arch);
  url.searchParams.set('current_version', currentVersion);
  url.searchParams.set('channel', RELEASE_CHANNEL);
  return url.toString();
}

function parseReleaseInfo(payload: unknown): ReleaseInfo {
  if (!payload || typeof payload !== 'object') {
    throw new Error('更新服务器返回了无效数据');
  }

  const data = payload as Record<string, unknown>;
  const version = typeof data.version === 'string' ? data.version.trim() : '';
  const downloadUrl = typeof data.url === 'string' ? data.url.trim() : '';
  if (!version || !downloadUrl) {
    throw new Error('更新信息缺少版本号或下载地址');
  }

  const parsedUrl = new URL(downloadUrl);
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('更新下载地址不是 HTTPS');
  }

  return {
    target: typeof data.target === 'string' ? data.target : getUpdateTarget()?.target || Platform.OS,
    channel: data.channel === 'beta' ? 'beta' : RELEASE_CHANNEL,
    version,
    notes: typeof data.notes === 'string' ? data.notes : '',
    url: parsedUrl.toString(),
    pubDate: typeof data.pub_date === 'string' ? data.pub_date : undefined,
    important: data.forceUpdate === true,
    minSupportedVersion:
      typeof data.minSupportedVersion === 'string' ? data.minSupportedVersion : undefined,
    checksumSha256:
      typeof data.checksumSha256 === 'string' ? data.checksumSha256 : undefined,
  };
}

/**
 * 请求 TieZ 动态更新接口。204 表示当前通道没有更高版本。
 */
export async function fetchLatestRelease(
  currentVersion = packageJson.version,
): Promise<ReleaseInfo | null> {
  const requestUrl = buildUpdateUrl(currentVersion);
  if (!requestUrl) {
    throw new Error(`暂不支持在 ${Platform.OS} 上检查原生应用更新`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(requestUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (response.status === 204) return null;
    if (!response.ok) {
      throw new Error(`更新服务器请求失败（${response.status}）`);
    }

    return parseReleaseInfo(await response.json());
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('检查更新超时，请稍后重试');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 检查更新并展示跳转入口。版本比较由后台完成，客户端不限制用户继续使用。
 */
export async function checkUpdate(manual = false): Promise<boolean> {
  const currentVersion = packageJson.version;

  try {
    const latestRelease = await fetchLatestRelease(currentVersion);
    if (!latestRelease) {
      if (manual) {
        Alert.alert(
          '已经是最新版',
          `当前为 ${RELEASE_CHANNEL === 'beta' ? 'Beta' : '正式'}通道 v${currentVersion}。`,
        );
      }
      return true;
    }

    const releaseType = latestRelease.channel === 'beta' ? 'Beta 测试版' : '正式版';
    const importantText = latestRelease.important ? '\n\n这是一个重要更新。' : '';
    Alert.alert(
      `🚀 发现${releaseType}`,
      `最新版本：v${latestRelease.version}（当前：v${currentVersion}）\n\n更新说明：\n${
        latestRelease.notes || '暂无更新说明'
      }${importantText}`,
      [
        { text: '稍后再说', style: 'cancel' },
        {
          text: Platform.OS === 'ios' ? '前往更新' : '立即下载',
          onPress: () => {
            Linking.openURL(latestRelease.url).catch(() => {
              Alert.alert('打开失败', '无法打开更新地址，请稍后重试。');
            });
          },
        },
      ],
    );
    return true;
  } catch (error) {
    console.error('Check update failed:', error);
    if (manual) {
      Alert.alert(
        '检查失败',
        error instanceof Error ? error.message : '无法连接到更新服务器，请检查网络。',
      );
    }
    return false;
  }
}

export async function checkForUpdatesOnLaunch(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;

  try {
    const now = Date.now();
    const lastCheck = Number(await AsyncStorage.getItem(LAST_AUTO_CHECK_KEY));
    if (Number.isFinite(lastCheck) && now - lastCheck < AUTO_CHECK_INTERVAL_MS) return;

    const succeeded = await checkUpdate(false);
    if (succeeded) {
      await AsyncStorage.setItem(LAST_AUTO_CHECK_KEY, String(now));
    }
  } catch (error) {
    console.error('Automatic update check failed:', error);
  }
}
