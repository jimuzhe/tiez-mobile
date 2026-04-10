const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to filter Android ABIs to only 'arm64-v8a'
 * This produces a single, optimized APK for modern devices.
 */
const withAndroidAbiSplit = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = filterAbis(config.modResults.contents);
    }
    return config;
  });
};

function filterAbis(buildGradle) {
  // 查找 android.defaultConfig 并在其中插入 ndk { abiFilters "arm64-v8a" }
  const abiFilterConfig = `
        ndk {
            abiFilters "arm64-v8a"
        }`;

  // 如果已经配置过，就跳过
  if (buildGradle.includes('abiFilters "arm64-v8a"')) {
    return buildGradle;
  }

  // 我们寻找 defaultConfig { 并在其后插入
  if (buildGradle.includes('defaultConfig {')) {
    return buildGradle.replace('defaultConfig {', `defaultConfig {${abiFilterConfig}`);
  }
  
  return buildGradle;
}

module.exports = withAndroidAbiSplit;
