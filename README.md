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

- 构建 Android 预览版 (APK):
  ```bash
  eas build --platform android --profile preview
  ```

- 构建 iOS 版本:
  ```bash
  eas build --platform ios
  ```

## 自动化

项目通过 GitHub Actions 配置了 CI/CD 流程。代码推送至主分支后，将自动触发云端构建任务。

---

Designed by TieZ Team.
