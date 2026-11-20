const fs = require('node:fs');
const path = require('node:path');
const plist = require('@expo/plist').default;
const { IOSConfig, withInfoPlist, withXcodeProject } = require('expo/config-plugins');

const targetName = 'TieZKeyboard';
const groupEntitlement = 'com.apple.security.application-groups';

module.exports = function withClipboardKeyboard(config) {
  const { bundleIdentifier, entitlements } = config.extra.eas.build.experimental.ios.appExtensions
    .find(extension => extension.targetName === targetName);
  const [appGroup] = entitlements[groupEntitlement];
  if (!config.ios.entitlements[groupEntitlement].includes(appGroup)) {
    throw new Error('TieZ and its keyboard must have the same App Group entitlement.');
  }
  config = withInfoPlist(config, mod => {
    mod.modResults.TieZKeyboardAppGroup = appGroup;
    mod.modResults.NSLocalNetworkUsageDescription ??= '允许 TieZ 从你配置的局域网 WebDAV 同步剪贴板。';
    return mod;
  });

  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    const app = project.getFirstTarget().firstTarget;
    const targets = project.pbxNativeTargetSection();
    const directory = path.join(mod.modRequest.platformProjectRoot, targetName);
    const sources = [
      ['clipboard-keyboard', 'KeyboardViewController.swift'],
      ['clipboard-keyboard', 'KeyboardWebDAVClient.swift'],
      ['clipboard-keyboard', 'KeyboardPasteboardPayload.swift'],
      ['../modules/tiez-keyboard/ios', 'KeyboardHistory.swift'],
      ['../modules/tiez-keyboard/ios', 'KeyboardWebDAVConnection.swift'],
    ];

    fs.mkdirSync(directory, { recursive: true });
    for (const [folder, file] of sources) {
      fs.copyFileSync(path.join(__dirname, folder, file), path.join(directory, file));
    }
    fs.writeFileSync(path.join(directory, 'Info.plist'), plist.build({
      CFBundleDisplayName: 'TieZ 剪贴板',
      CFBundleExecutable: '$(EXECUTABLE_NAME)',
      CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleInfoDictionaryVersion: '6.0',
      CFBundleName: '$(PRODUCT_NAME)',
      CFBundlePackageType: 'XPC!',
      CFBundleShortVersionString: '$(MARKETING_VERSION)',
      CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      NSLocalNetworkUsageDescription: '允许 TieZ 键盘从你配置的局域网 WebDAV 同步剪贴板。',
      TieZKeyboardAppGroup: appGroup,
      NSExtension: {
        NSExtensionPointIdentifier: 'com.apple.keyboard-service',
        NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).KeyboardViewController',
        NSExtensionAttributes: {
          IsASCIICapable: true,
          PrefersRightToLeft: false,
          PrimaryLanguage: 'zh-Hans',
          RequestsOpenAccess: true,
        },
      },
    }));
    fs.writeFileSync(path.join(directory, `${targetName}.entitlements`), plist.build(entitlements));

    let keyboardID = Object.keys(targets).find(id => targets[id].name === `"${targetName}"` || targets[id].name === targetName);
    if (!keyboardID) {
      const { uuid } = project.addTarget(targetName, 'app_extension', targetName, bundleIdentifier);
      keyboardID = uuid;
      project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', uuid);
      project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', uuid);
      project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', uuid);

      const embedPhase = app.buildPhases.pop();
      const objects = project.hash.project.objects;
      const embed = objects.PBXCopyFilesBuildPhase[embedPhase.value];
      embed.name = '"Embed App Extensions"';
      embedPhase.comment = 'Embed App Extensions';
      objects.PBXCopyFilesBuildPhase[`${embedPhase.value}_comment`] = embedPhase.comment;
      const embeddedProduct = objects.PBXBuildFile[embed.files[0].value];
      embeddedProduct.settings = { ATTRIBUTES: ['RemoveHeadersOnCopy'] };
      // Embed before React Native and CocoaPods scripts that touch the app bundle.
      const firstBundleScript = app.buildPhases.findIndex(phase => phase.comment === 'Bundle React Native code and images');
      app.buildPhases.splice(firstBundleScript < 0 ? app.buildPhases.length : firstBundleScript, 0, embedPhase);
    }

    const sourceGroup = project.getFirstProject().firstProject.mainGroup;
    for (const [, file] of sources) {
      const relativePath = `${targetName}/${file}`;
      if (!project.hasFile(relativePath)) project.addSourceFile(relativePath, { target: keyboardID }, sourceGroup);
    }
    const keyboard = targets[keyboardID];
    const { XcodeUtils } = IOSConfig;
    for (const [, entry] of XcodeUtils.getBuildConfigurationsForListId(project, keyboard.buildConfigurationList)) {
      const [, host] = XcodeUtils.getBuildConfigurationForListIdAndName(project, {
        configurationListId: app.buildConfigurationList,
        buildConfiguration: entry.name.replaceAll('"', ''),
      });
      Object.assign(entry.buildSettings, {
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        CLANG_ENABLE_MODULES: 'YES',
        CODE_SIGN_ENTITLEMENTS: `${targetName}/${targetName}.entitlements`,
        CURRENT_PROJECT_VERSION: IOSConfig.Version.getBuildNumber(mod),
        INFOPLIST_FILE: `${targetName}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: host.buildSettings.IPHONEOS_DEPLOYMENT_TARGET,
        MARKETING_VERSION: IOSConfig.Version.getVersion(mod),
        PRODUCT_BUNDLE_IDENTIFIER: bundleIdentifier,
        SWIFT_VERSION: '5.0',
        TARGETED_DEVICE_FAMILY: host.buildSettings.TARGETED_DEVICE_FAMILY,
        VERSIONING_SYSTEM: 'apple-generic',
      });
    }
    return mod;
  });
};
