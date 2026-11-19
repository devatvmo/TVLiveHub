# TVLive 增量方案：Sama 风格首页 + 静态图等待层 + EPG

> 状态：方案稿 v2（修正版），待用户确认后实施
> 基线分支：`feature/live-module-rebuild`（0.3.0-alpha.12，2026-11-19，commit 532e7ee）
> 说明：本稿推翻 v1 的错误前提。v1 仅读 main（0.2.0）后判断"换台未实现"，经核查远端点全部源码后确认该判断错误，特此更正。

---

## 0. 修正说明（相对 v1 的重大变更）

| v1 的说法（错误） | 实际情况（已核实） |
|---|---|
| "换台逻辑未实现" | `feature/live-module-rebuild` 已完整实现：↑↓换台、←频道抽屉、OK 选择、Activity 级按键分发、D-pad 焦点 |
| "需要我写换台状态机" | 分支已有 `PLAYBACK_DESIGN.md` 定义状态机 `IDLE→SWITCHING→PREPARING→WAITING_FIRST_FRAME→PLAYING`，代码已实现首帧探测、首帧前静音、generationId 防竞态 |
| "需要我写先切声音/等待首帧再呈现" | 已实现：Media3 volume=0 + `onRenderedFirstFrame`；WebView 用 `requestVideoFrameCallback` 探测首帧；旧会话 dispose 先 pause/mute |
| "以 main 为基线" | 应以 `feature/live-module-rebuild` 为基线（最新、最完整）；main 是 0.2.0 旧架构，含已废弃的局域网网页管理 |

**结论：v1 方案中"换台状态机""音频安全""播放层扩展"三章全部作废。这些能力已在基线分支就绪，本方案不重复实现。**

---

## 1. 基线能力盘点（已具备，不动）

### 1.1 产品定位（分支 README / PRD 已确认）
- Android TV 盒子、横屏全屏、仅标准十字方向键遥控器
- 仅国内广电官方直播页或授权媒体；纯互联网，不做局域网网页管理
- Media3 ExoPlayer 为主，WebView 仅用于官方网页
- 版本 0.3.0-alpha.12，测试版

### 1.2 已实现的换台链路
- `MainActivity.kt`：`LiveRemoteController` 在 Activity 层 `dispatchKeyEvent` / `onKeyDown` 拦截 D-pad 与返回键，先于 WebView 全屏视图消费
- `TvLiveScreen`：`page = home | live` 双页；`selectedIndex`、`drawerOpen`、`drawerFocusedIndex`、`reloadToken`、`firstFrame`、`playbackError`、`noContentHint`、`infoVisible` 等状态齐备
- 按键映射：← 开频道抽屉、↑↓ 换台/移焦点、OK 选台、返回逐层退出；换台时 `reloadToken++` 强制重建播放组件（Compose key = channelId + reloadToken）
- `WaitingOverlay`：转圈 + "等待视频首帧…"，含无内容/错误/重试三态
- `ChannelInfoOverlay`、`ChannelDrawer`：信息层与频道抽屉
- `LivePlaybackSurface`（在分支的 PlaybackSurface.kt）：Media3 首帧前静音、`onRenderedFirstFrame` 回调；WebView 官方域名白名单、`video` 元素首帧探测、dispose 时 mute/pause/destroy

### 1.3 首页现状
- `HomeScreen`：按省级标签（中央台、浙江、内蒙古、广东、广西、云南、贵州）分类的频道网格，每行 3 个
- 左右切省份、上下/确定进频道；焦点高对比度边框
- **这不是用户指定的 Sama 四卡片首页**

### 1.4 合规边界（保持）
仅官方 HTTPS 页面；不绕过登录/会员/地区/DRM，不提取受保护流；未实机验证的资源标记"待验证"，不伪造首帧成功。

---

## 2. 本次增量范围（只做三样）

用户确认：以最新 feature 分支为基线，本次只做增量，不重写已做好的换台逻辑。

### 2.1 Sama 风格首页（替换/新增首页样式）
- 参考用户提供的第 16 张 Sama 首页：深色底、四个彩色大入口卡片、功能按钮行、继续观看横排
- 映射为真机内容：
  - 直播（蓝）→ 进入现有省级频道首页或直接进入上次频道
  - 节目单（紫）→ 进入新增的 EPG 页
  - 收藏（绿）→ 频道收藏列表（可先用省份分组代替）
  - 设置（琥珀）→ 保留为占位/调试入口
- 保留现有 D-pad 焦点行为与 `focusRequester`，四卡片 + 按钮行 + 横排三区导航
- 设计令牌沿用分支现有色：`Background #070B12`、`Panel #111A28`、`Accent #65A9FF`

### 2.2 静态图等待层（替换 WaitingOverlay 的转圈）
- 保留 WaitingOverlay 的三态逻辑（等待中 / 无内容 / 错误重试）和首帧控制时机
- 将"等待中"态的 `CircularProgressIndicator` + 文字，换成**静态占位图**：
  - 频道台标（大）+ 频道名 + "正在接入官方直播…"
  - 素材：`assets/covers/<channelId>.png`，无图时回退到纯色底 + 文字台标
  - 静态图由原生 Compose 层绘制，**绝不注入 WebView 网页**（分支 `PLAYBACK_DESIGN.md` 已明确此约束，v4.3 APK 注释亦有实测记录：网页内垫不透明遮罩会导致有声音没画面）
- 保留首帧到达后隐藏占位层的现有机制，不改播放层

### 2.3 EPG 节目单（新增，P1 后续功能）
- 分支 PRD 将 EPG 列为 P1；本次按用户参考图（第 2/4/6 张）实现基础版
- 结构：左侧频道列 × 上方时间轴网格；当前时段高亮；OK 播放该节目对应频道
- 数据来源：分支尚无 EPG 数据源，先用本地示例数据（与 `initialChannels` 对应），留接口待接入真实节目单
- 遥控器：↑↓切频道、←→切节目、OK 播放、返回回首页

---

## 3. 不做的事（明确排除）

- 不重写换台状态机、首帧探测、音频安全、按键分发（基线已有且设计良好）
- 不恢复 main 分支的局域网网页管理（基线产品定位已移除）
- 不接真实直播流地址、不抓取/拼接媒体 URL、不碰 DRM/会员/地区限制
- 不改现有 WebView 安全策略、compose key 与 generationId 防竞态逻辑
- 不引入飞鼠/触屏（基线仅支持十字键）

---

## 4. 文件级改动清单

### 新增
```
app/src/main/java/tv/livehub/app/ui/SamaHomeScreen.kt       Sama 风格首页四卡片
app/src/main/java/tv/livehub/app/ui/EpgScreen.kt            EPG 网格
app/src/main/java/tv/livehub/app/model/EpgProgram.kt        节目单数据模型 + 示例数据
app/src/main/assets/covers/<channelId>.png                   频道静态占位图（可选，可后补）
```

### 修改
```
app/src/main/java/tv/livehub/app/MainActivity.kt
  - TvLiveScreen 的 page 增加 "epg"
  - home 分支改渲染 SamaHomeScreen（保留旧 HomeScreen 作为 debug 入口或删除，待定）
  - WaitingOverlay 的等待态静态图化；三态与首帧控制保持不变
  - EPG 页的按键分发接入 LiveRemoteController
docs/ARCHITECTURE.md   补三样增量的说明，标明换台能力来自基线
docs/TEST_PLAN.md      补首页/EPG/静态图等待层验收项
CHANGELOG.md           新增 0.3.0-alpha.13 条目
README.md              更新首页与节目单说明
```

### 不改动
```
app/src/main/java/tv/livehub/app/player/PlaybackSurface.kt（LivePlaybackSurface）
app/src/main/java/tv/livehub/app/model/Channel.kt
app/src/main/java/tv/livehub/app/data/*
docs/PLAYBACK_DESIGN.md / docs/REMOTE_CONTROL.md / docs/PRD.md（保持基线）
```

---

## 5. 分阶段实施

| 阶段 | 内容 | 验收点 |
|---|---|---|
| S1 | 静态图等待层（改动最小、见效最快） | 换台时显示频道台标静态图；首帧后消失；三态逻辑不变 |
| S2 | Sama 风格首页 | 四卡片 + 按钮行 + 继续观看；D-pad 导航正常；能进入直播/EPG |
| S3 | EPG 节目单 | 网格显示、当前高亮、OK 播放、返回正确 |
| S4 | 文档与 PR | CHANGELOG/ARCHITECTURE/TEST_PLAN 更新；构建通过；提 PR |

S1/S2/S3 可独立提交，任何阶段可回滚。

---

## 6. 验收清单（在基线验收基础上追加）

- 换台：旧频道声音立即停止，静态图占位，新频道首帧后才出画面与声音（基线已具备，回归验证）
- 静态图：无 covers 素材时回退文字台标不崩；首帧/错误/无内容三态切换正常
- 首页：四卡片焦点高对比；←→↑↓ 遍历无死角；OK 进入直播/EPG；返回回首页
- EPG：当前时段高亮；OK 能播放对应频道；示例数据不误当真实节目
- 合规：新增素材仅为台标/占位图；EPG 示例数据标明"示例"，不伪装真实节目单
- 实机：S905X5M / Android 14 验证；CI 构建通过不等于实机播放通过

---

## 7. 待确认事项

1. 旧 `HomeScreen`（省级标签网格）是删除，还是保留为调试入口？（建议：删除，Sama 首页取而代之）
2. Sama 首页四卡片的第三、四项：收藏/设置是否也需要真实功能，还是本期只做占位跳转？
3. 静态图素材：用户提供真实台标图，还是先用文字台标 + 纯色底的程序化占位？
4. EPG 是否需要显示真实节目，还是本期仅示例数据（用户第 2/4/6 张参考图风格）？
