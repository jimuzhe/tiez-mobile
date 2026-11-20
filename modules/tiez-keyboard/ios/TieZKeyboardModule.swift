import ExpoModulesCore
import Foundation

public final class TieZKeyboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TieZKeyboard")

    AsyncFunction("isHistoryEnabled") { () -> Bool in
      guard let file = try? KeyboardHistory.fileURL() else { return false }
      return FileManager.default.fileExists(atPath: file.path)
    }

    AsyncFunction("writeHistory") { (items: [String]) in
      try KeyboardHistory.replace(with: items.map { KeyboardClipboardItem(text: $0) })
    }

    AsyncFunction("writeClipboardHistory") { (itemsJSON: String) in
      let items = try JSONDecoder().decode([KeyboardClipboardItem].self, from: Data(itemsJSON.utf8))
      try KeyboardHistory.replace(with: items)
    }

    AsyncFunction("disableHistory") {
      try KeyboardWebDAVConnection.remove()
      try KeyboardHistory.remove("history.json")
      try KeyboardHistory.remove("remote.json")
    }

    AsyncFunction("isAutoRefreshEnabled") { () -> Bool in
      guard let id = (try? KeyboardHistory.read())?.connectionID else { return false }
      return try KeyboardWebDAVConnection.read()?.id == id
    }

    AsyncFunction("setAutoRefresh") { (settingsJSON: String?) in
      guard let history = try? KeyboardHistory.read() else { return }
      var updated = history
      if let settingsJSON {
        var connection = try JSONDecoder().decode(KeyboardWebDAVConnection.self, from: Data(settingsJSON.utf8))
        guard connection.isValidURL else { throw URLError(.unsupportedURL) }
        let id = UUID()
        connection.id = id
        try connection.write()
        updated.connectionID = id
      } else {
        guard history.connectionID != nil else { return }
        try KeyboardWebDAVConnection.remove()
        updated.connectionID = nil
      }
      updated.revision = UUID()
      try KeyboardHistory.write(updated)
      try KeyboardHistory.remove("remote.json")
    }
  }
}
