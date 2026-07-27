import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = (process.argv[2] || process.env.TIEZ_PLATFORM || '').toLowerCase();
const channel = (process.argv[3] || process.env.TIEZ_RELEASE_CHANNEL || 'stable').toLowerCase();

if (!['android', 'ios'].includes(platform)) {
  throw new Error('Usage: node scripts/apply-app-version.mjs <android|ios> <stable|beta>');
}
if (!['stable', 'beta'].includes(channel)) {
  throw new Error(`Unsupported release channel: ${channel}`);
}

const versionsPath = path.join(rootDir, 'versions.json');
const packagePath = path.join(rootDir, 'package.json');
const appConfigPath = path.join(rootDir, 'app.json');
const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
const version = versions[channel]?.[platform];

if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`versions.json is missing a store-compatible ${channel}.${platform} version`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
packageJson.version = version;
appConfig.expo.version = version;

fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
fs.writeFileSync(appConfigPath, `${JSON.stringify(appConfig, null, 2)}\n`);
console.log(`Applied TieZ Mobile ${platform}/${channel} version ${version}`);
