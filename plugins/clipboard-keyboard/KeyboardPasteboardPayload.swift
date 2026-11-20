import Foundation
import ImageIO
import UniformTypeIdentifiers

enum KeyboardPasteboardPayload {
  static func representations(for item: KeyboardClipboardItem, content: Data) throws -> [String: Data] {
    switch item.kind {
    case .image:
      let image: Data
      if content.starts(with: Data("data:image/".utf8)) {
        guard let comma = content.firstIndex(of: 0x2c),
              let header = String(data: content[..<comma], encoding: .utf8), header.hasSuffix(";base64"),
              let decoded = Data(base64Encoded: content.suffix(from: content.index(after: comma))) else {
          throw CocoaError(.fileReadCorruptFile)
        }
        image = decoded
      } else {
        image = content
      }
      guard image.count <= KeyboardHistory.imageLimit else { throw KeyboardWebDAVError.assetTooLarge }
      guard let source = CGImageSourceCreateWithData(image as CFData, nil),
            let identifier = CGImageSourceGetType(source),
            (identifier as String) != UTType.pdf.identifier,
            CGImageSourceGetStatus(source) == .statusComplete,
            CGImageSourceGetCount(source) > 0 else { throw CocoaError(.fileReadCorruptFile) }
      // Keep the original file representation, including GIF animation and transparency.
      return [identifier as String: image]
    case .richText:
      guard content.count <= KeyboardHistory.htmlLimit else { throw KeyboardWebDAVError.assetTooLarge }
      guard let html = String(data: content, encoding: .utf8),
            !html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw CocoaError(.fileReadCorruptFile)
      }
      var types = [UTType.html.identifier: content]
      if !item.text.isEmpty { types[UTType.utf8PlainText.identifier] = Data(item.text.utf8) }
      return types
    case .text:
      return [UTType.utf8PlainText.identifier: Data(item.text.utf8)]
    }
  }
}
