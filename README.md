# TVLive Hub

Android TV 综合电视直播应用（工程代号）。

## 当前版本
0.1.0 — 开发测试工程骨架，不是稳定版。

## 目标
- Android TV / S905X5M，首轮实测设备 Android 14。
- Media3 + WebView。
- 一个频道支持多个免费信号源。
- 保留咪咕视频，同时支持其他平台的合法免费来源。
- 十字键和飞鼠操作。
- 电视本机播放，不做局域网转发。

## 构建
使用 Android Studio 打开本目录，安装 Android SDK Platform 35 与 JDK 17，等待 Gradle Sync 后运行 `:app:assembleDebug`。

生成 APK：`app/build/outputs/apk/debug/app-debug.apk`

## 当前限制
本版本提供工程骨架、首页、数据模型、免费来源过滤和双播放器基础组件。没有加入未经验证的直播地址。完整播放导航、来源选择、自动故障切换和实机兼容性测试将在后续迭代完成。

## 合规
不绕过登录、会员、地区限制或 DRM，不提取受保护媒体流。
