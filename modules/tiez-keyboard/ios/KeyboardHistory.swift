import Foundation

struct KeyboardClipboardItem: Codable, Equatable {
  enum Kind: String, Codable { case text, richText, image }

  let kind: Kind
  let text: String
  let html: String?
  let image: String?
  let blobHash: String?
  let timestamp: Double?

  init(kind: Kind = .text, text: String = "", html: String? = nil, image: String? = nil,
       blobHash: String? = nil, timestamp: Double? = nil) {
    self.kind = kind
    self.text = text
    self.html = html
    self.image = image
    self.blobHash = blobHash
    self.timestamp = timestamp
  }

  init(from decoder: Decoder) throws {
    if let text = try? decoder.singleValueContainer().decode(String.self) {
      self.init(text: text)
      return
    }
    let item = try decoder.container(keyedBy: CodingKeys.self)
    self.init(kind: try item.decode(Kind.self, forKey: .kind),
              text: try item.decode(String.self, forKey: .text),
              html: try item.decodeIfPresent(String.self, forKey: .html),
              image: try item.decodeIfPresent(String.self, forKey: .image),
              blobHash: try item.decodeIfPresent(String.self, forKey: .blobHash),
              timestamp: try item.decodeIfPresent(Double.self, forKey: .timestamp))
  }
}

struct KeyboardHistory: Codable {
  var revision: UUID?
  var connectionID: UUID?
  let items: [KeyboardClipboardItem]
  let updatedAt: Date?

  static let itemLimit = 20
  static let textLimit = 16_384
  static let inlineMediaBudget = 2 * 1024 * 1024
  static let htmlLimit = 2 * 1024 * 1024
  static let imageLimit = 8 * 1024 * 1024

  static func appGroup() throws -> String {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "TieZKeyboardAppGroup") as? String else {
      throw CocoaError(.fileNoSuchFile)
    }
    return group
  }

  static func fileURL(_ name: String = "history.json") throws -> URL {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: try appGroup()) else {
      throw CocoaError(.fileNoSuchFile)
    }
    return container.appendingPathComponent("KeyboardHistory", isDirectory: true)
      .appendingPathComponent(name)
  }

  static func read() throws -> KeyboardHistory {
    try JSONDecoder().decode(Self.self, from: Data(contentsOf: fileURL()))
  }

  static func write<T: Encodable>(_ value: T, to name: String = "history.json") throws {
    try JSONEncoder().encode(value).write(to: fileURL(name), options: [.atomic, .completeFileProtection])
  }

  static func replace(with items: [KeyboardClipboardItem]) throws {
    var directory = try fileURL().deletingLastPathComponent()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var resources = URLResourceValues()
    resources.isExcludedFromBackup = true
    try directory.setResourceValues(resources)

    let history = KeyboardHistory(revision: UUID(), connectionID: (try? read())?.connectionID,
                                  items: Array(items.prefix(itemLimit)), updatedAt: items.isEmpty ? nil : Date())
    try write(history)
    try remove("remote.json")
  }

  static func remove(_ name: String) throws {
    do {
      try FileManager.default.removeItem(at: fileURL(name))
    } catch CocoaError.fileNoSuchFile {
      // The requested state already exists.
    }
  }
}
