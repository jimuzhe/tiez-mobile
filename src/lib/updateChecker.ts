import { Alert, Linking, Platform } from 'react-native';
import packageJson from '../../package.json';

const GITHUB_OWNER = 'jimuzhe';
const GITHUB_REPO = 'tiez-mobile';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface ReleaseInfo {
  version: string;
  htmlUrl: string;
  notes: string;
  assets: ReleaseAsset[];
}

/**
 * 获取 GitHub 上的最新发布版本及其资产
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.log('No releases found yet.');
        return null;
      }
      return null;
    }

    const data = await response.json();
    return {
      version: data.tag_name.replace(/^v/, ''),
      htmlUrl: data.html_url,
      notes: data.body,
      assets: data.assets || [],
    };
  } catch (error) {
    console.error('Check update failed:', error);
    return null;
  }
}

/**
 * 根据当前设备架构查找最匹配的安装包
 */
function findBestAsset(assets: ReleaseAsset[]): string | null {
  if (assets.length === 0) return null;

  // 获取安卓设备支持的架构列表 (例如: ['arm64-v8a', 'armeabi-v7a'])
  const supportedAbis = (Platform.constants as any).SupportedAbis || [];
  
  // 1. 尝试匹配最优的原生架构包 (arm64-v8a 是目前绝大多数现代手机的架构)
  for (const abi of supportedAbis) {
    const match = assets.find(a => a.name.toLowerCase().includes(abi.toLowerCase()) && a.name.endsWith('.apk'));
    if (match) return match.browser_download_url;
  }

  // 2. 如果没找到专属包，尝试查找通用包 (Universal)
  const universalMatch = assets.find(a => a.name.toLowerCase().includes('universal') && a.name.endsWith('.apk'));
  if (universalMatch) return universalMatch.browser_download_url;

  // 3. 如果只有一个 APK，直接返回那个 APK
  const singleApk = assets.find(a => a.name.endsWith('.apk'));
  if (singleApk) return singleApk.browser_download_url;

  return null;
}

/**
 * 比较两个版本号
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * 检查更新并弹出提醒
 */
export async function checkUpdate(manual = false) {
  const currentVersion = packageJson.version;
  const latestRelease = await fetchLatestRelease();

  if (!latestRelease) {
    if (manual) Alert.alert('检查失败', '无法连接到更新服务器，请检查网络。');
    return;
  }

  const hasNewVersion = compareVersions(latestRelease.version, currentVersion) > 0;

  if (hasNewVersion) {
    const downloadUrl = findBestAsset(latestRelease.assets) || latestRelease.htmlUrl;
    
    Alert.alert(
      '🚀 发现新版本',
      `最新版本: v${latestRelease.version} (当前: v${currentVersion})\n\n更新说明:\n${latestRelease.notes || '由于开发者很懒，暂无更新说明。'}`,
      [
        { text: '稍后再说', style: 'cancel' },
        {
          text: '立即下载',
          onPress: () => {
            Linking.openURL(downloadUrl);
          },
        },
      ]
    );
  } else if (manual) {
    Alert.alert('已经是最新版', `你当前使用的 v${currentVersion} 已经是最新版本，无需更新。✨`);
  }
}
