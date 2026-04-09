const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAndroidTile = (config) => {
  // 1. 修改 AndroidManifest.xml 注册 Service
  config = withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    
    if (!mainApplication.service) {
      mainApplication.service = [];
    }

    // 添加 TileService
    mainApplication.service.push({
      $: {
        'android:name': '.TiezTileService',
        'android:label': '一键同步',
        'android:icon': '@mipmap/ic_launcher',
        'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE',
        'android:exported': 'true'
      },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': 'android.service.quicksettings.action.QS_TILE' } }
          ]
        }
      ]
    });

    return config;
  });

  // 2. 注入 Java 类文件
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const packagePath = 'com/jimuzhe/tiez';
      const javaFileContent = `package com.jimuzhe.tiez;
import android.content.Intent;
import android.net.Uri;
import android.service.quicksettings.TileService;

public class TiezTileService extends TileService {
    @Override
    public void onClick() {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("tiez://sync-now"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivityAndCollapse(intent);
        } catch (Exception e) {
            // 回退方案：如果无法收起，则直接启动
            startActivity(intent);
        }
    }
}`;

      const projectRoot = config.modRequest.projectRoot;
      const filePath = path.join(
        projectRoot,
        'android/app/src/main/java',
        packagePath,
        'TiezTileService.java'
      );

      // 确保目录存在
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, javaFileContent);

      return config;
    },
  ]);

  return config;
};

module.exports = withAndroidTile;
