const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to enable separate APKs per CPU architecture (ABI Split)
 * Targets modern React Native versions where the flag might be missing.
 */
const withAndroidAbiSplit = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = enableAbiSplit(config.modResults.contents);
    }
    return config;
  });
};

function enableAbiSplit(buildGradle) {
  // 如果已经有了，就不重复添加
  if (buildGradle.includes('splits {') && buildGradle.includes('abi {')) {
    return buildGradle;
  }

  // 在 android { 块中插入 splits 配置
  // 我们寻找 android { 并在其后插入
  const splitConfig = `
    splits {
        abi {
            reset()
            enable true
            universalApk true
            include "armeabi-v7a", "arm64-v8a", "x86", "x86_64"
        }
    }`;

  if (buildGradle.includes('android {')) {
    return buildGradle.replace('android {', `android {${splitConfig}`);
  }
  
  return buildGradle;
}

module.exports = withAndroidAbiSplit;
