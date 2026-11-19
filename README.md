# TVLive

面向 Android TV 电视盒子的国内广电官方直播应用。

## 当前开发版本

**0.3.0-alpha.10** — 直播模块与返回键状态流重构测试版。不是稳定版。

## 已确认产品范围

- 仅适配标准十字方向键遥控器。
- 仅面向 Android TV / Android TV Box，横屏全屏。
- 仅接入国内广电官方直播页面或明确授权的媒体资源。
- 仅使用互联网，不提供局域网网页管理端。
- Media3 ExoPlayer 为原生媒体播放引擎；WebView 仅用于允许嵌入的官方网页。
- 上下键换台，左键呼出频道列表，确定键选择，返回键关闭列表。
- 切台时先停止旧播放会话并显示静态占位层；确认新视频首帧后再显示新画面。
- 不绕过登录、会员、地区限制或 DRM，不提取受保护媒体流。

## 当前实现状态

- 已建立全屏电视播放界面和标准 D-pad 操作。
- 首批 CCTV-1、CCTV-13 官方网页入口仅作为设备验证入口；尚未宣称实际播放成功。
- WebView 通过页面视频元素首帧探测回调控制占位层。
- Media3 播放组件支持 HLS / DASH 首帧回调，并在首帧前静音。
- 北京、内蒙古、浙江等地方广电频道待官方入口核验后接入。
- WebView 内嵌 iframe 或受保护播放器可能无法向宿主暴露首帧，需在目标盒子实测。

## 构建

使用 Android Studio 打开仓库，安装 Android SDK Platform 35 与 JDK 17，等待 Gradle Sync 后运行：

```bash
gradle :app:assembleDebug
```

APK：`app/build/outputs/apk/debug/app-debug.apk`

## 版本与验收

每次改动更新 CHANGELOG、版本号、Git 提交和测试结果。GitHub Actions 构建成功不代表真实设备播放验收成功。正式稳定版必须经过实际电视盒子测试并由用户确认。
