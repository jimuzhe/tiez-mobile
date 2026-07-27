import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = (process.argv[2] || '').toLowerCase();
const channel = (process.argv[3] || '').toLowerCase();
const extraArgs = process.argv.slice(4);
const prepareOnly = extraArgs.includes('--prepare-only');
const easArgs = extraArgs.filter(arg => arg !== '--prepare-only');

if (!['android', 'ios'].includes(platform) || !['stable', 'beta'].includes(channel)) {
  throw new Error('Usage: node scripts/build-release.mjs <android|ios> <stable|beta> [eas build args]');
}

const generatedFiles = ['package.json', 'app.json'];
const snapshots = new Map(
  generatedFiles.map(file => [file, fs.readFileSync(path.join(rootDir, file), 'utf8')]),
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      TIEZ_PLATFORM: platform,
      TIEZ_RELEASE_CHANNEL: channel,
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

try {
  run(process.execPath, ['scripts/apply-app-version.mjs', platform, channel]);
  if (prepareOnly) {
    console.log('Release configuration validated; skipped EAS Build (--prepare-only).');
  } else {
    const profile = channel === 'beta' ? 'beta' : 'production';
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    run(npx, ['eas-cli', 'build', '--platform', platform, '--profile', profile, ...easArgs]);
  }
} finally {
  for (const [file, content] of snapshots) {
    fs.writeFileSync(path.join(rootDir, file), content);
  }
  console.log('Restored package.json and app.json after release preparation.');
}
