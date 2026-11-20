# -*- coding: utf-8 -*-
"""
按 v4.3 逻辑实现"换台即刻停声音"：
把静音/恢复逻辑作为内部函数注入三份 inject*.js，
并在每个换台入口（switchTo / switchToRetry）函数体开头调用。

设计（贴合 v4.3 自身结构）：
  - v4.3 的播放与换台全在注入脚本里（switchTo -> clickByName 让网页切流）；
    所以停声音也放这里，作为换台动作的一部分，不碰 Java 播放链路。
  - 静音：换台瞬间把当前所有 <video> muted=true（保留正在缓冲的新 video 也静音）。
  - 恢复：轮询检测"新流真实首帧"——video 的 src/currentTime 相对换台快照发生变化
    且 !paused、videoWidth>0，才 unmute；与 v4.3 Java 侧 onFrameReady 的"首帧才呈现"同一判据。
  - 兜底：12s 强制恢复，避免极端情况永久静音。
  - token 机制：连续换台时旧轮次的轮询自动作废，防止竞态。
"""
import io, os, sys

BASE = r"C:/Users/DMJ-Office/WorkBuddy/2026-11-19-12-46-55/apktool_fixed/assets"
BAKDIR = r"C:/Users/DMJ-Office/WorkBuddy/2026-11-19-12-46-55/tools/js_bak_fixed"
os.makedirs(BAKDIR, exist_ok=True)

# 静音模块：插入到 window 导出对象之前的 IIFE 内部作用域
MODULE = r"""
  /* ===== [v4.4] 换台即刻停声音（按 v4.3 注入脚本逻辑） ===== */
  var __swAudio = { seq: 0, timer: null };
  function __unmuteAll() {
    try {
      var vs = document.querySelectorAll('video');
      for (var i = 0; i < vs.length; i++) { try { vs[i].muted = false; } catch (e) {} }
    } catch (e) {}
  }
  function __muteForSwitch() {
    try {
      var tok = ++__swAudio.seq;
      if (__swAudio.timer) { try { clearInterval(__swAudio.timer); } catch (e) {} }
      // 立即静音当前所有 video（旧节目声音当场切断）
      var vs = document.querySelectorAll('video');
      var snap = [];
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        try { v.muted = true; } catch (e) {}
        var st = '';
        try { st = v.currentSrc || v.src || ''; } catch (e) {}
        var ct = -1;
        try { ct = v.currentTime; } catch (e) {}
        snap.push({ el: v, src: st, t: ct });
      }
      var started = Date.now();
      // 轮询：检测新流真实首帧（src 变化 或 currentTime 相对快照回退/重来，且正在播放）
      __swAudio.timer = setInterval(function () {
        try {
          if (tok !== __swAudio.seq) { clearInterval(__swAudio.timer); return; }  // 被新一轮换台接管
          var all = document.querySelectorAll('video');
          var fresh = false;
          for (var a = 0; a < all.length; a++) {
            var nv = all[a];
            var playing = false, vw = 0, nsrc = '', nct = -1;
            try { playing = !nv.paused && nv.currentTime > 0; } catch (e) {}
            try { vw = nv.videoWidth || 0; } catch (e) {}
            try { nsrc = nv.currentSrc || nv.src || ''; } catch (e) {}
            try { nct = nv.currentTime; } catch (e) {}
            if (!playing || vw <= 0) continue;
            var known = false;
            for (var b = 0; b < snap.length; b++) {
              if (snap[b].el === nv) {
                known = true;
                // src 变了，或时间轴从快照位置回退（说明换了新流重新播放）
                if ((snap[b].src && nsrc && nsrc !== snap[b].src) ||
                    (snap[b].t >= 0 && nct >= 0 && nct < snap[b].t - 0.5)) { fresh = true; }
                break;
              }
            }
            if (!known) { fresh = true; }   // 全新的 video 元素
            if (fresh) break;
          }
          if (fresh || Date.now() - started > 12000) {
            __unmuteAll();
            clearInterval(__swAudio.timer);
            __swAudio.timer = null;
          }
        } catch (e) {
          __unmuteAll();
          try { clearInterval(__swAudio.timer); } catch (e2) {}
          __swAudio.timer = null;
        }
      }, 150);
    } catch (e) {}
  }
  function __apiUnmute() { __unmuteAll(); }
  /* ===== /[v4.4] 换台即刻停声音 ===== */

"""

# 三份文件各自的：模块插入锚点（window 定义前）、换台函数体开头锚点
CFG = [
    {
        "file": "inject.js",
        "api": "window.TVLive = {",
        # 内部 switchTo 函数体首行
        "hooks": [
            ("  function switchTo(stationId, name, displayName) {\n",
             "  function switchTo(stationId, name, displayName) {\n    __muteForSwitch();\n"),
            # 导出的 switchToRetry 是对象方法，也会走换台；在其实体开头插
            ("    switchToRetry: function (sid, name, displayName, done) {\n      var tries = 0, maxTries = 10;\n",
             "    switchToRetry: function (sid, name, displayName, done) {\n      __muteForSwitch();\n      var tries = 0, maxTries = 10;\n"),
        ],
    },
    {
        "file": "inject-btime.js",
        "api": "window.BTLive = {",
        "hooks": [
            ("  function switchTo(name, cb) {\n    var want = normName(name);\n",
             "  function switchTo(name, cb) {\n    __muteForSwitch();\n    var want = normName(name);\n"),
        ],
    },
    {
        "file": "inject-nmtv.js",
        "api": "window.NMLive = {",
        "hooks": [
            ("  function switchTo(name, cb) {\n    var want = normName(name);\n",
             "  function switchTo(name, cb) {\n    __muteForSwitch();\n    var want = normName(name);\n"),
            ("  function switchToRetry(name, cb) {\n    var tries = 0, maxTries = 10;\n",
             "  function switchToRetry(name, cb) {\n    __muteForSwitch();\n    var tries = 0, maxTries = 10;\n"),
        ],
    },
]

MARK = "[v4.4] 换台即刻停声音"

for c in CFG:
    path = os.path.join(BASE, c["file"])
    src = io.open(path, "r", encoding="utf-8").read()
    bak = os.path.join(BAKDIR, c["file"] + ".orig")
    if not os.path.exists(bak):
        io.open(bak, "w", encoding="utf-8").write(src)   # 永久保留原件

    if MARK in src:
        print("SKIP(already patched):", c["file"])
        continue

    # 1) 插入静音模块（window 导出定义所在行的行首之前）
    api = c["api"]
    idx = src.find(api)
    if idx < 0:
        print("ERROR: api anchor not found in", c["file"]); sys.exit(1)
    line_start = src.rfind("\n", 0, idx) + 1
    src = src[:line_start] + MODULE + src[line_start:]

    # 2) 在各换台函数体开头插入调用
    for old, new in c["hooks"]:
        if old not in src:
            print("ERROR: hook anchor not found in", c["file"], "->", repr(old[:50])); sys.exit(1)
        src = src.replace(old, new, 1)

    io.open(path, "w", encoding="utf-8").write(src)
    print("OK patched:", c["file"], "| hooks:", len(c["hooks"]))

print("done")
