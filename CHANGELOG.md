# Changelog

## [0.1.0] - 2026-11-17
### Added
- Android TV Kotlin / Compose 工程骨架。
- Android 14 首轮适配基线：compileSdk 35、targetSdk 34、minSdk 26。
- 频道与多信号源数据模型。
- 免费来源准入过滤：仅 FREE_VERIFIED 来源可展示。
- TV 首页、分类入口和 D-pad / 飞鼠焦点基础样式。
- Media3 与官方 WebView 播放组件基础实现。
- 产品需求、架构、来源登记和测试文档。

### Notes
- 本版本不包含未经验证的真实直播地址。
- 本版本尚未在 Android SDK 环境中完成构建，需通过 Android Studio / Android SDK 构建验证。
- 0.1.0 为开发测试基线，不是稳定版。

## [0.1.1] - 2026-11-17
### Added
- 首页增加 CCTV-1 官方直播网页测试入口。
- 新增应用内 WebView 播放测试页，提供加载/错误状态和返回入口。
- WebView 限制顶层导航到 HTTPS 的央视网/央视网系域名，禁用文件访问与混合内容，SSL 错误时取消加载。
### Notes
- 使用央视网公开的 CCTV-1 官方直播页面，不提取或拼接媒体流地址。
- 当前仅为官方网页播放兼容性测试；频道免费资格、实际画面/声音、全屏与遥控器体验需在目标盒子实测。
- 仍为开发测试版，不是稳定版。
