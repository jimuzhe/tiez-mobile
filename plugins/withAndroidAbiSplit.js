const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to enable separate APKs per CPU architecture (ABI Split)
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
  // 查找 enableSeparateBuildPerCPUArchitecture 并将其改为 true
  if (buildGradle.includes('enableSeparateBuildPerCPUArchitecture = false')) {
    return buildGradle.replace(
      'enableSeparateBuildPerCPUArchitecture = false',
      'enableSeparateBuildPerCPUArchitecture = true'
    );
  }
  return buildGradle;
}

module.exports = withAndroidAbiSplit;
