# 播放与换台技术设计

## 1. 播放会话原则
任意时刻只允许一个活动播放会话。界面通过单一 PlaybackSurface 管理当前频道，频道变化时销毁旧会话并创建新会话。

## 2. 状态机
IDLE → SWITCHING → PREPARING → WAITING_FIRST_FRAME → PLAYING
任何阶段均可进入 ERROR；重试重新开始 PREPARING。

## 3. Media3
- 创建 ExoPlayer 时 volume=0。
- 设置 MediaItem、prepare 并开始准备播放。
- Player.Listener.onRenderedFirstFrame 是首帧确认事件。
- 首帧回调后恢复音量并通知界面隐藏占位层。
- onPlayerError 立即静音并上报错误。
- dispose 时先 volume=0，再 stop、removeListener、release。

## 4. WebView
- 只允许官方 HTTPS 顶层域名。
- 禁止文件访问、混合内容；SSL 错误必须 cancel。
- 旧 WebView dispose 时先对页面 video 元素 pause/mute，再 onPause、stopLoading、about:blank、destroy。
- 页面 onPageFinished 只表示网页加载完成，不表示视频首帧。
- 注入 video 元素探测脚本；在 videoWidth/videoHeight 有效且 requestVideoFrameCallback 回调发生后才通知宿主首帧。
- 仅能探测当前文档内的视频元素。跨域 iframe、DRM 或自定义播放器可能无法暴露首帧，必须保留等待/错误提示，不得伪造成功。

## 5. 快速换台
- 频道索引由 UI 单一状态管理。
- 每次切换更新 selectedChannel。
- Compose key 使用 channelId + reloadToken，触发旧播放组件 dispose。
- 旧组件 dispose 停止音频和释放资源。
- 新组件在首帧前保持静态占位层。
- 若未来引入异步直连源解析，必须增加递增 generationId，回调时检查是否仍为最新请求。

## 6. 音频安全
Media3 在首帧前强制静音。WebView 通过页面视频元素脚本尽早静音并在首帧后解除静音；若网页将视频放在跨域 iframe 内，宿主可能无法保证首帧前静音，该页面不应在未实测通过前进入正式可播放频道列表。

## 7. 关键验收
- 旧频道声音立即停止。
- 新频道首帧前不显示旧画面。
- 首帧事件之前不恢复新频道声音。
- 快速切换最终落在最后选择的频道。
- 任何加载失败都保留可操作界面。
