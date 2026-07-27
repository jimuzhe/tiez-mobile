import fs from 'node:fs';

const versions = JSON.parse(fs.readFileSync(new URL('../versions.json', import.meta.url), 'utf8'));
for (const channel of ['stable', 'beta']) {
  for (const platform of ['android', 'ios']) {
    const version = versions[channel]?.[platform];
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`Invalid store-compatible version: ${channel}.${platform}`);
    }
  }
}

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const appConfig = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const easConfig = JSON.parse(fs.readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
if (packageJson.version !== appConfig.expo.version) {
  throw new Error(`package.json (${packageJson.version}) and app.json (${appConfig.expo.version}) differ`);
}
if (!Object.values(versions).some(platforms => Object.values(platforms).includes(packageJson.version))) {
  throw new Error(`Active version ${packageJson.version} is not declared in versions.json`);
}
if (easConfig.build?.beta?.env?.EXPO_PUBLIC_TIEZ_RELEASE_CHANNEL !== 'beta') {
  throw new Error('EAS beta profile is not pinned to the beta update channel');
}
if (easConfig.build?.production?.env?.EXPO_PUBLIC_TIEZ_RELEASE_CHANNEL !== 'stable') {
  throw new Error('EAS production profile is not pinned to the stable update channel');
}
if (easConfig.build?.production?.android?.buildType !== 'apk') {
  throw new Error('Android stable profile must produce an APK for direct updates');
}

console.log(`Mobile versions are valid; active source version is ${packageJson.version}.`);
