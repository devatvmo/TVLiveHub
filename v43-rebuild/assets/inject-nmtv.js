/*
 * inject-nmtv.js —— 注入【内蒙古广播电视台 nmtv.cn】页面用的整理脚本
 *
 * 与 inject.js（央视频）、inject-btime.js（北京时间）互不干扰，
 * 本文件只服务 nmtv.cn 系的页面。
 *
 * ══════════════════════════════════════════════════════════════
 *  这个站点是三个源里最好做的，几点记牢：
 *
 *  1) 【不需要登录】✓
 *     直接打开 https://www.nmtv.cn/liveTv 就能看，没有任何登录门槛。
 *     所以本脚本里【没有】任何登录相关逻辑（对比 inject-btime.js）。
 *     但仍保留 isProtected() 这个通用钩子，方便将来站点改版。
 *
 *  2) 【播放器是 Video.js】
 *     实测结构（1920x1080）：
 *       VIDEO.vjs-tech (#v_xxxxxx_html5_api)  830x516
 *        └─ DIV.video-js (#v_xxxxxx)          830x516
 *            └─ DIV.video-inner (#vbox_xxxx)  830x516
 *                └─ DIV.video-player          830x516
 *                    └─ DIV.video-box         830x620
 *                        └─ DIV.inner        1160x620
 *                            └─ DIV.live-tv  1920x620
 *                                └─ .content_box → .app_box → #app → body
 *
 *  3) 【换台 = 点 .c-label，零整页刷新】✓
 *     频道项选择器：.tv-list .tv-dete .collapse-box .collapse-item .c-label
 *     每项 330x50，当前选中的带 .active
 *     实测点 6 个台全部成功、页面标记存活、无任何 framenavigated。
 *     这是三个源里【唯一一个不用切分类、不用登录】的，
 *     直接 .click() 即可，比央视频（要切 Tab）省事得多。
 *
 *  4) 【20 个频道】8 个内蒙古本级 + 12 个地市级（详见 ChannelTable）
 *
 *  5) 【API 响应是加密的】
 *     broadcast/list 返回的是 AES 密文，绝不能自己拼 API。
 *     频道列表一律从渲染后的 DOM 里读。
 *
 *  6) 【电视端黑屏铁律】<video> 是独立硬件合成层，遮它只能用原生 View。
 *     本脚本只做三件事：垫黑底、清无关浮层、可选钉全屏。
 *     —— 绝不隐藏播放器的任何祖先，这是黑屏头号原因。
 * ══════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  if (window.__NM_LIVE_INJECTED__) {
    try { window.NMLive.rescan(); } catch (e) {}
    return;
  }
  window.__NM_LIVE_INJECTED__ = true;

  var VW = window.innerWidth || 1920;
  var VH = window.innerHeight || 1080;

  var MODE = 'safe';   // safe | full | off

  var state = {
    enabled: true,
    pinned: false,
    player: null,          // 当前播放器（video 或容器）
    protectChain: [],      // 播放器的祖先链 —— 清理时绕开
    backdrop: null,
    aboveKilled: 0,
    flowKilled: 0,
    hiddenTotal: 0,
    errA: '',
    errF: '',
    program: '',
    title: ''
  };

  /* ───────────────────────── 小工具 ───────────────────────── */

  function rect(el) {
    try {
      var r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, x: r.left, y: r.top,
               top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    } catch (e) {
      return { w: 0, h: 0, x: 0, y: 0, top: 0, bottom: 0, left: 0, right: 0 };
    }
  }

  function areaOf(el) {
    var r = rect(el);
    return r.w * r.h;
  }

  function visible(el) {
    try {
      var s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) {
      return false;
    }
  }

  /* ─────────────── 需要保护的 UI（通用钩子）───────────────
   *
   * nmtv 不需要登录，但下面这些【必须留】，否则用户没法用：
   *   · 频道条 .tv-list（换台入口）
   *   · 播放条 .live-bar（显示"直播中 XXX"）
   *
   * 这里做主判断的是 containsChannelList / containsVideo，
   * 本函数只兜住"将来站点若加了登录/弹窗"的情况。
   */
  function isProtected(el) {
    if (!el) return false;

    var cls = (el.className && typeof el.className === 'string') ? el.className : '';
    // 频道条、播放信息条 —— 换台与信息展示的入口
    if (/tv-list|tv-dete|collapse-box|collapse-item|c-label|live-bar|live-name|video-box|video-player|video-inner|video-js/.test(cls)) {
      return true;
    }
    // 万一将来加了登录/弹窗
    if (/login|layui-layer|dialog|modal|qrcode/i.test(cls)) return true;

    var p = el.parentElement, d = 0;
    while (p && p !== document.body && d < 8) {
      var pc = (p.className && typeof p.className === 'string') ? p.className : '';
      if (/tv-list|live-bar|login|layui-layer/i.test(pc)) return true;
      p = p.parentElement; d++;
    }
    return false;
  }

  /* ─────────────── 找播放器 ───────────────
   *
   * 优先返回真正的 <video>（它才是不动产，容器 class 会变）。
   * nmtv 用 Video.js，video 带 .vjs-tech，外面包着 .video-js。
   * 找不到 video 时退回到 .video-box / .video-player 这类容器。
   */
  function findPlayer() {
    // 1) 首选：真正的 video 元素
    var v = document.querySelector('video.vjs-tech') || document.querySelector('video');
    if (v && areaOf(v) > 0) return v;

    // 2) Video.js 容器
    var vj = document.querySelector('.video-box .video-js') ||
             document.querySelector('.video-player .video-js');
    if (vj && areaOf(vj) > 0) return vj;

    // 3) 播放器外框
    var vb = document.querySelector('.video-box .video-player') ||
             document.querySelector('.video-player');
    if (vb && areaOf(vb) > 0) return vb;

    // 4) 再兜底
    var bx = document.querySelector('.video-box');
    if (bx && areaOf(bx) > 0) return bx;

    return null;
  }

  /* ─────────── 垫黑底：让播放器外的区域是黑的 ───────────
   *
   * ⚠ 绝不能把 body 背景设成会盖住 video 的实心元素 ——
   *   电视端 video 是独立合成层，网页里垫不透明全屏元素会把视频层盖掉
   *   （表现就是黑屏有声音）。
   *   这里只改 body/html 的 background-color，不插入任何覆盖元素，
   *   是安全的；真正的遮挡由 Java 侧的四条原生 View 负责。
   */
  function ensureBackdrop() {
    if (MODE === 'off') return;
    try {
      if (!document.documentElement) return;
      document.documentElement.style.setProperty('background', '#000', 'important');
      // 滚动条藏掉（页面本来就不该滚）
      document.documentElement.style.setProperty('overflow', 'hidden', 'important');
      if (document.body) {
        document.body.style.setProperty('background', '#000', 'important');
        document.body.style.setProperty('overflow', 'hidden', 'important');
      }
      state.backdrop = document.documentElement;
    } catch (e) {}
  }

  /* ─────────── 钉全屏（把播放器铺满整屏）───────────
   *
   * ⚠ 这是最容易把视频层搞坏的操作，逻辑必须保守：
   *   ① 只改 position / 尺寸 / z-index，绝不动 display
   *   ② 记录祖先链，后续清理绕开
   *   ③ pin 之后把【宿主 → video 之间的每一层】都撑满
   *      （中间任何一层卡着原始尺寸，视频就铺不开）
   *
   * ⚠⚠ 4K 下踩过的坑（必须记住）：
   *   nmtv 的 .inner 是 display:flex，里面并排两个子项：
   *       .video-box (830px) 和 .tv-list (330px)
   *   光把 .video-box 改 position:fixed 是不够的 ——
   *   它虽然脱离文档流，但 flex 容器仍按残留尺寸分配空间，
   *   实测 video 会变成 3516px 宽、x = -1330px（被挤歪）。
   *   所以 pin 之后必须把【不在播放器链上的兄弟节点】也摘出布局
   *   （用 position:fixed 甩到屏幕外，而不是 display:none ——
   *     频道条要留着，将来可能还要用；且 display:none 有风险）。
   */
  function floatPlayer(p) {
    if (MODE === 'off') return;
    if (!p) return;
    try {
      var tag = (p.tagName || '').toUpperCase();
      /* 先记录 video（或播放器容器）的完整祖先链 —— 清理时要用 */
      state.protectChain = [];
      (function () {
        var n = p.parentElement, guard = 0;
        while (n && n !== document.body && guard < 20) {
          state.protectChain.push(n);
          n = n.parentElement; guard++;
        }
      })();

      /* ── 选 pin 目标：能铺满屏幕的【最上层】祖先 ──
       *
       * 从 video 往上走，一路记录"能容纳整屏"的祖先，
       * 取【最后一个】满足条件的 —— 也就是"再上一层就太小/不该动"的那层。
       *
       * 为什么不用"第一个够大的"（旧逻辑）：
       *   nmtv 里第一个够大的是 .video-js（830x516），再往上 .video-box
       *   （830x620）、.inner（1160x620，display:flex）、.live-tv（1920x620）。
       *   pin 到 .video-box 这种中间层，会被 .inner 的 flex 布局挤歪
       *   （4K 实测 video 变 3516px 宽、x=-1330px）。
       *   pin 到 .live-tv 就没这问题：它是"播放器区"的顶层容器，
       *   宽=整屏宽、position:relative，把它钉住最自然。
       *
       * 上限：不要越过 .content_box / .app_box（那是整页容器，
       * 钉它会把频道条等一切拽进来）。
       */
      var best = null;
      var q = (tag === 'VIDEO') ? p.parentElement : p;
      var d = 0;
      while (q && q !== document.body && d < 12) {
        var cls = (q.className && typeof q.className === 'string') ? q.className : '';
        // 到了页面级容器就停手，不要再往上
        if (/content_box|app_box/.test(cls) || q.id === 'app') break;
        var r = rect(q);
        /* 判据：宽度接近整屏即可 —— 不要求高度也接近整屏。
         * 因为"播放器区"本来就是一条横带（nmtv 里 .live-tv 宽 3840、
         * 高只有 620），要求 h >= VH*0.3 在 4K 下会把它筛掉，
         * 结果 pin 到更内层的 .video-box，频道条就甩不走了。 */
        var wide = r.w >= VW * 0.9;
        var tall = r.h >= VH * 0.3;
        if (wide && tall) {
          best = q;             // 完整覆盖屏幕 → 最佳
        } else if (wide && !best) {
          best = q;             // 没更好的就先用这条横带
        }
        q = q.parentElement; d++;
      }
      if (!best) best = (tag === 'VIDEO') ? (p.parentElement || p) : p;

      pin(best);
      var vid = p.querySelector ? p.querySelector('video') : null;
      if (tag === 'VIDEO') vid = p;
      if (vid) {
        stretchInner(best, vid);
        try { vid.style.setProperty('object-fit', 'contain', 'important'); } catch (e) {}
      }
      detachSiblings(best, vid || p);
      state.pinned = true;
    } catch (e) { state.errF = String(e); }
  }

  /* ─── 把"不在播放器链上的兄弟节点"从布局里摘出去 ───
   *
   * 为什么需要：nmtv 的 .inner 是 display:flex，里面并排
   *       .video-box (830px) 和 .tv-list (330px)
   * 只把 .video-box 撑满，flex 仍会按 .tv-list 的宽度分配空间，
   * 视频就被挤歪（4K 实测 video 宽 3516px、x=-1330px）。
   *
   * 做法：从 pin 目标往下，沿"到 video 的那条路径"，
   * 把每一层里"不在这条路径上"的兄弟节点用 position:fixed
   * 甩到屏幕外 —— 保留在 DOM 里、display 不变。
   *
   * ⚠ 不用 display:none 是有意的：电视端 video 是独立合成层，
   *   display:none 有连带丢弃视频层的风险；fixed 甩屏外是安全的。
   */
  function detachSiblings(host, target) {
    if (!host || !target) return;
    var n = host, guard = 0;
    while (n && n !== target && guard < 16) {
      try {
        var kids = n.children || [];
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          if (!k || k.nodeType !== 1) continue;
          if (k === target) continue;
          if (k.tagName === 'SCRIPT' || k.tagName === 'STYLE' || k.tagName === 'LINK') continue;
          // 这个兄弟是不是通往 video 的必经之路？
          if (k.contains && k.contains(target)) continue;
          var onChain = false, c = target, g2 = 0;
          while (c && g2 < 16) { if (c === k) { onChain = true; break; } c = c.parentElement; g2++; }
          if (onChain) continue;
          // 无关兄弟 → 摘出布局（甩到屏幕外，不改 display）
          try {
            k.style.setProperty('position', 'fixed', 'important');
            k.style.setProperty('left', '-99999px', 'important');
            k.style.setProperty('top', '0', 'important');
            k.style.setProperty('width', 'auto', 'important');
            k.setAttribute('data-nmoff', '1');
          } catch (e) {}
        }
      } catch (e) {}
      // 沿路径往下走一层
      var next = null;
      for (var j = 0; j < (n.children || []).length; j++) {
        var ch = n.children[j];
        if (ch && ch.nodeType === 1 && ch.contains && ch.contains(target)) { next = ch; break; }
      }
      n = next; guard++;
    }
  }

  /* 从宿主往下走到 target（video）之间，把每一层都撑满 */
  function stretchDown(host, target) {
    var n = target, guard = 0;
    while (n && n !== host && n !== document.body && guard < 12) {
      forceFill(n);
      n = n.parentElement; guard++;
    }
    forceFill(target);
    try {
      if (target && target.tagName === 'VIDEO') {
        target.style.setProperty('object-fit', 'contain', 'important');
      }
    } catch (e) {}
  }

  /* 在宿主内部，把 target 及其中间层（直到宿主）都撑满 */
  function stretchInner(host, target) {
    var n = target, guard = 0;
    while (n && n !== host && guard < 12) {
      forceFill(n);
      n = n.parentElement; guard++;
    }
    forceFill(target);
  }

  /* 只改尺寸相关，不动 position / display */
  function forceFill(el) {
    if (!el || !el.style) return;
    try {
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('height', '100%', 'important');
      el.style.setProperty('max-width', 'none', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      el.style.setProperty('min-width', '0', 'important');
      el.style.setProperty('min-height', '0', 'important');
      /* ★ 解除 flex 挤压。
       *   内蒙古的 .inner 是 display:flex，右边有频道条兄弟节点；
       *   子元素 width:100% 只会分到"剩余空间"，视频被挤歪。
       *   让这一层脱离 flex 分配才能真铺满。 */
      el.style.setProperty('flex', '0 0 100%', 'important');
      el.style.setProperty('flex-grow', '1', 'important');
      el.style.setProperty('flex-shrink', '0', 'important');
      el.style.setProperty('flex-basis', '100%', 'important');
      el.style.setProperty('align-self', 'stretch', 'important');
      el.style.setProperty('box-sizing', 'border-box', 'important');
    } catch (e) {}
  }

  /* 把某层钉成铺满整屏的浮层。
   * ⚠ 只 set position/left/top/width/height/z-index，不碰 display ——
   *   display:none 会让电视端直接丢弃视频合成层（黑屏）。 */
  function pin(el) {
    if (!el || !el.style) return;
    try {
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('left', '0', 'important');
      el.style.setProperty('top', '0', 'important');
      el.style.setProperty('right', '0', 'important');
      el.style.setProperty('bottom', '0', 'important');
      el.style.setProperty('width', '100vw', 'important');
      el.style.setProperty('height', '100vh', 'important');
      el.style.setProperty('max-width', 'none', 'important');
      el.style.setProperty('max-height', 'none', 'important');
      el.style.setProperty('margin', '0', 'important');
      el.style.setProperty('padding', '0', 'important');
      /* ★ 顶边一丝不留（见 btime 侧同名注释）：
       *   硬件合成层与普通绘制之间可能差零点几像素，
       *   顶上会裂出一条缝露出页面白底。整体上移 2px 压死。 */
      el.style.setProperty('margin-top', '-2px', 'important');
      el.style.setProperty('border-top-width', '0', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
      el.style.setProperty('z-index', '2147483000', 'important');
      el.style.setProperty('background', '#000', 'important');
    } catch (e) {}
  }

  /* ─────────── 清理：播放器上面的浮层 ─────────── */

  function cleanAbove(player) {
    if (MODE === 'off' || !player) return;
    if (!document.body) return;
    var pr = rect(player);
    var tops = document.body.children || [];
    for (var i = 0; i < tops.length; i++) {
      var el = tops[i];
      if (!el || el.nodeType !== 1) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
      if (el === state.backdrop) continue;
      if (el.contains(player)) continue;
      if (isProtected(el)) continue;
      if (containsVideo(el)) continue;
      if (containsChannelList(el)) continue;

      var s;
      try { s = getComputedStyle(el); } catch (e) { continue; }
      if (!s || s.display === 'none') continue;
      if (s.position !== 'fixed' && s.position !== 'absolute') continue;

      var r = rect(el);
      if (r.area === 0 || (r.w === 0 && r.h === 0)) continue;

      // 只清"压在播放器上面"的大块浮层
      var overlapX = Math.min(r.right, pr.right) - Math.max(r.left, pr.left);
      var overlapY = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top);
      if (overlapX <= 0 || overlapY <= 0) continue;

      var covers = (overlapX * overlapY) > (pr.w * pr.h) * 0.35;
      var big = r.w > VW * 0.5 && r.h > VH * 0.4;
      if (covers && big) {
        try {
          el.__nmkilled = 1;
          el.setAttribute('data-nmk', '1');
          el.style.setProperty('display', 'none', 'important');
          state.aboveKilled++;
        } catch (e) {}
      }
    }
  }

  /* ─────────── 清理：文档流里与播放无关的大块 ───────────
   *
   * nmtv 需要清掉的（实测 .content_box 的直接子节点）：
   *   .nav-link          1180x52    顶部导航 → 清
   *   .live-tv           1920x620   ★含播放器与频道条 → 只下钻
   *   .recommend-column  1180x400   推荐位 → 清
   *
   * 清理原则（与 btime 版一致，踩过坑的）：
   *   · 含播放器的节点【不能整块清，但要继续往下钻】
   *   · 播放器的祖先链一律不动
   *   · 频道条、播放信息条一律保留
   */
  function hideFlowContent(player) {
    if (MODE === 'off' || !player) return;

    var already = 0;
    try {
      var marked = document.querySelectorAll('[data-nmk]');
      for (var q = 0; q < marked.length; q++) already++;
    } catch (e) {}
    state.flowKilled = already;

    function mark(el) {
      if (!el) return;
      if (el.__nmkilled) return;
      try {
        el.__nmkilled = 1;
        el.setAttribute('data-nmk', '1');
        el.style.setProperty('display', 'none', 'important');
        state.flowKilled++;
      } catch (e) {}
    }

    function killable(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el === player) return false;
      if (el === state.backdrop) return false;
      if (el.__nmkilled) return false;
      if (isProtected(el)) return false;               // 频道条/播放条/登录层必须留
      if (isInProtectChain(el)) return false;          // ★ 播放器的祖先，绝不碰
      if (containsVideo(el)) return false;             // 播放器在里面 → 不能整块清
      if (containsChannelList(el)) return false;       // 换台入口必须留
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { return false; }
      if (!cs || cs.display === 'none') return false;
      if (cs.visibility === 'hidden') return false;
      return true;
    }

    function bigEnough(el) {
      var r = rect(el);
      if (r.w * r.h <= 0) return false;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { return r.w > VW * 0.5; }
      var floating = (cs.position === 'fixed' || cs.position === 'absolute');
      if (floating) {
        if (r.w > VW * 0.5 && r.h > 24) return true;    // 悬浮横条
        if (r.w > 40 && r.h > 40) return true;          // 悬浮按钮 / 浮窗
        return false;
      }
      // 文档流：横贯整屏的条，或够大的块
      if (r.w > VW * 0.7) return true;
      return (r.w > VW * 0.3 && r.h > VH * 0.08);
    }

    function sweep(el, depth) {
      if (!el || depth > 8) return;
      var kids = el.children || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (!k || k.nodeType !== 1) continue;
        if (k.tagName === 'SCRIPT' || k.tagName === 'STYLE' || k.tagName === 'LINK') continue;

        /* ★ 宽判断：只要它可能装着播放器/频道条，就只下钻、不整块清 */
        var mayHold = (k.contains && player && k.contains(player)) ||
                      (k.querySelector && k.querySelector('video')) ||
                      (k.querySelector && k.querySelector('.video-box, .video-player, .tv-list')) ||
                      isInProtectChain(k) || isProtected(k) || containsChannelList(k);
        if (!mayHold) {
          if (killable(k) && bigEnough(k)) mark(k);
          continue;
        }
        sweep(k, depth + 1);
      }
    }

    if (!document.body) return;
    var tops = document.body.children || [];
    for (var i = 0; i < tops.length; i++) {
      var el = tops[i];
      if (!el || el.nodeType !== 1) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
      var mayHold = (el.contains && player && el.contains(player)) ||
                    (el.querySelector && el.querySelector('video')) ||
                    (el.querySelector && el.querySelector('.video-box, .video-player, .tv-list')) ||
                    isInProtectChain(el) || isProtected(el) || containsChannelList(el);
      if (!mayHold) {
        if (killable(el) && bigEnough(el)) mark(el);
      } else {
        sweep(el, 0);
      }
    }

    state.hiddenTotal = state.aboveKilled + state.flowKilled;
  }

  /* 播放器祖先链判断 —— 清理时一律绕开 */
  function isInProtectChain(el) {
    if (!el) return false;
    if (el === state.player) return true;
    var chain = state.protectChain || [];
    for (var i = 0; i < chain.length; i++) {
      if (chain[i] === el) return true;
    }
    var p = state.player;
    if (p && el.contains && el.contains(p)) return true;
    return false;
  }

  function containsVideo(el) {
    try {
      return !!(el.querySelector &&
        el.querySelector('video, .video-box, .video-player, .video-js'));
    } catch (e) { return false; }
  }

  /* 换台入口：频道条（绝不能清） */
  function containsChannelList(el) {
    try {
      if (!el || !el.querySelector) return false;
      if (el.querySelector('.tv-list, .tv-dete, .collapse-box, .c-label')) return true;
      var cls = (el.className && typeof el.className === 'string') ? el.className : '';
      return /tv-list|tv-dete|collapse-box/.test(cls);
    } catch (e) { return false; }
  }

  /* ─────────── 读"正在播" ─────────── */

  function readProgram(player) {
    if (MODE === 'off') return;
    // nmtv 的播放条 .live-bar 里写着"直播中 XXX"
    try {
      var bar = document.querySelector('.live-bar') ||
                document.querySelector('.live-name');
      if (bar) {
        var t = (bar.textContent || '').trim();
        t = t.replace(/^直播中\s*/, '').replace(/\s+/g, ' ');
        if (t && t.length <= 40) {
          state.program = t;
          state.title = t;
          return;
        }
      }
      // 退而求其次：当前选中的频道项
      var act = document.querySelector('.tv-list .c-label.active');
      if (act) {
        var n = (act.textContent || '').trim();
        if (n) { state.program = n; state.title = n; }
      }
    } catch (e) {}
  }

  /* ─────────── 遥控器模拟鼠标指针（登录 / 扫码时用） ───────────
   *
   * 电视遥控器没有触摸，而登录要点按钮、扫码要选中二维码。
   * 这里在页面里画一个虚拟指针，由 Java 侧的方向键驱动移动，
   * 按 OK 就在指针位置派发一次真实点击。
   *
   * 实现要点：
   *   · 用 document.elementFromPoint(x,y) 找指针下的元素
   *   · 派发完整序列 mouseover→mousemove→mousedown→mouseup→click
   *     （很多前端框架只监听 mousedown/pointerdown，光 click 不生效）
   *   · 指针本身 pointer-events:none，绝不吃掉自己的点击
   *   · ★【自动吸附】：每次移动后把指针贴到附近最近的可点元素中心。
   *     遥控器只能一格一格挪，靠像素级对齐去点小按钮太难；
   *     吸附之后按 OK 必然点中，这是电视端可用性的关键。
   */
  var ptr = { x: 0, y: 0, el: null, visible: false, snappedEl: null,
              lastHl: null, lastHlOutline: '' };
  state.pointer = null;

  function ensurePointer() {
    if (ptr.el && ptr.el.parentNode) {
      state.pointer = ptr.el;
      return ptr.el;
    }
    var d = document.createElement('div');
    d.id = '__pt_pointer__';
    d.style.cssText = 'position:fixed;z-index:2147483646;width:26px;height:26px;'
      + 'margin:-13px 0 0 -13px;border-radius:50%;'
      + 'background:rgba(255,60,60,.55);border:2px solid #fff;'
      + 'box-shadow:0 0 10px rgba(0,0,0,.8);pointer-events:none;'
      + 'display:none;transition:left .06s linear,top .06s linear;';
    var host = document.body || document.documentElement;
    if (!host) return null;
    host.appendChild(d);
    ptr.el = d;
    state.pointer = d;      // 让清理逻辑认得它，别把它当浮层清掉
    return d;
  }

  /* ── 可点元素识别（吸附用） ── */
  function ptClickable(el) {
    var n = el, guard = 0;
    while (n && n !== document.body && guard < 6) {
      if (n.nodeType === 1) {
        var tag = (n.tagName || '').toUpperCase();
        var cls = (n.className && typeof n.className === 'string') ? n.className : '';
        if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' ||
            tag === 'IMG' || tag === 'LABEL' ||
            (n.getAttribute && (n.getAttribute('onclick') ||
                                n.getAttribute('role') === 'button')) ||
            /btn|button|link|login|tab|menu|play|item|submit|weixin|wechat|qrcode|qr/i.test(cls)) {
          var rc = rect(n);
          if (rc.w > 8 && rc.h > 8 && rc.w < VW * 0.98 && rc.h < VH * 0.9) {
            var t = '';
            try { t = (n.textContent || '').trim(); } catch (e) {}
            var cs = null;
            try { cs = getComputedStyle(n); } catch (e) {}
            var hasBg = cs && cs.backgroundColor &&
                        !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
            var hasImg = n.querySelector && n.querySelector('img,svg,canvas');
            if (t || hasBg || hasImg || tag === 'IMG') return n;
          }
        }
      }
      n = n.parentElement; guard++;
    }
    return null;
  }

  /** 在指针周围 radius 内找最近的可点元素；找不到返回 null */
  function ptSnapTarget(radius) {
    var best = null, bestD = 1e9;
    for (var dy = -radius; dy <= radius; dy += 12) {
      for (var dx = -radius; dx <= radius; dx += 12) {
        var x = ptr.x + dx, y = ptr.y + dy;
        if (x < 0 || y < 0 || x >= VW || y >= VH) continue;
        var el;
        try { el = document.elementFromPoint(x, y); } catch (e) { continue; }
        if (!el) continue;
        var t = ptClickable(el);
        if (!t) continue;
        var rc = rect(t);
        var cx = rc.left + rc.w / 2, cy = rc.top + rc.h / 2;
        var d2 = (cx - ptr.x) * (cx - ptr.x) + (cy - ptr.y) * (cy - ptr.y);
        d2 += rc.w * rc.h * 0.0004;    // 轻微惩罚大块，优先吸小按钮
        if (d2 < bestD) { bestD = d2; best = { el: t, cx: cx, cy: cy }; }
      }
    }
    return best;
  }

  /** 把指针吸附到附近最近的可点元素；返回是否吸上了 */
  function pointerSnap() {
    try {
      var hit = ptSnapTarget(90);
      if (!hit) return false;
      ptr.x = Math.round(hit.cx);
      ptr.y = Math.round(hit.cy);
      if (ptr.el) {
        ptr.el.style.left = ptr.x + 'px';
        ptr.el.style.top = ptr.y + 'px';
      }
      ptr.snappedEl = hit.el;
      return true;
    } catch (e) { return false; }
  }

  function pointerShow(show) {
    var d = ensurePointer();
    if (!d) return;
    ptr.visible = !!show;
    if (show) {
      if (ptr.x === 0 && ptr.y === 0) { ptr.x = VW / 2; ptr.y = VH / 2; }
      d.style.display = 'block';
      d.style.left = ptr.x + 'px';
      d.style.top = ptr.y + 'px';
      pointerSnap();     // 首次显示就尝试吸一次
    } else {
      d.style.display = 'none';
      if (ptr.lastHl && ptr.lastHl.style) {
        ptr.lastHl.style.outline = ptr.lastHlOutline || '';
        ptr.lastHl = null;
      }
    }
  }

  function pointerHide() {
    ptr.visible = false;
    if (ptr.el) ptr.el.style.display = 'none';
  }

  /** 把指针放到视口中心（弹层刚出现时归位用） */
  function pointerCenter() {
    ptr.x = Math.round(VW / 2); ptr.y = Math.round(VH / 2);
    if (ptr.el) { ptr.el.style.left = ptr.x + 'px'; ptr.el.style.top = ptr.y + 'px'; }
    ptr.snappedEl = null;
    pointerSnap();
    return { ok: true, x: Math.round(ptr.x), y: Math.round(ptr.y) };
  }

  /** 相对移动指针。dx/dy 单位为 CSS px。 */
  function pointerMove(dx, dy) {
    if (!ptr.visible) pointerShow(true);
    ptr.x = Math.max(0, Math.min(VW - 1, ptr.x + dx));
    ptr.y = Math.max(0, Math.min(VH - 1, ptr.y + dy));
    if (ptr.el) {
      ptr.el.style.left = ptr.x + 'px';
      ptr.el.style.top = ptr.y + 'px';
    }

    /* ★ 移动后立即尝试吸附 —— 这是"遥控器能定位到按钮"的关键 */
    ptr.snappedEl = null;
    try { pointerSnap(); } catch (e) {}

    // 高亮指针下的元素（给用户一点反馈）
    try {
      var el = ptr.snappedEl;
      if (!el) el = document.elementFromPoint(ptr.x, ptr.y);
      if (el && el !== ptr.el) {
        if (ptr.lastHl && ptr.lastHl !== el && ptr.lastHl.style) {
          ptr.lastHl.style.outline = ptr.lastHlOutline || '';
        }
        if (ptr.lastHl !== el) {
          ptr.lastHl = el;
          ptr.lastHlOutline = el.style.outline || '';
        }
        if (el.style) el.style.outline = '3px solid #ff3c3c';
      }
    } catch (e) {}
  }

  /** 在指针当前位置派发一次真实点击 */
  function pointerClick() {
    try {
      var x = ptr.x, y = ptr.y;
      if (!x && !y) { x = VW / 2; y = VH / 2; }

      /* ★ 优先点"吸附中的那个元素" —— 比重新 elementFromPoint 更准，
       *   尤其是按钮上盖了透明层的时候。 */
      var target = null;
      if (ptr.snappedEl && ptr.snappedEl.parentNode) target = ptr.snappedEl;
      if (!target) {
        var el = document.elementFromPoint(x, y);
        if (!el) return { ok: false, err: 'no-element' };
        target = ptClickable(el) || el;
      }

      var r = target.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var opts = { bubbles: true, cancelable: true, view: window,
                   clientX: cx, clientY: cy, screenX: cx, screenY: cy,
                   button: 0, buttons: 1 };

      /* 尽量完整地模拟一次真实鼠标交互 ——
       * 很多框架（含 Vue/React 事件代理）只认 pointerdown 或 mousedown。 */
      try { target.dispatchEvent(new MouseEvent('mouseover', opts)); } catch (e) {}
      try { target.dispatchEvent(new MouseEvent('mousemove', opts)); } catch (e) {}
      try { target.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
      try { target.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
      try { target.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) {}
      try { target.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) {}
      try { target.click(); } catch (e) {}

      return { ok: true, tag: target.tagName,
               cls: String(target.className || '').slice(0, 40),
               txt: (target.textContent || '').trim().slice(0, 30) };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  }

  /** 指针相关 API（统一挂到当前源的命名空间上） */
  function bindPointerApi(NS) {
    if (!NS) return;
    NS.pointerShow = function (s) { try { pointerShow(s !== false); return { ok: true }; }
                                    catch (e) { return { err: String(e) }; } };
    NS.pointerHide = function () { try { pointerHide(); return { ok: true }; }
                                   catch (e) { return { err: String(e) }; } };
    NS.pointerMove = function (dx, dy) { try { pointerMove(dx, dy);
                                   return { ok: true, x: Math.round(ptr.x), y: Math.round(ptr.y) }; }
                                   catch (e) { return { err: String(e) }; } };
    NS.pointerClick = function () { return pointerClick(); };
    NS.pointerSnap = function () { try { return { ok: pointerSnap(),
                                   x: Math.round(ptr.x), y: Math.round(ptr.y) }; }
                                   catch (e) { return { err: String(e) }; } };
    NS.pointerCenter = function () { try { return pointerCenter(); }
                                     catch (e) { return { err: String(e) }; } };
    NS.pointerInfo = function () {
      try {
        return { x: Math.round(ptr.x), y: Math.round(ptr.y), visible: !!ptr.visible,
                 snapped: ptr.snappedEl
                   ? (String(ptr.snappedEl.className || '').slice(0, 40) ||
                      (ptr.snappedEl.textContent || '').trim().slice(0, 20))
                   : '',
                 vw: Math.round(VW), vh: Math.round(VH) };
      } catch (e) { return { err: String(e) }; }
    };
  }


  /* ─────────── 主流程 ─────────── */

  function apply() {
    state.errA = '';
    try {
      ensureBackdrop();
      var p = findPlayer();
      if (!p) return { player: false, pinned: state.pinned };

      state.player = p;                 // ★ 供 isInProtectChain 用
      if (MODE !== 'off') floatPlayer(p);
      cleanAbove(p);
      hideFlowContent(p);
      readProgram(p);

      return {
        player: true,
        pinned: state.pinned,
        aboveKilled: state.aboveKilled,
        flowKilled: state.flowKilled,
        hiddenTotal: state.hiddenTotal,
        program: state.program
      };
    } catch (e) {
      state.errA = String(e);
      return { err: state.errA };
    }
  }

  var applyTimer = null;
  function scheduleApply(delay) {
    if (applyTimer) return;
    applyTimer = setTimeout(function () {
      applyTimer = null;
      apply();
    }, delay || 300);
  }

  /* 持续跟随：页面是 SPA，换台后播放器会重建，必须反复纠正 */
  function startAutoFollow() {
    setInterval(function () {
      if (MODE === 'off') return;
      try {
        var p = findPlayer();
        if (!p) return;
        state.player = p;
        var r = rect(p);
        // 播放器没铺满 → 重新钉
        if (r.w < VW * 0.9 || r.h < VH * 0.9) {
          floatPlayer(p);
          cleanAbove(p);
          hideFlowContent(p);
        }
        readProgram(p);
      } catch (e) {}
    }, 1500);
  }

  /* ─────────── 换台 ───────────
   *
   * nmtv 是最省事的：频道项直接 .click() 即可，
   * 【不需要切分类 Tab、不需要登录】，页面自己就地切流。
   *
   * 选择器：.tv-list .tv-dete .collapse-box .collapse-item .c-label
   * 每项 330x50，当前项带 .active。
   */
  function normName(s) {
    return String(s || '').replace(/[\s\-·]/g, '').toLowerCase();
  }

  function channelItems() {
    var nodes = document.querySelectorAll(
      '.tv-list .tv-dete .collapse-box .collapse-item .c-label');
    // 兜底：整个页面找也行（站点改版时还能用）
    if (!nodes || !nodes.length) {
      nodes = document.querySelectorAll('.c-label');
    }
    return nodes;
  }

  function itemName(el) {
    if (!el) return '';
    // .c-label 的文本可能带"当前直播：XXX"的后缀，取自己那一行更准
    var t = (el.textContent || '').trim();
    t = t.replace(/当前直播[:：].*$/, '').trim();
    return t;
  }

  function switchTo(name, cb) {
    __muteForSwitch();
    var want = normName(name);
    if (!want) { if (cb) cb({ ok: false, err: 'no-name' }); return false; }

    var items = channelItems();
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var t = itemName(el);
      if (!t) continue;
      var nt = normName(t);
      if (nt === want || nt === want + '频道' || want === nt + '频道') {
        try {
          el.scrollIntoView({ block: 'center' });
        } catch (e) {}
        try {
          el.click();
          if (cb) cb({ ok: true, via: 'click', name: t });
          return true;
        } catch (e) {
          if (cb) cb({ ok: false, err: String(e) });
          return false;
        }
      }
    }
    if (cb) cb({ ok: false, err: 'not-found', want: name, n: items.length });
    return false;
  }

  /* 带重试的换台：列表可能还没渲染好（换源/冷启动时） */
  function switchToRetry(name, cb) {
    __muteForSwitch();
    var tries = 0, maxTries = 10;
    function attempt() {
      tries++;
      var done = false;
      var items = channelItems();
      var want = normName(name);
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var t = itemName(el);
        if (!t) continue;
        var nt = normName(t);
        if (nt === want || nt === want + '频道' || want === nt + '频道') {
          try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
          try {
            el.click();
            if (cb) cb({ ok: true, via: 'click', tries: tries, name: t });
          } catch (e) {}
          done = true;
          break;
        }
      }
      if (done) return;
      if (tries < maxTries) { setTimeout(attempt, 400); return; }
      if (cb) cb({ ok: false, err: 'timeout', tries: tries, want: name });
    }
    attempt();
  }

  function fire(cb, obj) {
    if (!cb) return;
    try { cb(obj); } catch (e) {}
  }

  /* ─────────── 对外接口 ─────────── */


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

  window.NMLive = {
    rescan: function () { try { return apply(); } catch (e) { return { err: String(e) }; } },

    on: function () { state.enabled = true; return apply(); },

    off: function () {
      state.enabled = false;
      try {
        var marked = document.querySelectorAll('[data-nmk]');
        for (var i = 0; i < marked.length; i++) {
          marked[i].style.removeProperty('display');
          marked[i].removeAttribute('data-nmk');
          marked[i].__nmkilled = 0;
        }
        // 还原被"甩出布局"的兄弟节点（如频道条）
        var offs = document.querySelectorAll('[data-nmoff]');
        for (var j = 0; j < offs.length; j++) {
          offs[j].style.removeProperty('position');
          offs[j].style.removeProperty('left');
          offs[j].style.removeProperty('top');
          offs[j].removeAttribute('data-nmoff');
        }
      } catch (e) {}
      state.flowKilled = 0;
      state.aboveKilled = 0;
      return true;
    },

    setMode: function (m) {
      MODE = (m === 'full' || m === 'off' || m === 'safe') ? m : 'safe';
      return apply();
    },

    info: function () {
      return {
        player: !!state.player,
        pinned: state.pinned,
        aboveKilled: state.aboveKilled,
        flowKilled: state.flowKilled,
        hiddenTotal: state.hiddenTotal,
        program: state.program,
        title: state.title,
        errA: state.errA,
        errF: state.errF
      };
    },

    switchTo: function (name, cb) { return switchTo(name, cb); },
    switchToRetry: function (name, cb) { return switchToRetry(name, cb); },

    /** 当前频道名（给 Java 侧读，稳定频道列表） */
    current: function () {
      try {
        var act = document.querySelector('.tv-list .c-label.active');
        if (act) return itemName(act);
        var bar = document.querySelector('.live-bar');
        if (bar) return (bar.textContent || '').replace(/^直播中\s*/, '').trim();
      } catch (e) {}
      return '';
    },

    /** 频道清单（诊断用） */
    list: function () {
      var items = channelItems(), out = [];
      for (var i = 0; i < items.length; i++) {
        out.push({ i: i, name: itemName(items[i]),
                   active: /active/.test(items[i].className || '') });
      }
      return out;
    }
  };

  /* 指针能力统一挂到本命名空间（Java 侧按当前源的命名空间调用） */
  if (typeof bindPointerApi === 'function') bindPointerApi(window.NMLive);

  /* ─────────── 启动 ─────────── */

  function boot() {
    apply();
    startAutoFollow();
    // 页面初始化慢，多补几次
    scheduleApply(600);
    scheduleApply(1500);
    scheduleApply(3000);

    /* SPA 路由变化（换台若触发 history 变更）也要重跑 */
    try {
      var push = history.pushState;
      history.pushState = function () {
        var r = push.apply(this, arguments);
        scheduleApply(250);
        return r;
      };
      var rep = history.replaceState;
      history.replaceState = function () {
        var r = rep.apply(this, arguments);
        scheduleApply(250);
        return r;
      };
      window.addEventListener('popstate', function () { scheduleApply(250); });
    } catch (e) {}
  }

  /* document-start 注入时 body 还不存在，等 DOM 就绪 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* video 出现后立刻再跑一次（Video.js 是异步挂上来的） */
  try {
    var mo = new MutationObserver(function () {
      if (!state.player || areaOf(state.player) === 0) scheduleApply(200);
    });
    if (document.documentElement) {
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch (e) {}
})();
