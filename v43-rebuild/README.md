# v4.3 重编资产（停声音 + 中间页台标 + Sama 首页）

本目录保存基于用户已验证的 **电视直播-央视频版 v4.3 APK** 重编产出的资产。

## 背景与原则

- v4.3 的播放链路（WebView + 三份 `inject*.js`，央视 / 北京台 / 内蒙古三路直播）已经实机验证可用，是**已验证资产，不重做**。
- 本轮只补三件事：**换台瞬间停掉旧节目声音**、**中间页加频道台标占位图**、**Sama 风格首页**。
- 严格按 v4.3 自身结构实现：停声音写进原生的 `inject*.js` 换台入口，**Java 播放链路零改动**；不使用本仓库 `app/` 下的 Kotlin 代码，也不另起 Java 外挂机制。
- 首页为纯本地 HTML（`file:///android_asset/sama_home.html`），不含 `<video>`，只做入口与焦点导航；点卡片通过 `tvlive://play/N` scheme 回到原 `loadChannel(N)`。

## 目录内容

| 路径 | 说明 |
|---|---|
| `assets/inject.js` | 央视频，注入 `__muteForSwitch()` 于 `switchTo` / `switchToRetry` 开头 |
| `assets/inject-btime.js` | 北京时间（北京台），注入于 `switchTo` 开头 |
| `assets/inject-nmtv.js` | 内蒙古台，注入于 `switchTo` / `switchToRetry` 开头 |
| `assets/sama_home.html` | Sama 风格首页：深色底、四个彩色入口卡片、功能按钮行、继续观看横排；暴露 `window.onTvKey(code)` |
| `tools/patch_js_mute.py` | 给三份 JS 注入静音逻辑的第一版脚本（历史留存） |
| `tools/patch_js_mute_fixed.py` | **推荐**：改用 token 防竞态、首帧判据修正后的静音脚本 |
| `tools/patch_logo.py` / `patch_logo_name.py` | 第一版台标补丁（历史留存，有寄存器冲突，勿用） |
| `tools/patch_logo_fixed.py` | **推荐**：修复版台标补丁，插入 `buildMask()` 末尾，避开在用寄存器 |
| `tools/patch_sama_home.py` / `patch_sama_home2.py` | Sama 首页接入：启动页改本地首页、URL 拦截 `tvlive://play/N`、方向键转发 |
| `releases/电视直播-央视频版-v4.5-Sama首页.apk` | **最新交付版**：JS 静音 + 修复台标 + Sama 首页 |
| `releases/电视直播-央视频版-v4.4-修复版.apk` | 稳定基线：JS 静音 + 修复台标，不含 Sama 首页 |

> 旧的 `v4.4-JS逻辑版.apk` 因台标补丁寄存器冲突存在启动崩溃，`v4.4-停声音+台标.apk` 为 smali 外挂对比版，二者已从仓库移除，请勿再使用。

## 停声音逻辑（JS 内闭环）

`__muteForSwitch()` 在换台入口调用：

1. **静音**：换台瞬间把所有 `<video>` 设 `muted = true`，当场切断旧节目声音；
2. **恢复**：轮询检测新流真实首帧——video 的 `src` / `currentTime` 相对换台快照发生变化，且 `!paused && videoWidth > 0`，才 `muted = false`。判据与 v4.3 Java 侧 `onFrameReady` 的"首帧才呈现"一致；
3. **兜底**：12 秒强制恢复，避免极端情况永久静音；
4. **防竞态**：token 递增，连续换台时旧轮次轮询自动作废。

之所以把静音放在 JS 而不是中间页遮罩里：v4.3 的 `inject.js` 注释已验证——电视端 WebView 的 `<video>` 是独立硬件合成层，网页内垫遮罩会导致"有声音没画面"。台标因此必须放在原生 View 层（`maskLogo`）。

## 首页实现要点

- 首页态由 `MainActivity` 的 `homeActive` 标记控制；启动页 `web.loadUrl("file:///android_asset/sama_home.html")`。
- `shouldOverrideUrlLoading()` 识别 `tvlive://play/N` → 置 `homeActive=false` → 调原 `loadChannel(N)`，播放链路不变。
- `dispatchKeyEvent()` 在首页态把方向键 / OK 以 `action_down` 单次转发给 `window.onTvKey(code)`，避免焦点跳两格。
- 退出机制（首页返回键弹确认框、再次返回退出）在 `feature/exit-confirm-dialog` 分支，尚未合并进本 APK。

## 复现步骤

需要工具：JDK 17、Android SDK build-tools（zipalign / apksigner）、apktool 2.9.3。工具 jar 与签名密钥**不入库**（见下）。

```bash
# 1. 反编译原始 v4.3 到干净源
java -jar apktool.jar d "电视直播-央视频版-v4.3.apk" -o apktool_orig -f
cp -r apktool_orig apktool_fixed

# 2. 注入停声音逻辑到三份 JS
python tools/patch_js_mute_fixed.py

# 3. 注入中间页台标（修复版 smali）
python tools/patch_logo_fixed.py

# 4. 接入 Sama 首页（复制 sama_home.html 到 assets 后执行）
python tools/patch_sama_home.py
python tools/patch_sama_home2.py

# 5. 回编译 + 对齐 + 自签名
java -jar apktool.jar b apktool_fixed -o unsigned.apk
zipalign -f -p 4 unsigned.apk aligned.apk
apksigner sign --ks <你的密钥.jks> --out 输出.apk aligned.apk
```

## 签名与安装注意

- 签名密钥（`*.jks`）**不入库**；`releases/` 里的 APK 用本地生成的密钥签名，非 v4.3 原签名。
- 因此在设备上安装前，通常需要**先卸载原版 v4.3**，否则会因签名不一致安装失败。
- 签名口令见本地构建环境，不在本仓库保存。

## 状态

- 静态校验已过：三份 JS 语法通过、dex 含 `homeActive` / `onTvKey` / `tvlive://play/` / `maskLogo`、APK v1/v2/v3 签名有效、无备份文件误入。
- **未实机验证**：需在电视盒子上确认首页焦点与 OK 进直播、播放页上下键换台、左键频道列表、换台静音断/恢复时机与连按表现。
