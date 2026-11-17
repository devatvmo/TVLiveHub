# 局域网网页管理（0.2.0）

## 使用
1. 启动 TVLive Hub，进入“网页管理”。
2. 手机或电脑连接同一局域网，扫描电视显示的二维码，或手动访问电视显示的地址。
3. 输入电视屏幕上的 6 位配对码完成配对。
4. 创建频道，选中频道后独立添加多个来源。
5. 来源可设置名称、类型（HLS / DASH / 官方网页）、地址、优先级和启用状态。

## 本地接口
- POST /api/pair：使用 6 位配对码换取本次运行的 Bearer token。
- GET /api/channels：读取频道与来源。
- POST /api/channels：创建频道。
- PUT /api/channels/{channelId}、DELETE /api/channels/{channelId}。
- POST /api/channels/{channelId}/sources。
- PUT /api/channels/{channelId}/sources/{sourceId}、DELETE 同一路径。

除首页与配对接口外，API 均要求 Authorization: Bearer <token>。

## 安全边界
- 服务监听电视本机 TCP 8765 端口，仅用于本地配置管理。
- 不提供视频代理、转发、下载或公网访问功能。
- 配对码在本次应用运行期间有效；管理令牌保存在网页当前 sessionStorage。
- 直播源仅接受 HTTP/HTTPS URL，不允许在 URL 中嵌入账号密码。
- 新增来源默认 PENDING，不能因为用户添加就标记为免费或已验证。
- 登录、会员、DRM、地区限制不做绕过。

## 当前限制
- 0.2.0 首轮实现管理端 CRUD；来源可达性与实际视频播放检测将在后续版本实现。
- 管理服务在 TVLive Hub Activity 运行期间开放；退出应用后服务停止。
- 多网卡环境可能显示多个地址，请使用与手机/电脑处于同一局域网的地址。
