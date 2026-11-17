# 技术架构

## Android TV 播放端
- UI：Kotlin + Jetpack Compose，按电视大屏与 D-pad 焦点设计。
- 播放：Media3 ExoPlayer 用于平台允许直接播放的媒体；WebView 用于官方网页播放器。
- Data：Channel 与 ChannelSource 一对多；每个来源独立记录 provider、播放类型、免费状态、优先级、质量、验证时间和错误。
- Policy：仅 FREE_VERIFIED 且 enabled 的来源可被播放调度器选择。
- Player lifecycle：切台前停止并释放前一播放会话；任何时刻只允许一个活动音视频会话。
- Fallback：仅对网络/播放器类故障尝试下一个已验证来源；会员/登录/地区限制不触发规避行为。

## 局域网网页管理端（0.2.0）
- 手机/电脑浏览器负责配置，电视端负责播放。
- Android 内嵌 NanoHTTPD，仅提供频道和来源配置 API；不代理、下载或转发视频流。
- 管理页面作为 APK assets 内静态 HTML 提供。
- 频道与来源配置保存在电视本机 SharedPreferences。
- 配对码在应用运行期间显示，配对成功后使用 Bearer token 访问管理 API。
- 管理服务绑定 0.0.0.0:8765；仅在 TVLive Hub Activity 生命周期内运行，退出时停止。
- 新来源默认 PENDING，不能因用户添加就视为免费或已验证。

## 后续
- 来源可达性与实际播放测试。
- 将通过验证的本机配置映射为播放端频道列表。
- 自动选源与故障切换。
- 频道分组、收藏、节目单、配置导入导出。
