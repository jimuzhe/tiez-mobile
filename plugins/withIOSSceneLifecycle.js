const fs = require('node:fs');
const path = require('node:path');
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

module.exports = function withIOSSceneLifecycle(config) {
  config = withInfoPlist(config, mod => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{ UISceneDelegateClassName: 'TieZSceneDelegate' }],
      },
    };
    return mod;
  });

  return withAppDelegate(config, mod => {
    const { contents, language } = mod.modResults;
    if (contents.includes('@objc(TieZSceneDelegate)')) return mod;

    const windowProperty = '  var window: UIWindow?';
    const legacyStartup = /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif/;
    if (language !== 'swift' || !contents.includes(windowProperty) || !legacyStartup.test(contents)) {
      throw new Error('Could not migrate the generated Expo AppDelegate to the iOS scene lifecycle.');
    }

    const scene = fs.readFileSync(path.join(__dirname, 'ios-scene/TieZSceneDelegate.swift'), 'utf8');
    mod.modResults.contents = contents
      .replace(windowProperty, `${windowProperty}\n  var sceneLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?`)
      .replace(legacyStartup, '    sceneLaunchOptions = launchOptions')
      .trimEnd() + '\n\n' + scene;
    return mod;
  });
};
