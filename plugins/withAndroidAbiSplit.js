const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to shrink Android APK size to the absolute minimum.
 * 1. Limits architectures to arm64-v8a only.
 * 2. Enables R8/Minify for code stripping.
 * 3. Enables Resource Shrinking.
 */
const withAndroidSizeOptimized = (config) => {
  return withGradleProperties(config, (config) => {
    const props = [
      { key: 'reactNativeArchitectures', value: 'arm64-v8a' },
      { key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
      { key: 'android.enableShrinkResourcesInReleaseBuilds', value: 'true' }
    ];
    
    props.forEach(({ key, value }) => {
      config.modResults = config.modResults.filter(item => item.key !== key);
      config.modResults.push({ type: 'property', key, value });
    });

    return config;
  });
};

module.exports = withAndroidSizeOptimized;
