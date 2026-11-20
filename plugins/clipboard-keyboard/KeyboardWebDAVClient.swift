import CryptoKit
import Foundation

struct KeyboardRemoteCache: Codable {
  static let mediaFormat = 1

  let revision: UUID?
  let connectionID: UUID
  let devices: [String: KeyboardDeviceHead]
  let items: [KeyboardClipboardItem]
  let fetchedAt: Date
  let format: Int?

  static func read(for history: KeyboardHistory) -> Self? {
    guard let file = try? KeyboardHistory.fileURL("remote.json"),
          let data = try? Data(contentsOf: file),
          let cache = try? JSONDecoder().decode(Self.self, from: data),
          cache.revision == history.revision, cache.connectionID == history.connectionID else { return nil }
    return cache
  }
}

struct KeyboardDeviceHead: Codable, Equatable {
  let latest_op_seq: Int64?
  let snapshot_op_seq: Int64?
  let snapshot_updated_at: Int64?
}

private struct KeyboardWebDAVHead: Decodable {
  let devices: [String: KeyboardDeviceHead]
}

private struct KeyboardWebDAVBatch: Decodable {
  let device_id: String
  let latest_op_seq: Int64?
  let seq: Int64?
  let entries: [KeyboardWebDAVItem]
}

private struct KeyboardWebDAVItem: Decodable {
  let content_type: String
  let content: String
  let content_hash: Int64?
  let content_blob_hash: String?
  let html_content: String?
  let html_blob_hash: String?
  let deleted_at: Int64?
  let timestamp: Int64

  var isDeleted: Bool { (deleted_at ?? 0) > 0 }
  var isSupported: Bool { ["text", "url", "code", "rich_text", "image"].contains(content_type) }
  var changeTime: Int64 { max(timestamp, deleted_at ?? 0) }

  var key: String {
    if let hash = content_hash, hash != 0 { return "\(content_type):\(hash)" }
    let normalized = content.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    let hash = normalized.utf8.reduce(UInt32(2_166_136_261)) { ($0 ^ UInt32($1)) &* 16_777_619 }
    return "\(content_type):\(hash == 0 ? 1 : hash)"
  }
}

enum KeyboardWebDAVError: Error {
  case incompleteSync, encryptionMismatch, assetTooLarge
}

private final class KeyboardWebDAVRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    // WebDAV credentials belong to the configured origin.
    guard let from = response.url, let to = request.url, to.scheme == from.scheme, to.host == from.host,
          to.port == from.port, to.user == nil, to.password == nil else {
      completionHandler(nil)
      return
    }
    completionHandler(request)
  }
}

struct KeyboardWebDAVClient {
  let connection: KeyboardWebDAVConnection
  let session: URLSession
  private let key: SymmetricKey?
  private let deadline = Date().addingTimeInterval(10)
  private static let magic = Data("TZE1".utf8)

  init(connection: KeyboardWebDAVConnection, session: URLSession? = nil) throws {
    guard connection.isValidURL else { throw URLError(.unsupportedURL) }
    self.connection = connection
    let config = URLSessionConfiguration.ephemeral
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.httpShouldSetCookies = false
    config.urlCredentialStorage = nil
    config.timeoutIntervalForResource = 10
    key = try Self.webDAVKey(connection.e2eKey)
    self.session = session ?? URLSession(configuration: config, delegate: KeyboardWebDAVRedirects(), delegateQueue: nil)
  }

  func fetch(history: KeyboardHistory, cached: KeyboardRemoteCache?) async throws -> KeyboardRemoteCache {
    defer { session.finishTasksAndInvalidate() }
    guard let connectionID = connection.id, history.connectionID == connectionID else {
      throw KeyboardWebDAVError.incompleteSync
    }

    let head: KeyboardWebDAVHead = try await read(["head.json"])
    let devices = head.devices.filter { $0.key != connection.deviceID }
    if let cached, cached.devices == devices, cached.format == KeyboardRemoteCache.mediaFormat { return cached }
    var entries: [String: KeyboardWebDAVItem] = [:]
    var matchedDevices = 0
    // Snapshots can lag the head by several minutes. Apply the published ops on top.
    for id in devices.keys.sorted() {
      guard let device = devices[id] else { continue }
      do {
        let deviceEntries = try await readDevice(id, head: device)
        matchedDevices += 1
        for item in deviceEntries {
          if let current = entries[item.key], current.changeTime > item.changeTime
            || (current.changeTime == item.changeTime && current.isDeleted) { continue }
          entries[item.key] = item
        }
      } catch KeyboardWebDAVError.encryptionMismatch {
        continue
      }
    }
    guard matchedDevices > 0 || devices.isEmpty else { throw KeyboardWebDAVError.encryptionMismatch }

    var items: [KeyboardClipboardItem] = []
    var seenText: Set<String> = []
    var inlineBudget = KeyboardHistory.inlineMediaBudget
    let latest = entries.filter { !$0.value.isDeleted }.sorted {
      $0.value.timestamp == $1.value.timestamp ? $0.key < $1.key : $0.value.timestamp > $1.value.timestamp
    }
    for (_, item) in latest {
      if items.count == KeyboardHistory.itemLimit { break }
      if item.content_type == "image" {
        var image: String?
        if item.content_blob_hash == nil, item.content.hasPrefix("data:image/"), item.content.utf8.count <= inlineBudget {
          image = item.content
          inlineBudget -= item.content.utf8.count
        }
        if image != nil || item.content_blob_hash != nil {
          items.append(KeyboardClipboardItem(kind: .image, image: image, blobHash: item.content_blob_hash,
                                            timestamp: Double(item.timestamp)))
        }
        continue
      }

      var html: String?
      if item.content_type == "rich_text", let inline = item.html_content, !inline.isEmpty,
         inline.utf8.count <= inlineBudget {
        html = inline
        inlineBudget -= inline.utf8.count
      }
      let htmlHash = item.content_type == "rich_text" ? item.html_blob_hash : nil
      var text = item.content
      if let hash = item.content_blob_hash, !hash.isEmpty {
        // A UTF-16 unit uses at most three UTF-8 bytes. Anything bigger can't fit.
        let data = try await readBlob(kind: "content", hash: hash, maxBytes: KeyboardHistory.textLimit * 3)
        text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      }
      if text.utf16.count > KeyboardHistory.textLimit { text = "" }
      if html != nil || htmlHash != nil {
        items.append(KeyboardClipboardItem(kind: .richText, text: text, html: html, blobHash: htmlHash))
      } else if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, seenText.insert(text).inserted {
        items.append(KeyboardClipboardItem(text: text))
      }
    }
    return KeyboardRemoteCache(revision: history.revision, connectionID: connectionID,
                               devices: devices, items: items, fetchedAt: Date(), format: KeyboardRemoteCache.mediaFormat)
  }

  func fetchAsset(for item: KeyboardClipboardItem) async throws -> Data {
    defer { session.finishTasksAndInvalidate() }
    guard let hash = item.blobHash, item.kind != .text else { throw KeyboardWebDAVError.incompleteSync }
    // Desktop image blobs may contain a base64 data URL instead of raw image bytes.
    let limit = item.kind == .image ? ((KeyboardHistory.imageLimit + 2) / 3) * 4 + 128 : KeyboardHistory.htmlLimit
    let kind = item.kind == .image ? "image" : "html"
    guard let data = try await readBlob(kind: kind, hash: hash, maxBytes: limit) else {
      throw KeyboardWebDAVError.assetTooLarge
    }
    return data
  }

  private func readBlob(kind: String, hash: String, maxBytes: Int) async throws -> Data? {
    guard hash.count >= 2, hash.allSatisfy(\.isHexDigit) else { throw KeyboardWebDAVError.incompleteSync }
    // Sealed blobs include a magic header, a nonce and an authentication tag.
    guard let bytes = try await download(["blobs", String(hash.prefix(2)), "\(kind)_\(hash).blob"], maxBytes: maxBytes + 32) else {
      return nil
    }
    let data = try Self.open(bytes, kind: "blob", key: key)
    return data.count <= maxBytes ? data : nil
  }

  private func readDevice(_ id: String, head: KeyboardDeviceHead) async throws -> [KeyboardWebDAVItem] {
    var items: [KeyboardWebDAVItem] = []
    var sequence = head.snapshot_op_seq ?? 0
    if (head.snapshot_updated_at ?? 0) > 0 {
      let snapshot: KeyboardWebDAVBatch = try await read(["devices", "\(id).json"], kind: "snapshot")
      guard snapshot.device_id == id else { throw KeyboardWebDAVError.incompleteSync }
      sequence = snapshot.latest_op_seq ?? sequence
      items = snapshot.entries.filter(\.isSupported)
    }
    let end = head.latest_op_seq ?? 0
    guard sequence >= 0 else { throw KeyboardWebDAVError.incompleteSync }
    while sequence < end {
      let lastInWindow = sequence + min(4, end - sequence)
      try await withThrowingTaskGroup(of: (Int64, [KeyboardWebDAVItem]).self) { group in
        for cursor in (sequence + 1)...lastInWindow {
          group.addTask {
            let name = "\(id)__\(String(format: "%020lld", cursor)).json"
            let batch: KeyboardWebDAVBatch = try await read(["ops", name], kind: "ops")
            guard batch.device_id == id, batch.seq == cursor else { throw KeyboardWebDAVError.incompleteSync }
            return (cursor, batch.entries.filter(\.isSupported))
          }
        }
        var batches: [(Int64, [KeyboardWebDAVItem])] = []
        for try await batch in group { batches.append(batch) }
        for (_, entries) in batches.sorted(by: { $0.0 < $1.0 }) { items.append(contentsOf: entries) }
      }
      sequence = lastInWindow
    }
    return items
  }

  private func read<T: Decodable>(_ path: [String], kind: String? = nil) async throws -> T {
    guard let data = try await download(path, maxBytes: 8 * 1024 * 1024) else {
      throw KeyboardWebDAVError.incompleteSync
    }
    let plaintext = try kind.map { try Self.open(data, kind: $0, key: key) } ?? data
    return try JSONDecoder().decode(T.self, from: plaintext)
  }

  private func download(_ path: [String], maxBytes: Int) async throws -> Data? {
    try Task.checkCancellation()
    let remaining = deadline.timeIntervalSinceNow
    guard remaining > 0 else { throw URLError(.timedOut) }
    let components = connection.basePath.split(separator: "/").map(String.init) + path
    guard components.allSatisfy({ $0 != "." && $0 != ".." && !$0.contains("/") && !$0.contains("\\") }) else {
      throw URLError(.badURL)
    }
    let url = components.reduce(connection.url) { $0.appendingPathComponent($1, isDirectory: false) }
    var request = URLRequest(url: url, timeoutInterval: remaining)
    if !connection.username.isEmpty {
      let value = Data("\(connection.username):\(connection.password)".utf8).base64EncodedString()
      request.setValue("Basic \(value)", forHTTPHeaderField: "Authorization")
    }
    let (file, response) = try await session.download(for: request)
    defer { try? FileManager.default.removeItem(at: file) }
    guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
      throw URLError(.badServerResponse)
    }
    let length = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    return length <= maxBytes ? try Data(contentsOf: file) : nil
  }

  // Matches the TieZ WebDAV v1 wire format in src/lib/e2eCore.ts.
  static func webDAVKey(_ encoded: String) throws -> SymmetricKey? {
    let trimmed = encoded.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let standard = trimmed.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    let padded = standard + String(repeating: "=", count: (4 - standard.count % 4) % 4)
    guard let master = Data(base64Encoded: padded), master.count == 32 else { throw KeyboardWebDAVError.encryptionMismatch }
    let key = HMAC<SHA256>.authenticationCode(for: Data("tiez-e2e-v1 webdav".utf8), using: SymmetricKey(data: master))
    return SymmetricKey(data: key)
  }

  static func open(_ bytes: Data, kind: String, key: SymmetricKey?) throws -> Data {
    let sealed = bytes.starts(with: magic)
    if !sealed && key == nil { return bytes }
    guard let key, sealed, let box = try? AES.GCM.SealedBox(combined: bytes.dropFirst(magic.count)),
          let data = try? AES.GCM.open(box, using: key, authenticating: Data("tiez-e2e-v1/\(kind)".utf8)) else {
      throw KeyboardWebDAVError.encryptionMismatch
    }
    return data
  }
}
