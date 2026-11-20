# -*- coding: utf-8 -*-
"""续接：从半应用状态完成 Sama 首页补丁剩余两步（scheme 拦截 + dispatch 转发）。幂等。"""
import io, sys

MAIN = "apktool_fixed/smali/com/live/tv/MainActivity.smali"
WC = "apktool_fixed/smali/com/live/tv/MainActivity$2.smali"

def apply_once(path, old, new, marker, label):
    s = io.open(path, encoding="utf-8").read()
    if marker in s:
        print("SKIP [%s] already applied" % label); return
    cnt = s.count(old)
    if cnt != 1:
        print("FAIL [%s] anchor=%d" % (label, cnt)); sys.exit(1)
    s = s.replace(old, new, 1)
    io.open(path, "w", encoding="utf-8").write(s)
    print("OK   [%s]" % label)

# ---------- scheme 拦截（.locals 已是4）----------
old_url = """    const/4 v0, 0x1

    if-eqz p2, :cond_0

    .line 340
    const-string v1, "http"

    invoke-virtual {p2, v1}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z

    move-result v1

    if-eqz v1, :cond_0

    .line 341
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

    # 解析 N = substring(14) 后 parseInt，容错回退 0
    const/16 v2, 0xe

    invoke-virtual {p2, v2}, Ljava/lang/String;->substring(I)Ljava/lang/String;

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
apply_once(WC, old_url, new_url, "[SAMA-HOME] 拦截", "scheme intercept")

# ---------- dispatchKeyEvent 转发 ----------
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
apply_once(MAIN, old_disp, new_disp, "[SAMA-HOME] 首页态", "dispatch forward")

print("DONE")
