import UIKit

final class KeyboardViewController: UIInputViewController, UITableViewDataSource, UITableViewDelegate {
  private let table = UITableView(frame: .zero, style: .plain)
  private let status = UILabel()
  private let emptyMessage = UILabel()
  private let letterKeys = UIStackView()
  private var letterButtons: [UIButton] = []
  private var items: [KeyboardClipboardItem] = []
  private var updatedAt: Date?
  private var refreshTask: Task<Void, Never>?
  private var refreshStatus: String?
  private var copyTask: Task<Void, Never>?
  private var copyStatus: String?
  private var showingLetters = false
  private var shifted = false
  private lazy var inputModeButton = button(symbol: "globe", label: "切换键盘")
  private lazy var panelButton = button(title: "ABC", label: "英文字母键盘")

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemGray6

    inputModeButton.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
    panelButton.addAction(UIAction { [weak self] _ in self?.switchPanel() }, for: .touchUpInside)
    let delete = button(symbol: "delete.left", label: "删除")
    delete.addAction(UIAction { [weak self] _ in self?.textDocumentProxy.deleteBackward() }, for: .touchUpInside)

    status.font = .preferredFont(forTextStyle: .subheadline)
    status.adjustsFontForContentSizeCategory = true
    status.textColor = .secondaryLabel
    status.textAlignment = .center
    status.adjustsFontSizeToFitWidth = true
    status.setContentHuggingPriority(.defaultLow, for: .horizontal)
    status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    let toolbar = UIStackView(arrangedSubviews: [inputModeButton, panelButton, status, delete])
    toolbar.spacing = 6
    toolbar.heightAnchor.constraint(equalToConstant: 42).isActive = true
    for key in [inputModeButton, panelButton, delete] {
      let width = key.widthAnchor.constraint(equalToConstant: 54)
      width.priority = .defaultHigh
      width.isActive = true
    }

    emptyMessage.font = .preferredFont(forTextStyle: .body)
    emptyMessage.adjustsFontForContentSizeCategory = true
    emptyMessage.textColor = .secondaryLabel
    emptyMessage.textAlignment = .center
    emptyMessage.numberOfLines = 0
    let swappablePanel = UIView()
    swappablePanel.addSubview(table)
    swappablePanel.addSubview(letterKeys)

    table.backgroundColor = .clear
    table.alwaysBounceVertical = true
    table.rowHeight = UITableView.automaticDimension
    table.estimatedRowHeight = 54
    table.dataSource = self
    table.delegate = self
    table.register(UITableViewCell.self, forCellReuseIdentifier: "history")
    let refresh = UIRefreshControl()
    refresh.addAction(UIAction { [weak self] _ in self?.refreshHistory() }, for: .valueChanged)
    table.refreshControl = refresh
    configureLetterKeys()

    let layout = UIStackView(arrangedSubviews: [toolbar, swappablePanel])
    layout.axis = .vertical
    layout.spacing = 4
    view.addSubview(layout)
    pin(layout, to: view, inset: 8)
    pin(table, to: swappablePanel)
    pin(letterKeys, to: swappablePanel)
    let height = view.heightAnchor.constraint(equalToConstant: 264)
    height.priority = .defaultHigh
    height.isActive = true
    updatePanel()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    showingLetters = false
    shifted = false
    refreshStatus = nil
    copyStatus = nil
    updateLetterLabels()
    showHistory(try? KeyboardHistory.read())
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    refreshHistory()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    refreshTask?.cancel()
    refreshTask = nil
    copyTask?.cancel()
    copyTask = nil
    table.refreshControl?.endRefreshing()
  }

  private func showHistory(_ history: KeyboardHistory?) {
    let remote = history.flatMap { KeyboardRemoteCache.read(for: $0) }
    items = remote?.items ?? history?.items ?? []
    updatedAt = remote?.fetchedAt ?? history?.updatedAt
    if history == nil {
      emptyMessage.text = "请在 TieZ 设置中开启键盘剪贴板历史"
    } else if history?.connectionID == nil {
      emptyMessage.text = "在 TieZ 设置中开启键盘自动拉取，或在同步页拉取记录"
    } else if !hasFullAccess {
      emptyMessage.text = "在系统键盘设置中为 TieZ 开启「允许完全访问」"
    } else {
      emptyMessage.text = "暂无已同步的记录"
    }
    table.backgroundView = items.isEmpty ? emptyMessage : nil
    table.refreshControl?.isEnabled = history?.connectionID != nil && hasFullAccess
    table.reloadData()
    updatePanel()
  }

  private func refreshHistory() {
    guard refreshTask == nil else { return }
    if copyTask == nil { copyStatus = nil }
    let storedHistory = try? KeyboardHistory.read()
    guard let history = storedHistory, history.connectionID != nil, hasFullAccess else {
      table.refreshControl?.endRefreshing()
      refreshStatus = storedHistory?.connectionID == nil ? nil : "开启完全访问后可自动拉取"
      showHistory(storedHistory)
      return
    }

    refreshStatus = "正在拉取…"
    updatePanel()
    refreshTask = Task { [weak self] in
      guard let self else { return }
      do {
        guard let connection = try KeyboardWebDAVConnection.read() else { throw KeyboardWebDAVError.incompleteSync }
        let client = try KeyboardWebDAVClient(connection: connection)
        let cached = KeyboardRemoteCache.read(for: history)
        let result = try await client.fetch(history: history, cached: cached)
        try Task.checkCancellation()
        if let current = try? KeyboardHistory.read(), current.revision == result.revision,
           current.connectionID == result.connectionID, hasFullAccess, result.fetchedAt != cached?.fetchedAt {
          try KeyboardHistory.write(result, to: "remote.json")
        }
        refreshStatus = nil
      } catch {
        guard !Task.isCancelled else { return }
        refreshStatus = "拉取失败 · 显示缓存"
      }
      refreshTask = nil
      table.refreshControl?.endRefreshing()
      showHistory(try? KeyboardHistory.read())
    }
  }

  override func viewWillLayoutSubviews() {
    super.viewWillLayoutSubviews()
    inputModeButton.isHidden = !needsInputModeSwitchKey
  }

  private func switchPanel() {
    showingLetters.toggle()
    updatePanel()
  }

  private func updatePanel() {
    table.isHidden = showingLetters
    letterKeys.isHidden = !showingLetters
    panelButton.configuration?.title = showingLetters ? "剪贴板" : "ABC"
    panelButton.accessibilityLabel = showingLetters ? "剪贴板历史" : "英文字母键盘"
    if showingLetters {
      status.text = "TieZ 英文"
    } else if let copyStatus {
      status.text = copyStatus
    } else if let refreshStatus {
      status.text = refreshStatus
    } else if let updatedAt {
      status.text = "同步于 \(updatedAt.formatted(.relative(presentation: .named)))"
    } else {
      status.text = "TieZ 剪贴板"
    }
  }

  private func configureLetterKeys() {
    letterKeys.axis = .vertical
    letterKeys.distribution = .fillEqually
    letterKeys.spacing = 4
    for letters in ["qwertyuiop", "asdfghjkl", "zxcvbnm"] {
      let keys = letters.map { character -> UIButton in
        let letter = String(character)
        let key = button(title: letter)
        key.addAction(UIAction { [weak self] _ in self?.typeLetter(letter) }, for: .touchUpInside)
        letterButtons.append(key)
        return key
      }
      let row = UIStackView(arrangedSubviews: keys)
      row.distribution = .fillEqually
      row.spacing = 4
      letterKeys.addArrangedSubview(row)
    }
    let shift = button(symbol: "shift", label: "切换大小写")
    shift.addAction(UIAction { [weak self] _ in
      self?.shifted.toggle()
      self?.updateLetterLabels()
    }, for: .touchUpInside)
    let space = button(title: "空格")
    space.addAction(UIAction { [weak self] _ in self?.textDocumentProxy.insertText(" ") }, for: .touchUpInside)
    let enter = button(symbol: "return", label: "换行")
    enter.addAction(UIAction { [weak self] _ in self?.textDocumentProxy.insertText("\n") }, for: .touchUpInside)
    let bottom = UIStackView(arrangedSubviews: [shift, space, enter])
    bottom.spacing = 4
    shift.widthAnchor.constraint(equalToConstant: 54).isActive = true
    enter.widthAnchor.constraint(equalTo: shift.widthAnchor).isActive = true
    letterKeys.addArrangedSubview(bottom)
  }

  private func updateLetterLabels() {
    for (key, letter) in zip(letterButtons, "qwertyuiopasdfghjklzxcvbnm") {
      key.configuration?.title = shifted ? letter.uppercased() : String(letter)
    }
  }

  private func typeLetter(_ letter: String) {
    textDocumentProxy.insertText(shifted ? letter.uppercased() : letter)
    if shifted {
      shifted = false
      updateLetterLabels()
    }
  }

  private func button(title: String? = nil, symbol: String? = nil, label: String? = nil) -> UIButton {
    var configuration = UIButton.Configuration.filled()
    configuration.title = title
    configuration.image = symbol.flatMap { UIImage(systemName: $0) }
    configuration.baseBackgroundColor = .secondarySystemGroupedBackground
    configuration.baseForegroundColor = .label
    configuration.contentInsets = .init(top: 2, leading: 2, bottom: 2, trailing: 2)
    let button = UIButton(configuration: configuration)
    button.accessibilityLabel = label
    return button
  }

  private func pin(_ content: UIView, to parent: UIView, inset: CGFloat = 0) {
    content.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      content.topAnchor.constraint(equalTo: parent.topAnchor, constant: inset),
      content.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: inset),
      content.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -inset),
      content.bottomAnchor.constraint(equalTo: parent.bottomAnchor, constant: -inset),
    ])
  }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { items.count }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "history", for: indexPath)
    let item = items[indexPath.row]
    var content = cell.defaultContentConfiguration()
    content.text = String(item.text.prefix(200))
    content.textProperties.numberOfLines = 2
    switch item.kind {
    case .text:
      cell.accessibilityHint = "插入到当前输入框"
    case .image:
      content.image = UIImage(systemName: "photo")
      content.text = "图片"
      content.secondaryText = item.timestamp.map {
        Date(timeIntervalSince1970: $0 / 1000).formatted(date: .abbreviated, time: .shortened)
      }
      cell.accessibilityHint = "复制图片，然后在当前输入框粘贴"
    case .richText:
      content.image = UIImage(systemName: "doc.richtext")
      if item.text.isEmpty { content.text = "富文本" }
      cell.accessibilityHint = "复制富文本，然后在当前输入框粘贴"
    }
    cell.accessoryView = item.kind == .text ? nil : UIImageView(image: UIImage(systemName: "document.on.document"))
    cell.contentConfiguration = content
    cell.backgroundColor = .clear
    cell.accessibilityTraits.insert(.button)
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    copyTask?.cancel()
    copyTask = nil
    copyStatus = nil
    let item = items[indexPath.row]
    guard let history = try? KeyboardHistory.read(), contains(item, in: history) else {
      showHistory(try? KeyboardHistory.read())
      return
    }
    if item.kind == .text {
      textDocumentProxy.insertText(item.text)
      updatePanel()
    } else {
      copy(item, history: history)
    }
  }

  private func contains(_ item: KeyboardClipboardItem, in history: KeyboardHistory) -> Bool {
    (KeyboardRemoteCache.read(for: history)?.items ?? history.items).contains(item)
  }

  private func copy(_ item: KeyboardClipboardItem, history: KeyboardHistory) {
    guard hasFullAccess else {
      copyStatus = "请开启完全访问"
      updatePanel()
      return
    }
    let inline = item.kind == .image ? item.image : item.html
    guard inline != nil || history.connectionID != nil else {
      copyStatus = "请开启键盘自动拉取"
      updatePanel()
      return
    }
    copyStatus = item.kind == .image ? "正在准备图片…" : "正在准备富文本…"
    updatePanel()
    copyTask = Task { [weak self] in
      guard let self else { return }
      do {
        let content: Data
        if let inline {
          content = Data(inline.utf8)
        } else {
          guard let connection = try KeyboardWebDAVConnection.read(), connection.id == history.connectionID else {
            throw KeyboardWebDAVError.incompleteSync
          }
          content = try await KeyboardWebDAVClient(connection: connection).fetchAsset(for: item)
        }
        try Task.checkCancellation()
        let values = try KeyboardPasteboardPayload.representations(for: item, content: content)
        if let current = try? KeyboardHistory.read(), current.revision == history.revision,
           hasFullAccess, contains(item, in: current) {
          UIPasteboard.general.setItems([values], options: [.localOnly: true])
          copyStatus = "已复制，请粘贴"
          UIAccessibility.post(notification: .announcement, argument: "已复制，在输入框粘贴")
        } else {
          copyStatus = "记录已更新 · 请重新选择"
          showHistory(try? KeyboardHistory.read())
        }
      } catch KeyboardWebDAVError.assetTooLarge {
        guard !Task.isCancelled else { return }
        copyStatus = "内容过大 · 请在 TieZ 中查看"
      } catch {
        guard !Task.isCancelled else { return }
        copyStatus = "复制失败 · 请重试"
      }
      copyTask = nil
      updatePanel()
    }
  }
}
