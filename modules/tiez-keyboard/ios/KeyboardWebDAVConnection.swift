import Foundation
import Security

struct KeyboardWebDAVConnection: Codable {
  var id: UUID?
  let url: URL
  let basePath: String
  let username: String
  let password: String
  let e2eKey: String
  let deviceID: String

  var isValidURL: Bool {
    ["https", "http"].contains(url.scheme?.lowercased() ?? "") && url.host != nil && url.user == nil
      && url.password == nil && url.query == nil && url.fragment == nil
  }

  private static func query() throws -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrAccessGroup as String: try KeyboardHistory.appGroup(),
     kSecAttrService as String: "TieZKeyboard",
     kSecAttrAccount as String: "webdav"]
  }

  static func read() throws -> Self? {
    var query = try query()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    try check(status)
    guard let data = result as? Data else { throw CocoaError(.fileReadCorruptFile) }
    return try JSONDecoder().decode(Self.self, from: data)
  }

  func write() throws {
    let query = try Self.query()
    let data = try JSONEncoder().encode(self)
    let values = [kSecValueData as String: data,
                  kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly] as [String: Any]
    let status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
    if status == errSecItemNotFound {
      try Self.check(SecItemAdd(query.merging(values) { _, value in value } as CFDictionary, nil))
    } else {
      try Self.check(status)
    }
  }

  static func remove() throws {
    let status = SecItemDelete(try query() as CFDictionary)
    if status != errSecItemNotFound { try check(status) }
  }

  private static func check(_ status: OSStatus) throws {
    guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
  }
}
