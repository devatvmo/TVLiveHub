# -*- coding: utf-8 -*-
"""给 v4.3 加本地 Sama 首页（启动页）+ scheme 回调，播放链路零改动。
基线与 JS 静音/台标补丁叠加，作用于 apktool_fixed。
"""
import io, sys

BASE = "apktool_fixed/smali/com/live/tv/"
MAIN = BASE + "MainActivity.smali"
R1 = BASE + "MainActivity$1.smali"
WC = BASE + "MainActivity$2.smali"

def patch(path, old, new, label):
    s = io.open(path, encoding="utf-8").read()
    cnt = s.count(old)
    if cnt != 1:
        print("FAIL [%s] anchor count=%d" % (label, cnt)); sys.exit(1)
    s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8").write(s)
    print("OK   [%s]" % label)

# ---------- 1) 新增 homeActive 字段 ----------
patch(MAIN,
""".field private currentIndex:I

.field private designW:I""",
""".field private currentIndex:I

.field private homeActive:Z

.field private designW:I""",
"field homeActive")

# ---------- 2) MainActivity$1.run(): 启动加载首页 ----------
# 原 run: loadChannel(currentIndex)
old_run = """    .line 132
    iget-object v0, p0, Lcom/live/tv/MainActivity$1;->this$0:Lcom/live/tv/MainActivity;

    invoke-static {v0}, Lcom/live/tv/MainActivity;->-$$Nest$fgetcurrentIndex(Lcom/live/tv/MainActivity;)I

    move-result v1

    invoke-static {v0, v1}, Lcom/live/tv/MainActivity;->-$$Nest$mloadChannel(Lcom/live/tv/MainActivity;I)V

    return-void
.end method"""
new_run = """    # [SAMA-HOME] 启动加载本地首页，进入首页态
    iget-object v0, p0, Lcom/live/tv/MainActivity$1;->this$0:Lcom/live/tv/MainActivity;

    const/4 v1, 0x1

    iput-boolean v1, v0, Lcom/live/tv/MainActivity;->homeActive:Z

    invoke-static {v0}, Lcom/live/tv/MainActivity;->-$$Nest$fgetweb(Lcom/live/tv/MainActivity;)Landroid/webkit/WebView;

    move-result-object v0

    const-string v1, "file:///android_asset/sama_home.html"

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    return-void
.end method"""
patch(R1, old_run, new_run, "run() load home")

# ---------- 3) shouldOverrideUrlLoading: 拦截 tvlive://play/N ----------
old_url = """    const/4 v0, 0x1

    if-eqz p2, :cond_0

    const-string v1, "http"

    invoke-virtual {p2, v1}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z

    move-result v1

    if-eqz v1, :cond_0

    invoke-virtual {p1, p2}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    :cond_0
    return v0
.end method"""
new_url = """    const/4 v0, 0x1

    if-eqz p2, :cond_0

    # [SAMA-HOME] 拦截 tvlive://play/N 进入直播
    const-string v1, "tvlive://play/"

    invoke-virtual {p2, v1}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z

    move-result v1

    if-eqz v1, :cond_sama

    const-string v1, "http"

    invoke-virtual {p2, v1}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z

    move-result v1

    if-eqz v1, :cond_0

    invoke-virtual {p1, p2}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    goto :cond_0

    :cond_sama
    iget-object v1, p0, Lcom/live/tv/MainActivity$2;->this$0:Lcom/live/tv/MainActivity;

    const/4 v2, 0x0

    iput-boolean v2, v1, Lcom/live/tv/MainActivity;->homeActive:Z

    # 解析 N: 去掉前缀后 parseInt
    invoke-virtual {p2}, Ljava/lang/String;->length()I

    move-result v2

    const/16 v3, 0xe

    invoke-virtual {p2, v3, v2}, Ljava/lang/String;->substring(II)Ljava/lang/String;

    move-result-object v2

    :try_start_sama
    invoke-static {v2}, Ljava/lang/Integer;->parseInt(Ljava/lang/String;)I

    move-result v2
    :try_end_sama
    .catch Ljava/lang/NumberFormatException; {:try_start_sama .. :try_end_sama} :catch_sama

    goto :goto_sama

    :catch_sama
    const/4 v2, 0x0

    :goto_sama
    invoke-static {v1, v2}, Lcom/live/tv/MainActivity;->-$$Nest$mloadChannel(Lcom/live/tv/MainActivity;I)V

    :cond_0
    return v0
.end method"""
# 需要 .locals >= 3
s_wc = io.open(WC, encoding="utf-8").read()
# 先把 shouldOverrideUrlLoading 的 .locals 2 提到 3（精确定位：该方法签名后第一个 .locals 2）
sig = ".method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Ljava/lang/String;)Z\n    .locals 2"
if s_wc.count(sig) != 1:
    print("FAIL [wc .locals] count=%d" % s_wc.count(sig)); sys.exit(1)
s_wc = s_wc.replace(sig,
    ".method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Ljava/lang/String;)Z\n    .locals 4", 1)
io.open(WC, "w", encoding="utf-8").write(s_wc)
print("OK   [wc .locals 4]")
patch(WC, old_url, new_url, "scheme intercept")

# ---------- 4) dispatchKeyEvent 头部: 首页转发按键 ----------
old_disp = """    .line 2219
    invoke-virtual {p1}, Landroid/view/KeyEvent;->getKeyCode()I

    move-result v0

    const/16 v1, 0x17"""
new_disp = """    # [SAMA-HOME] 首页态：方向键/OK 转发给 JS，返回键忽略
    iget-boolean v6, p0, Lcom/live/tv/MainActivity;->homeActive:Z

    if-eqz v6, :sama_off

    invoke-virtual {p1}, Landroid/view/KeyEvent;->getKeyCode()I

    move-result v6

    const/16 v7, 0x4

    if-eq v6, v7, :sama_check_action

    const/4 v6, 0x1

    return v6

    :sama_check_action
    # 只处理 ACTION_DOWN，忽略 UP/多次，避免焦点跳两格
    invoke-virtual {p1}, Landroid/view/KeyEvent;->getAction()I

    move-result v7

    if-eqz v7, :sama_consume

    invoke-virtual {p1}, Landroid/view/KeyEvent;->getRepeatCount()I

    move-result v7

    if-eqz v7, :sama_consume

    new-instance v7, Ljava/lang/StringBuilder;

    invoke-direct {v7}, Ljava/lang/StringBuilder;-><init>()V

    const-string v8, "window.onTvKey("

    invoke-virtual {v7, v8}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v7

    invoke-virtual {v7, v6}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    move-result-object v7

    const-string v8, ")"

    invoke-virtual {v7, v8}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v7

    invoke-virtual {v7}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v7

    iget-object v8, p0, Lcom/live/tv/MainActivity;->web:Landroid/webkit/WebView;

    const/4 v9, 0x0

    invoke-virtual {v8, v7, v9}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V

    :sama_consume
    const/4 v8, 0x1

    return v8

    :sama_off
    .line 2219
    invoke-virtual {p1}, Landroid/view/KeyEvent;->getKeyCode()I

    move-result v0

    const/16 v1, 0x17"""
patch(MAIN, old_disp, new_disp, "dispatch home forward")

print("ALL DONE")
