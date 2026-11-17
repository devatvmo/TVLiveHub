# 技术架构

- UI：Kotlin + Jetpack Compose，按电视大屏与 D-pad 焦点设计。
- 播放：Media3 ExoPlayer 用于平台允许直接播放的媒体；WebView 用于官方网页播放器。
- Data：Channel 与 ChannelSource 一对多；每个来源独立记录 provider、播放类型、免费状态、优先级、质量、验证时间和错误。
- Policy：仅 FREE_VERIFIED 且 enabled 的来源可被播放调度器选择。
- Player lifecycle：切台前停止并释放前一播放会话；任何时刻只允许一个活动音视频会话。
- Fallback：仅对网络/播放器类故障尝试下一个已验证来源；会员/登录/地区限制不触发规避行为。
- 0.1.0 先交付工程骨架和首页，真实来源经逐项验证后再加入。
