const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withStringsXml,
} = require('@expo/config-plugins');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_SHORTCUTS = [
  {
    id: 'scanner',
    shortLabel: '文件传输',
    longLabel: '开启文件快传',
    data: 'tiez://scanner',
  },
  {
    id: 'pull',
    shortLabel: '获取内容',
    longLabel: '获取 PC 端内容',
    data: 'tiez://sync-pull',
  },
  {
    id: 'push',
    shortLabel: '同步内容',
    longLabel: '同步剪贴板到 PC',
    data: 'tiez://sync-push',
  },
];

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const resourceName = (id, suffix) =>
  `tiez_shortcut_${String(id).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()}_${suffix}`;

const withAndroidShortcuts = (config, options = {}) => {
  const shortcuts =
    Array.isArray(options.shortcuts) && options.shortcuts.length > 0
      ? options.shortcuts
      : DEFAULT_SHORTCUTS;

  config = withStringsXml(config, (config) => {
    const stringItems = shortcuts.flatMap((shortcut) => [
      {
        $: { name: resourceName(shortcut.id, 'short'), translatable: 'false' },
        _: shortcut.shortLabel,
      },
      {
        $: { name: resourceName(shortcut.id, 'long'), translatable: 'false' },
        _: shortcut.longLabel,
      },
    ]);
    config.modResults = AndroidConfig.Strings.setStringItem(
      stringItems,
      config.modResults
    );
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      config.modResults
    );
    const activities = application.activity || [];
    const mainActivity = activities.find((activity) =>
      (activity['intent-filter'] || []).some((filter) =>
        (filter.action || []).some(
          (action) => action.$?.['android:name'] === 'android.intent.action.MAIN'
        )
      )
    );

    if (!mainActivity) {
      throw new Error('Unable to locate the Android launcher activity for shortcuts');
    }

    const metadata = mainActivity['meta-data'] || [];
    mainActivity['meta-data'] = metadata.filter(
      (item) => item.$?.['android:name'] !== 'android.app.shortcuts'
    );
    mainActivity['meta-data'].push({
      $: {
        'android:name': 'android.app.shortcuts',
        'android:resource': '@xml/shortcuts',
      },
    });
    return config;
  });

  return withDangerousMod(config, [
    'android',
    async (config) => {
      const applicationId = config.android?.package;
      if (!applicationId) {
        throw new Error('android.package is required to generate Android shortcuts');
      }

      const shortcutXml = shortcuts
        .map(
          (shortcut) => `  <shortcut
    android:shortcutId="${escapeXml(shortcut.id)}"
    android:enabled="true"
    android:icon="@mipmap/ic_launcher"
    android:shortcutShortLabel="@string/${resourceName(shortcut.id, 'short')}"
    android:shortcutLongLabel="@string/${resourceName(shortcut.id, 'long')}">
    <intent
      android:action="android.intent.action.VIEW"
      android:targetPackage="${escapeXml(applicationId)}"
      android:targetClass="${escapeXml(applicationId)}.MainActivity"
      android:data="${escapeXml(shortcut.data)}" />
  </shortcut>`
        )
        .join('\n');

      const outputPath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
        'shortcuts.xml'
      );
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(
        outputPath,
        `<?xml version="1.0" encoding="utf-8"?>\n<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">\n${shortcutXml}\n</shortcuts>\n`,
        'utf8'
      );
      return config;
    },
  ]);
};

module.exports = withAndroidShortcuts;
