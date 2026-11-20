@objc(TieZSceneDelegate)
final class TieZSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene,
          let app = UIApplication.shared.delegate as? AppDelegate,
          let factory = app.reactNativeFactory else { return }

    var launchOptions = app.sceneLaunchOptions ?? [:]
    app.sceneLaunchOptions = nil
    if let url = options.urlContexts.first?.url
      ?? options.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb })?.webpageURL
      ?? options.shortcutItem.flatMap(shortcutURL) {
      launchOptions[.url] = url
    }

    let window = UIWindow(windowScene: scene)
    self.window = window
    app.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    let application = UIApplication.shared
    guard let app = application.delegate as? AppDelegate else { return }
    for context in contexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      options[.sourceApplication] = context.options.sourceApplication
      options[.annotation] = context.options.annotation
      _ = app.application(application, open: context.url, options: options)
    }
  }

  func scene(_ scene: UIScene, continue activity: NSUserActivity) {
    let application = UIApplication.shared
    guard let app = application.delegate as? AppDelegate else { return }
    _ = app.application(application, continue: activity, restorationHandler: { _ in })
  }

  func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                   completionHandler: @escaping (Bool) -> Void) {
    let application = UIApplication.shared
    guard let app = application.delegate as? AppDelegate else {
      completionHandler(false)
      return
    }
    if let url = shortcutURL(shortcutItem) {
      completionHandler(app.application(application, open: url, options: [:]))
    } else {
      app.application(application, performActionFor: shortcutItem, completionHandler: completionHandler)
    }
  }

  private func shortcutURL(_ item: UIApplicationShortcutItem) -> URL? {
    (item.userInfo?["url"] as? String).flatMap(URL.init(string:))
  }
}
