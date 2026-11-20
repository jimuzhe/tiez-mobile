# TieZ Mobile

TieZ Mobile 是 [TieZ Clipboard Manager](https://github.com/jimuzhe/tiez-clipboard) 的移动端配套应用。本项目旨在增强桌面端的同步体验，通过多种通信协议实现手机与 PC 之间的高效内容流转与文件互传。

## 核心功能

### 多协议云同步

支持 WebDAV 与 MQTT 协议。通过 WebDAV 实现剪贴板历史记录的持久化存取，利用 MQTT 实现跨设备内容的近实时推送与同步。

### 扫码即连的局域网快传

无需复杂的配对流程，通过扫描二维码即可在移动端与 PC 端之间建立局域网连接。支持文本、图片及视频文件的原画质极速传输，并提供内置的媒体预览与播放功能。

### 深度系统集成 (Android)

- 快捷设置磁贴：支持在 Android 下拉中心添加自定义磁贴，实现一键捕捉并推送当前剪贴板至 PC。
- 应用快捷菜单 (App Shortcuts)：长按应用图标可直接唤起扫码快传、获取远程记录或执行快速同步任务。

### 自动接力逻辑

支持在获取 PC 端远程记录后，自动将最新条目写入移动端系统剪贴板。

### 剪贴板键盘（iOS）

首次使用时，在 TieZ「设置」保存 WebDAV 配置并开启「键盘剪贴板历史」。在系统「设置 → 通用 → 键盘 → 键盘 → 添加新键盘」添加「TieZ 剪贴板」。在其他 App 的输入框用地球键切换到 TieZ，再点选一条记录。

在 TieZ 开启「键盘自动拉取」，并在系统键盘设置为 TieZ 开启「允许完全访问」后，切到键盘会从已配置的 WebDAV 读取快照和最新增量。键盘列表支持下拉刷新。关闭完全访问时，键盘仍可使用缓存，也可以在 TieZ 的「同步」页手动拉取。WebDAV 连接信息保存在共享钥匙串中，修改同步地址、账号、密码或密钥后需要重新开启自动拉取。

键盘显示最近 20 条 WebDAV 记录。普通文字、链接和代码点按即插入，单条最多 16,384 个 UTF-16 代码单元。开启「允许完全访问」后，点按图片或富文本会复制到本机系统剪贴板，再在当前输入框点「粘贴」。目标 App 决定接收哪些图片和富文本格式。

需要从 WebDAV 取回的图片和富文本会在点按时下载，此时需要开启「键盘自动拉取」并联网。键盘支持最多 8 MiB 的单张图片和 2 MiB 的单条 HTML。关闭键盘历史或清理本地缓存会清空键盘中的记录。

## 开发与构建

本项目基于 Expo (React Native) 框架开发。

### 环境准备

1. 安装依赖

   ```bash
   npm install
   ```

2. 启动开发服务器

   ```bash
   npx expo start
   ```

### 生产构建

本项目集成了 EAS Build 自动化流水线。

iOS 键盘由 Expo 预构建生成，需要原生构建。签名时将 App Group `group.com.jimuzhe.tiez.keyboard` 分配给主应用 `com.jimuzhe.tiez` 和扩展 `com.jimuzhe.tiez.keyboard`。

- 构建 Android 群测版 APK：

  ```bash
  npm run release:beta:android
  ```

- 构建 iOS TestFlight 版本：

  ```bash
  npm run release:beta:ios
  ```

- 构建 Android / iOS 正式版：

  ```bash
  npm run release:stable:android
  npm run release:stable:ios
  ```

版本统一维护在 `versions.json`。构建脚本会按平台和渠道临时同步
`package.json` 与 `app.json`，EAS 上传完成后自动恢复工作区；`versionCode`
和 `buildNumber` 由 EAS Remote Version 自动递增。

### 更新通道

移动端通过 `https://tiez.name666.top/api/v1/latest-version` 检查更新：

- `production` 构建使用 `stable` 通道。
- `beta`、`preview`、`ipa` 和开发构建使用 `beta` 通道。
- Android 返回对应架构或通用 APK 的下载地址。
- iOS 正式版返回 App Store 地址，Beta 返回 TestFlight 地址。

安装包仍可托管在 GitHub Release；发布完成后，在 TieZ 管理后台创建对应的
Android/iOS 制品并发布。移动制品不填写 Tauri `.sig`。

## 开源协议

本项目遵循 [GNU General Public License v3.0 (GPL-3.0)](LICENSE) 开源协议。

---

Designed by TieZ.
