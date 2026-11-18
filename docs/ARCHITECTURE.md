# 技术架构（TVLive）

## 平台基线
- Kotlin。
- Android TV / Android TV Box。
- minSdk 26，compileSdk 35，targetSdk 34。
- Jetpack Compose + Material 3。
- 横屏、沉浸式全屏。
- JDK 17 / Gradle 8.9 / Android Gradle Plugin 8.7.3。

## 播放架构
- Media3 ExoPlayer：用于官方明确允许直接播放的 HLS / DASH 媒体地址。
- Android WebView：用于官方允许嵌入的 HTTPS 直播网页。
- 任意时刻只允许一个活动播放会话。
- Media3 首帧前 volume=0，收到 onRenderedFirstFrame 后恢复音量。
- 切台时旧播放器静音、stop、release；旧 WebView 暂停媒体、停止加载、导航 about:blank 并 destroy。
- 页面首帧探测不可用时，不得仅因 onPageFinished 就隐藏占位层。
- WebView 内嵌跨域 iframe、DRM 或受保护播放器可能无法被宿主准确探测，需标记为兼容性限制。

## UI 与遥控器
- Compose 单屏直播界面。
- 上/下：换台。
- 左：呼出/关闭频道抽屉。
- 抽屉内上/下移动焦点，确定播放，返回关闭。
- 不实现飞鼠、鼠标悬停或触屏专用交互。

## 数据与资源
- 官方频道目录与播放地址分离。
- 每个频道记录 broadcaster、officialPage、playbackType、验证状态与最后验证时间。
- 未验证来源不标记为可播放。
- 首批 CCTV-1、CCTV-13 页面仅为待实机验证的官方网页入口。
- 北京、内蒙古、浙江广电入口逐个核验后再加入。

## 合规与安全
- 仅 HTTPS 官方页面。
- WebView 禁止文件访问、混合内容及 SSL 错误继续加载。
- 不绕过登录、会员、地区限制或 DRM。
- 不代理、下载或转发视频流。

## 构建
GitHub Actions 使用 JDK 17 和 Gradle 8.9 执行 :app:assembleDebug，并上传 APK 构建产物。
