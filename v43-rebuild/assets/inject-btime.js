/*
 * inject-btime.js —— 注入【北京时间 btime.com】页面用的整理脚本
 *
 * 与 inject.js（央视频）互不干扰：本文件只服务 btime.com 系的页面。
 *
 * ══════════════════════════════════════════════════════════════
 *  这个站点和央视频完全不同，几点必须记牢：
 *
 *  1) 【直播需要登录】
 *     实测点击频道 → 请求 pc.api.btime.com/video/play?id=<gid>&type_id=151&sign=xxx
 *     未登录时该接口返回 {"errno":401,"errmsg":"用户未登录"}，
 *     播放区被 .play_app_login 这层遮罩盖住（"登录后即可观看精彩节目"）。
 *     登录方式里【微信扫码】是电视上唯一好用的（open.weixin.qq.com/connect/qrconnect）。
 *
 *     ⇒ 所以本脚本【绝不清理登录相关浮层】。
 *        （layui-layer bt-login / play_app_login / play_app_box_login 一律放行）
 *
 *  2) 【播放器渲染到 #video-player】
 *     页面自己有个 window.VideoPlay 类，config.renderDomId='video-player'，
 *     并且提供了 playStream(url) 方法（直接把 HLS 地址丢进去播）。
 *     换台 = 点 .header-menu-list 里的 <li>（名字即频道名），页面自己取流。
 *     sign 是页面 JS 现算的、每次不同 —— 绝不能自己拼 API。
 *
 *  3) 【8 个 BRTV 频道】在 .header-menu-list 里，每项 203x52：
 *     北京卫视 / BRTV文艺 / BRTV纪实科教 / BRTV影视 /
 *     BRTV财经 / BRTV i生活 / BRTV新闻 / 卡酷少儿
 *
 *  4) 【电视端黑屏铁律】<video> 是独立硬件合成层，遮它只能用原生 View。
 *     本脚本只做三件事：垫黑底、清无关浮层、可选钉全屏。
 *     —— 绝不隐藏播放器的任何祖先，这是黑屏头号原因。
 * ══════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  if (window.__BT_LIVE_INJECTED__) {
    try { window.BTLive.rescan(); } catch (e) {}
    return;
  }
  window.__BT_LIVE_INJECTED__ = true;

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

  /* ─────────────────── 登录相关：一律放行 ───────────────────
   *
   * btime 是"登录才能看直播"，任何清理逻辑都必须绕开登录 UI，
   * 否则用户连登录的地方都找不到，整个 App 就废了。
   * 这里用【类名 + 文本 + 尺寸】三重判断，只要沾边就保护。
   */
  function isLoginUi(el) {
    if (!el) return false;

    // 1) 类名（页面用的是 layui 弹层 + 自家的 play_app_* 系列）
    var cls = (el.className && typeof el.className === 'string') ? el.className : '';
    if (/layui-layer|bt-login|play_app|login|user-btn|qrcode|qrconnect|weixin|wechat/i.test(cls)) {
      return true;
    }

    // 2) 文本特征（二维码、扫码、手机号、验证码……）
    var txt = '';
    try { txt = (el.textContent || '').slice(0, 200); } catch (e) {}
    if (/扫码|二维码|登录|立即登录|注册|手机号|验证码|用户协议|第三方账号/.test(txt)) {
      return true;
    }

    // 3) 祖先里只要有一层是登录弹层，整棵子树都保护
    var p = el.parentElement, d = 0;
    while (p && p !== document.body && d < 8) {
      var pc = (p.className && typeof p.className === 'string') ? p.className : '';
      if (/layui-layer|bt-login|play_app|login/i.test(pc)) return true;
      p = p.parentElement; d++;
    }
    return false;
  }

  /* ─────────────── 找播放器容器（#liveVideo_box） ───────────────
   *
   * ⚠ 实测（读 btime 自己的 page.js 源码确认）：
   *   btime.com/btv 的直播播放器**不是** #video-player，
   *   而是 【#liveVideo_box / .liveVideo_box】，位于 .module_live 里。
   *   page.js 里写死了：new Player('liveVideo_box', ...)
   *   容器尺寸约 997x561，外面是 .module_live .focus_wrap。
   *
   *   #video-player 是"点播页（item.btime.com）"才用的节点，
   *   在 /btv 直播页上根本不存在 —— 之前找错了，所以永远 pin 不上，
   *   用户看到的就是完整网页（"显示网页不是直播"）。
   *
   * 关键：只在"确实存在 video / liveVideo_box"时才认，
   * 避免误把推荐位当成播放器钉全屏。
   */
  function findPlayer() {
    // 1) 首选：真正的 video 元素
    var v = document.querySelector('video');
    if (v && v.getBoundingClientRect().width > 0) return v;

    // 2) 直播页真容器：.module_live 里的 liveVideo_box
    var lb = document.querySelector('#liveVideo_box');
    if (lb && areaOf(lb) > 0) return lb;

    // 3) 没有 id 时退化到类名（Vue/JS 重渲染可能换节点）
    var lb2 = document.querySelector('.module_live .liveVideo_box') ||
              document.querySelector('.liveVideo_box');
    if (lb2 && areaOf(lb2) > 0) return lb2;

    // 4) 兜底：点播页的 #video-player（保留兼容）
    var vp = document.querySelector('#video-player');
    if (vp && areaOf(vp) > 0) return vp;

    // 5) 再兜底：老版 .video-box
    var vb = document.querySelector('.video-box .video-view') ||
             document.querySelector('.video-box');
    if (vb && areaOf(vb) > 0) return vb;

    return null;
  }

  /* ───────────────────── 垫黑底（不遮视频层） ─────────────────────
   *
   * 注意：这里垫的是【页面内的黑色底层】，位于 body 最底下、z-index 很低。
   * 它不会盖住 video（video 是独立合成层，永远在最上），
   * 只是防止页面本身的白色/灰色背景透出来刺眼。
   * 真正盖住"视频以外网页内容"的活儿交给原生 View（Java 侧）。
   */
  function ensureBackdrop() {
    // ⚠ addInitScript 在 document-start 注入，此时 document.body 还是 null。
    //   直接 appendChild 会抛异常，所以必须判空并退到 documentElement。
    var host = document.body || document.documentElement;
    if (!host) return;                    // 连根都没有（极早期），下次再垫

    /* ★ 顺手把页面自身的底色改成黑的。
     *   顶上那条白边本质上是「页面的白底从缝里透出来」。
     *   把 html / body 的底色刷黑，就算真裂了一条缝，
     *   露出来的也是黑的，不会刺眼。
     *   注意只改 background，绝不动 position/display ——
     *   那是视频合成层的通路。 */
    try {
      if (document.documentElement && document.documentElement.style) {
        document.documentElement.style.setProperty('background', '#000', 'important');
      }
      if (document.body && document.body.style) {
        document.body.style.setProperty('background', '#000', 'important');
      }
    } catch (e) {}

    if (state.backdrop && state.backdrop.parentNode) return;

    var b = document.createElement('div');
    b.id = '__bt_backdrop__';
    b.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;'
      + 'background:#000;z-index:-1;pointer-events:none;';
    try { host.appendChild(b); } catch (e) { return; }
    state.backdrop = b;
  }

  /* 把 video 一路到某个祖先之间的【每一层】都撑满，
   * 这样即使某一层有固定宽高，视频也能铺开。
   * 这是"有图像但不全屏"的根治办法：
   * 之前只 pin 了 video 自己（或只 pin 了一层容器），
   * 中间某层还卡着 997x561 的原始尺寸，视频就被限制在里面。 */
  function stretchChain(from, to) {
    var n = from, guard = 0;
    while (n && n !== to && n !== document.body && guard < 12) {
      forceFill(n);
      n = n.parentElement; guard++;
    }
    try {
      if (from && from.tagName === 'VIDEO') {
        from.style.setProperty('object-fit', 'contain', 'important');
      }
    } catch (e) {}
  }

  /* ─────────────────── 把播放器钉成铺满全屏 ───────────────────
   *
   * 与央视频同理：只改播放器【自己那一层】的定位，
   * 绝不碰它的祖先链的 position/display。
   * 祖先链一旦被改（尤其 display:none / visibility），
   * video 合成层会被判定不可见 → 黑屏。
   *
   * ⚠ 实测教训（2.9 / 3.0 的真机表现）：
   *   · 登录后页面会真的渲染出 <video>，findPlayer() 就返回 video 而不是容器
   *   · 2.9：只 pin 了 video 自己 → 有图像，但中间容器还是 997x561 → 不全屏
   *   · 3.0：清理放宽后误动了 video 的祖先 → 视频层被丢弃 → 变回全网页
   *   所以这里做两件事：
   *     ① 从 video 往上找到"最合适的那一层"作为 pin 目标，
   *        并把中间每一层都撑满（stretchChain）
   *     ② 把 video 的完整祖先链记进 state.protectChain，
   *        清理逻辑一律绕开这些节点
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

      if (tag === 'VIDEO') {
        /* ── 选 pin 目标：一定要选【尽可能高】的那层 ──
         *
         * ⚠ 这是一次真机踩坑换来的教训。
         *
         *   原来的逻辑是「从 video 往上，找到第一个已经足够大的祖先就当 host」。
         *   在 btime 登录后的真实结构里：
         *
         *     .module_live .focus_wrap                   1200x561
         *       └ DIV.mid-layer                          997x561
         *           └ #liveVideo_box                     997x561   ← ★ 有 overflow:hidden
         *               └ .inner-player                  997x561
         *                   └ video
         *
         *   「第一个够大」命中的是 .inner-player（997 > 1920*0.5）。
         *   于是只有它被设成 position:fixed;100vw×100vh，
         *   而 #liveVideo_box / .mid-layer **仍然是 997×561 且 overflow:hidden** ——
         *   视频被这两层裁回小窗，屏幕上就是「网页里嵌了个小画面」，
         *   用户看到的现象就是【登录后是网页不是直播画面】。
         *
         *   改法：不管沿途谁大谁小，一路走到 body 的直属子节点，
         *   把【整条祖先链】都撑满 + 最顶层 pin 成 fixed。
         *   这样任何一层都卡不住尺寸，也不会再有祖先做裁剪。
         */
        var vw = VW, vh = VH;
        var top = p.parentElement;          // 一路爬到 body 的直属子节点
        var guard0 = 0;
        while (top && top.parentElement && top.parentElement !== document.body && guard0 < 20) {
          top = top.parentElement; guard0++;
        }
        var host = top || p.parentElement || p;

        /* ① 先把 host → video 之间的【每一层】都撑满并解除裁剪 */
        var n = p, guard1 = 0;
        while (n && n !== document.body && guard1 < 20) {
          forceFill(n);
          /* ★ 解除 overflow 裁剪 —— 这是「视频被裁成小窗」的直接原因 */
          try {
            n.style.setProperty('overflow', 'visible', 'important');
            n.style.setProperty('clip-path', 'none', 'important');
            n.style.setProperty('transform', 'none', 'important');
          } catch (e) {}
          if (n === host) break;
          n = n.parentElement; guard1++;
        }

        /* ② 再把 host 本身钉成铺满全屏 */
        pin(host);
        try {
          host.style.setProperty('overflow', 'visible', 'important');
          host.style.setProperty('clip-path', 'none', 'important');
          host.style.setProperty('transform', 'none', 'important');
        } catch (e) {}

        /* ③ host 的祖先（until body）也要解除裁剪/变换，
         *    否则 fixed 定位会被 transform 祖先「困」在原地 */
        var a = host.parentElement, guard2 = 0;
        while (a && a !== document.body && guard2 < 10) {
          try {
            a.style.setProperty('overflow', 'visible', 'important');
            a.style.setProperty('transform', 'none', 'important');
            a.style.setProperty('clip-path', 'none', 'important');
          } catch (e) {}
          a = a.parentElement; guard2++;
        }

        /* ④ video 自己：铺满 + contain，保证不变形 */
        try {
          p.style.setProperty('width', '100%', 'important');
          p.style.setProperty('height', '100%', 'important');
          p.style.setProperty('max-width', 'none', 'important');
          p.style.setProperty('max-height', 'none', 'important');
          p.style.setProperty('object-fit', 'contain', 'important');
        } catch (e) {}
      } else {
        /* 容器型（#liveVideo_box）：
         * ⚠ 实测关键 —— video 往往不是容器的直接子节点，
         *   中间还夹着一层（如 997x561 的 DIV）。
         *   只 pin 容器是不够的：中间那层还卡着原始尺寸，
         *   视频就铺不开（这正是 2.9"有图像但不全屏"的原因）。
         *   所以这里要把 pin 目标【内部】一直到 video 的所有层都撑满。 */
        pin(p);
        var inner = p.querySelector && p.querySelector('video');
        if (inner) {
          stretchInner(p, inner);
          // video 自身给 contain，避免拉伸变形
          try {
            inner.style.setProperty('object-fit', 'contain', 'important');
          } catch (e) {}
        }
        // 容器内部的直接子级也一并撑开（有的播放器不止一层）
        try {
          var kids = p.children || [];
          for (var ci = 0; ci < kids.length; ci++) {
            if (kids[ci].style && kids[ci].tagName !== 'SCRIPT') {
              kids[ci].style.setProperty('width', '100%', 'important');
              kids[ci].style.setProperty('height', '100%', 'important');
              kids[ci].style.setProperty('max-width', 'none', 'important');
              kids[ci].style.setProperty('max-height', 'none', 'important');
            }
          }
        } catch (e) {}

        /* ★ 容器自身的祖先也可能做裁剪（.mid-layer / .focus_wrap），
         *   一并解除，否则容器铺满了、外层还是把它切掉。
         *   注意只动 overflow/clip/transform，绝不动 display/position ——
         *   祖先的 position 一改，video 合成层可能被判定不可见而黑屏。 */
        var ap = p.parentElement, g3 = 0;
        while (ap && ap !== document.body && g3 < 10) {
          try {
            ap.style.setProperty('overflow', 'visible', 'important');
            ap.style.setProperty('clip-path', 'none', 'important');
            ap.style.setProperty('transform', 'none', 'important');
          } catch (e) {}
          ap = ap.parentElement; g3++;
        }
      }
      state.pinned = true;
    } catch (e) {
      state.errF = String(e);
    }
  }

  /* 从宿主往下走到 target（video）之间，把每一层都撑满。
   * 沿"每层的下一个祖先"回溯，保证不遗漏中间层。 */
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

  /* 在宿主内部，把 target 及其祖先后代（直到宿主）都撑满 */
  function stretchInner(host, target) {
    var n = target, guard = 0;
    while (n && n !== host && guard < 12) {
      forceFill(n);
      n = n.parentElement; guard++;
    }
    forceFill(target);
  }

  /* 只改尺寸相关，不动 position / display —— 保持元素原有的参与方式 */
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
       *   btime 的 .focus_wrap 是 display:flex、右边还有个频道条兄弟节点。
       *   子元素写 width:100% 也只会分到「剩余空间」（实测 1739 而非 1920）。
       *   要真正铺满，必须让这一层脱离 flex 的分配：
       *   flex:0 0 100% + align-self:stretch 强制占满主轴。 */
      el.style.setProperty('flex', '0 0 100%', 'important');
      el.style.setProperty('flex-grow', '1', 'important');
      el.style.setProperty('flex-shrink', '0', 'important');
      el.style.setProperty('flex-basis', '100%', 'important');
      el.style.setProperty('align-self', 'stretch', 'important');
      el.style.setProperty('box-sizing', 'border-box', 'important');
    } catch (e) {}
  }

  function pin(el) {
    if (!el || !el.style) return;
    el.style.setProperty('position', 'fixed', 'important');
    el.style.setProperty('left', '0', 'important');
    el.style.setProperty('top', '0', 'important');
    el.style.setProperty('width', '100vw', 'important');
    el.style.setProperty('height', '100vh', 'important');
    el.style.setProperty('max-width', 'none', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('min-width', '0', 'important');
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('padding', '0', 'important');
    /* ★ 顶边一丝不留。
     *   「登录后上边一条白边」的另一半原因：
     *   Chrome 对 position:fixed 的元素，top:0 时如果祖先带
     *   border / transform / 非 0 的 margin，实际落点会差零点几像素；
     *   再叠上硬件合成层的对齐取整，顶上就裂出一条缝，露出页面白底。
     *   把它整体往上挪 2px（屏幕外，不可见），缝就没了。 */
    el.style.setProperty('margin-top', '-2px', 'important');
    el.style.setProperty('border-top-width', '0', 'important');
    el.style.setProperty('box-shadow', 'none', 'important');
    el.style.setProperty('outline', 'none', 'important');
    el.style.setProperty('z-index', '10', 'important');
  }

  /* ──────────────── 清理浮层（不动文档流里的祖先） ────────────────
   *
   * btime 的干扰浮层主要是：
   *   · 顶部导航 header
   *   · 右侧/下方推荐、热门直播、节目单
   *   · 底部 footer
   *   · 各种 App 下载横幅
   * 但这些都是在【文档流】里的，不是浮层。
   * 这里 cleanAbove 只处理 position:fixed/absolute 且盖在播放区上方的大块。
   */
  function cleanAbove(player) {
    if (MODE === 'off') return;
    state.aboveKilled = 0;
    if (!player) return;
    if (!document.body) return;          // document-start 阶段还没 body

    var pr = rect(player);
    var all = document.body.getElementsByTagName('*');
    var kill = [];

    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el || el === player) continue;
      if (el.contains && el.contains(player)) continue;   // 播放器的祖先，绝不碰

      // 登录 UI 一律放行
      if (isLoginUi(el)) continue;

      var s;
      try { s = getComputedStyle(el); } catch (e) { continue; }
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      if (s.position !== 'fixed' && s.position !== 'absolute') continue;

      var r = rect(el);
      // 只关心"大面积盖住屏幕"的浮层
      if (r.w * r.h < VW * VH * 0.18) continue;

      // 挡住播放区中心区域的才算
      var cx = Math.max(0, Math.min(pr.right, r.right) - Math.max(pr.left, r.left));
      var cy = Math.max(0, Math.min(pr.bottom, r.bottom) - Math.max(pr.top, r.top));
      if (cx * cy < VW * VH * 0.15) continue;

      kill.push(el);
    }

    for (var k = 0; k < kill.length; k++) {
      try {
        kill[k].style.setProperty('display', 'none', 'important');
        state.aboveKilled++;
      } catch (e) {}
    }
    state.hiddenTotal = state.aboveKilled + state.flowKilled;
  }

  /* ─────────────── 清理文档流（只清"整块灌水区"） ───────────────
   *
   * btime /btv 是"频道页 + 播放器"布局。实测的 body 结构：
   *
   *   body
   *   ├─ #j-header-nav (3840x66, fixed)        ← 顶部导航，清
   *   ├─ DIV (3840x66)                          ← 占位，清
   *   ├─ DIV (3840x1986)  ★含播放器            ← 不能整块清！
   *   │   └─ #main.w1200 (1200x1538)
   *   │       └─ .page-main
   *   │           ├─ #artificial_xxx (1200x872) ★含 .module_live/播放器 → 留
   *   │           ├─ #artificial_yyy (1200x418)   推荐位 → 清
   *   │           └─ #artificial_zzz (1200x248)   推荐位 → 清
   *   │   └─ #btvColumn.column_box (3840x448)     栏目区 → 清
   *   ├─ .footer (3840x56)                          ← 页脚，清
   *   └─ #atom-totop (66x140, fixed)                ← 悬浮按钮，清
   *
   * ⚠ 之前的 bug：tryKill 里有一句
   *     if (child.contains(player)) return;
   *   把所有"包含播放器的祖先"一律放行 —— 于是 3840x1986 那块
   *   整个不动，而它占满了整屏，用户看到的就是完整网页。
   *
   *   正确做法：**包含播放器的节点不能整块清，但要继续下钻**，
   *   因为播放器往往只是它内部的一小块
   *   （这里 3840x1986 里只有 1200x872 那一支含播放器）。
   *
   * ⚠ 保护名单：频道条（换台入口）、登录 UI、播放器自身、自己的黑底。
   */
  function hideFlowContent(player) {
    if (MODE === 'off' || !player) return;

    /* ⚠ 不能每次进来都把计数清零：
     *   隐藏过的节点带 __btkilled 标记，第二次遍历会全部跳过，
     *   计数就永远是 0（之前诊断里 flowKilled 一直是 0 就是这个原因）。
     *   这里改成"先扫描真实已隐藏数量"，再继续处理新出现的块。 */
    var already = 0;
    try {
      var marked = document.querySelectorAll('[data-btk]');
      for (var q = 0; q < marked.length; q++) already++;
    } catch (e) {}
    state.flowKilled = already;

    function mark(el) {
      if (!el) return;
      if (el.__btkilled) return;
      try {
        el.__btkilled = 1;
        el.setAttribute('data-btk', '1');
        el.style.setProperty('display', 'none', 'important');
        state.flowKilled++;
      } catch (e) {}
    }

    /* 能不能把这一块整个清掉。 */
    function killable(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el === player) return false;
      if (el === state.backdrop) return false;
      if (el === state.pointer) return false;
      if (el.__btkilled) return false;
      if (isInProtectChain(el)) return false;          // ★ 播放器的祖先，绝不碰
      if (isLoginUi(el)) return false;                 // 登录 UI 必须留
      if (containsChannelList(el)) return false;       // 换台入口必须留
      if (containsVideo(el)) return false;             // 播放器在里面 → 不能整块清
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { return false; }
      if (!cs || cs.display === 'none') return false;
      if (cs.visibility === 'hidden') return false;
      return true;
    }

    /* 大小够不够"值得清"。
     *  · 悬浮层（fixed/absolute）：门槛很低 —— 顶部导航条、页脚、
     *    回到顶部按钮这类都只有几十像素高，但它们盖在最上面很显眼。
     *  · 普通文档流块：高度门槛低（页脚也只有几十像素高，
     *    但它是横贯整屏的一条），但要求"横跨屏幕"。 */
    function bigEnough(el) {
      var r = rect(el);
      if (r.area <= 0) return false;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { return r.w > VW * 0.5; }
      var floating = (cs.position === 'fixed' || cs.position === 'absolute');
      if (floating) {
        if (r.w > VW * 0.5 && r.h > 24) return true;    // 悬浮横条
        if (r.w > 40 && r.h > 40) return true;          // 悬浮按钮 / 浮窗
        return false;
      }
      // 文档流：横贯整屏的条（页脚、占位条）或大块
      if (r.w > VW * 0.7) return true;
      return (r.w > VW * 0.3 && r.h > VH * 0.08);
    }

    /* 从某个容器往下走：能整块清就清，不能清（含播放器）就下钻 */
    function sweep(el, depth) {
      if (!el || depth > 8) return;
      var kids = el.children || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (!k || k.nodeType !== 1) continue;
        if (k === state.backdrop || k === state.pointer) continue;
        if (k.tagName === 'SCRIPT' || k.tagName === 'STYLE' || k.tagName === 'LINK') continue;

        /* ★ 这一支里"可能"有播放器 —— 判断要宽。
         *   除了 contains(player)，还要看有没有 video 元素、
         *   有没有播放器容器（Vue 重渲染时 player 引用可能短暂失效）。 */
        var mayHoldPlayer = (k.contains && player && k.contains(player)) ||
                            (k.querySelector && k.querySelector('video')) ||
                            (k.querySelector && k.querySelector('#liveVideo_box, .liveVideo_box, #video-player')) ||
                            isInProtectChain(k);

        // ① 与播放器无关 —— 够大就直接清掉
        if (!mayHoldPlayer) {
          if (killable(k) && bigEnough(k)) mark(k);
          continue;
        }

        // ② 含播放器 —— 绝不整块清，只继续下钻找它的兄弟块
        sweep(k, depth + 1);
      }
    }

    if (!document.body) return;
    var tops = document.body.children || [];
    for (var i = 0; i < tops.length; i++) {
      var el = tops[i];
      if (!el || el.nodeType !== 1) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;

      // 与 sweep 同样用"宽判断"，避免把装着播放器的顶级块误清
      var mayHoldPlayer = (el.contains && player && el.contains(player)) ||
                          (el.querySelector && el.querySelector('video')) ||
                          (el.querySelector && el.querySelector('#liveVideo_box, .liveVideo_box, #video-player')) ||
                          isInProtectChain(el);

      if (!mayHoldPlayer) {
        // 与播放器无关的顶级块 —— 够大就清
        if (killable(el) && bigEnough(el)) mark(el);
      } else {
        // 含播放器的顶级块 —— 下钻，清掉里面不含播放器的兄弟支
        sweep(el, 0);
      }
    }

    state.hiddenTotal = state.aboveKilled + state.flowKilled;
  }

  /* 这个节点是不是播放器的祖先（含播放器自己）？
   *
   * 清理逻辑对这类节点【一律不动】：它们是 video 合成层的"通路"，
   * 任何一层被隐藏（display:none）或被移出文档流，
   * 视频层就会被浏览器判定不可见而丢弃 —— 表现就是黑屏 / 整页变回网页。
   *
   * state.protectChain 由 floatPlayer() 每次维护，
   * 这里再兜一层：用运行时 contains 判断，防止链快照过期。
   */
  function isInProtectChain(el) {
    if (!el) return false;
    if (el === state.player) return true;
    var chain = state.protectChain || [];
    for (var i = 0; i < chain.length; i++) {
      if (chain[i] === el) return true;
    }
    // 运行时兜底：只要是当前播放器（video 或容器）的祖先就保护
    var p = state.player;
    if (p && el.contains && el.contains(p)) return true;
    return false;
  }

  function containsVideo(el) {
    try {
      return !!(el.querySelector &&
        el.querySelector('video, #liveVideo_box, .liveVideo_box, #video-player, .video-box'));
    } catch (e) { return false; }
  }

  function containsChannelList(el) {
    try {
      if (!el || !el.querySelector) return false;
      // 频道条在 module_live 里 —— 整块都别清（它是换台的入口）
      if (el.querySelector && el.querySelector('.module_live')) return true;
      if (el.classList && el.classList.contains('module_live')) return true;
      // 退化判断：容器里有 8 个左右的短文本 LI，大概率是频道条
      var lis = el.querySelectorAll('li');
      if (lis.length >= 5 && lis.length <= 16) {
        var shortCnt = 0;
        for (var i = 0; i < lis.length; i++) {
          var t = (lis[i].textContent || '').trim();
          if (t && t.length <= 12) shortCnt++;
        }
        if (shortCnt >= 5) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /* ──────────────────── 读取当前节目信息 ──────────────────── */
  function readProgram(player) {
    try {
      // 页面标题往往就是当前频道；节目名在播放器附近的标题里
      var t = document.title || '';
      // 去掉站名后缀
      state.title = t.replace(/_[^_]*$/, '').trim() || t;

      // 尝试找播放器旁边的标题节点
      var cand = document.querySelector('.video-title, .play-title, .video-name, .live-title');
      state.program = cand ? (cand.textContent || '').trim().slice(0, 80) : state.title;
    } catch (e) {
      state.program = '';
    }
  }

  /* ─────────────────── 是否已登录 ───────────────────
   *
   * ⚠ 这个判断必须"宁可认为已登录"。
   *
   *   现象：北京台第一次选台，画面已经正常播了，
   *        却还弹出「北京台需要登录」的提示说明。
   *
   *   原因是老逻辑太粗糙，凭"页面上还有没有登录字样的元素"
   *   来推断未登录。可是：
   *     · .play_app_login 遮罩常常只是【残留 DOM】——
   *       登录之后它未必立刻从文档里消失，甚至被页面复用，
   *       只要它还 visible，老逻辑就一直判"未登录"。
   *     · .header-user 里已登录时也常常带着"退出登录"四个字，
   *       一 /登录|注册/ 就命中，直接误判。
   *     · 页脚、侧栏、推荐位里出现"注册"两个字也会误判。
   *
   *   最硬的证据其实是【画面本身】：btime 未登录时取流是 401，
   *   播放器根本拿不到流、video 不会 playing。
   *   所以第一优先级改成"视频真的在播 → 一定是已登录"，
   *   其次才是那些 DOM 特征，而且特征判据也收紧。
   */
  function loggedIn() {
    try {
      /* ① 最强判据：有 video，而且真的在播 —— 一定是已登录。
       *    未登录时取流 401，video 连 readyState 都上不去。 */
      var v = document.querySelector('video');
      if (v) {
        var hasSrc = !!(v.currentSrc || v.src);
        var progressed = (v.readyState >= 2) || (v.currentTime > 0);
        var playing = progressed && !v.paused && !v.ended;
        if (hasSrc && progressed && (playing || v.readyState >= 3)) return true;
      }

      /* ② 取流接口暴露的登录标志（页面自己知道，最权威） */
      try {
        if (window.BTLiveLoginFlag === true) return true;
      } catch (e) {}

      /* ③ 未登录才有的"提示登录"遮罩。
       *    ⚠ 判据必须收紧：只有这块遮罩【确实盖在播放区中央
       *    且含有登录引导文案】时，才算未登录。
       *    单纯存在一个 .play_app_login 不算 —— 那是残留 DOM。 */
      var cov = document.querySelector('.play_app_login');
      if (cov && visible(cov)) {
        var r = cov.getBoundingClientRect();
        var big = r.width * r.height >= (VW * VH * 0.08);
        var hint = /登录后.{0,6}(观看|即可)|微信扫码|请先登录|扫码登录/.test(
                cov.textContent || '');
        if (big && hint) return false;
      }

      /* ④ 头部用户区。
       *    ⚠ 这里要排除"退出登录"这种已登录才有的字样 ——
       *    之前 /登录|注册/ 一命中就判未登录，会把已登录用户误伤。 */
      var ub = document.querySelector('.header-user');
      if (ub) {
        var txt = (ub.textContent || '').trim();
        if (/退出|注销|我的|个人中心|会员/.test(txt)) return true;   // 已登录的确证
        if (/^[^登]*登录[^出]*$/.test(txt) && /登录\/?注册|立即登录/.test(txt)) {
          return false;
        }
      }

      /* ⑤ 都判断不出来 —— 倾向认为已登录。
       *    宁可漏提示（用户看得见画面，自己知道要不要登），
       *    也不要画面都在播了还弹"请登录"来打扰。 */
      return true;
    } catch (e) {
      return true;      // 异常时同样倾向"已登录"，不弹无关提示
    }
  }

  /* ─────────── 遥控器模拟鼠标指针（登录时用） ───────────
   *
   * 电视遥控器没有触摸，而 btime 的登录要"点立即登录 → 点微信"。
   * 这里在页面里画一个虚拟指针，由 Java 侧的方向键驱动移动，
   * 按 OK 就在指针位置派发一次真实点击。
   *
   * 实现要点：
   *   · 用 document.elementFromPoint(x,y) 找指针下的元素
   *   · 派发完整的 mousedown → mouseup → click 序列
   *     （很多前端框架只监听 mousedown/pointerdown，光 click 不生效）
   *   · 指针本身 pointer-events:none，绝不吃掉自己的点击
   */
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
              lastHl: null, lastHlOutline: '', escapeTicks: 0 };
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

  /* ── 可点元素识别（吸附用） ──
   *
   * ⭐ 最可靠的判据是 CSS 的 cursor:pointer —— 那是网页作者自己
   *    标的"这里能点"，比猜 class 名准得多。
   *    实测 btime 登录区：
   *       .play_app_logo_login  347×44  cursor:pointer  ← 真按钮 ✓
   *       .play_app_status_login 220×29 cursor:auto     ← 提示文字 ✗
   *       .play_app_boxcont_login 518×561 cursor:auto   ← 容器 ✗
   */
  function ptIsClickableStyle(el) {
    try {
      var cs = getComputedStyle(el);
      if (cs && cs.cursor === 'pointer') return true;
    } catch (e) {}
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' ||
        tag === 'SELECT' || tag === 'LABEL') return true;
    if (el.getAttribute && el.getAttribute('role') === 'button') return true;
    return false;
  }

  function ptClickable(el) {
    /* 第一轮：只在祖先链上找 cursor:pointer / 原生控件 —— 最准 */
    var n = el, guard = 0;
    while (n && n !== document.body && guard < 6) {
      if (n.nodeType === 1 && ptIsClickableStyle(n)) {
        var r1 = rect(n);
        /* 排除过大的"容器"：真正的按钮不会铺满半屏。
         * 容器就算带 pointer 也别吸，否则点它命不中具体按钮。 */
        if (r1.w > 8 && r1.h > 8 && r1.w < VW * 0.7 && r1.h < VH * 0.6) {
          return n;
        }
        /* 容器过大 → 往它里面找真正的小按钮 */
        var inner = null;
        try {
          inner = n.querySelector('a,button,input,[role="button"]');
        } catch (e) {}
        if (!inner) {
          try {
            var all = n.querySelectorAll('*');
            for (var q = 0; q < all.length && q < 40; q++) {
              if (ptIsClickableStyle(all[q])) { inner = all[q]; break; }
            }
          } catch (e) {}
        }
        if (inner) {
          var ir = rect(inner);
          if (ir.w > 8 && ir.h > 8 && ir.w < VW * 0.7) return inner;
        }
      }
      n = n.parentElement; guard++;
    }

    /* 第二轮：退化为按 class 关键字猜（有些站点按钮没有 pointer）。
     * 但要求 cursor 不是 auto —— 否则会把提示文字（.play_app_status_login）
     * 这类"名字里带 login、其实不可点"的元素也吸过来。 */
    n = el; guard = 0;
    while (n && n !== document.body && guard < 6) {
      if (n.nodeType === 1) {
        var cls = (n.className && typeof n.className === 'string') ? n.className : '';
        if (/btn|button|link|login|tab|menu|submit|weixin|wechat|qrcode|qr/i.test(cls)) {
          var cs2 = null;
          try { cs2 = getComputedStyle(n); } catch (e) {}
          var cursorOk = !cs2 || cs2.cursor !== 'auto';
          var rc = rect(n);
          var txt = '';
          try { txt = (n.textContent || '').trim(); } catch (e) {}
          var tooBig = rc.w * rc.h > VW * VH * 0.06;
          var tooWordy = txt.length > 12;
          if (cursorOk && rc.w > 8 && rc.h > 8 &&
              rc.w < VW * 0.98 && rc.h < VH * 0.9 &&
              !tooBig && !tooWordy) {
            return n;
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
    for (var dy = -radius; dy <= radius; dy += 10) {
      for (var dx = -radius; dx <= radius; dx += 10) {
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
        if (d2 < bestD) { bestD = d2; best = { el: t, cx: cx, cy: cy, d2: d2 }; }
      }
    }
    return best;
  }

  /* 吸附半径：小一点，只吸"确实就在指针边上"的元素。
   * 半径太大（试过 90）会把隔了七八十像素的提示文字也吸过来，
   * 而且一旦吸上就再也挪不走 —— 表现就是"指针卡住不动"。
   * 42 是实测下来手感最好的值：够得着相邻按钮，又不会乱吸。 */
  var SNAP_RADIUS = 42;

  /** 把指针吸附到附近最近的可点元素；返回是否吸上了 */
  function pointerSnap() {
    try {
      var hit = ptSnapTarget(SNAP_RADIUS);
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
      /* 首次显示就把指针归到画面正中并吸附一次 ——
       * 登录框/扫码框基本都在屏幕中央，这样一进登录模式
       * 指针就直接贴在可点元素上，省得先盲挪半天。 */
      if (!ptr.centered) { ptr.centered = true; pointerCenter(); }
      else { pointerSnap(); }
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
    ptr.escapeTicks = 0;
    /* 归位时用更大的搜索半径 —— 屏幕正中往往是空白，
     * 得往外找一圈才能碰到弹层上的按钮。 */
    if (!pointerSnap()) {
      try {
        var hit = ptSnapTarget(160);
        if (hit) {
          ptr.x = Math.round(hit.cx); ptr.y = Math.round(hit.cy);
          if (ptr.el) { ptr.el.style.left = ptr.x + 'px'; ptr.el.style.top = ptr.y + 'px'; }
          ptr.snappedEl = hit.el;
        }
      } catch (e) {}
    }
    return { ok: true, x: Math.round(ptr.x), y: Math.round(ptr.y),
             snapped: ptr.snappedEl ? String(ptr.snappedEl.className || '').slice(0, 40) : '' };
  }

  /** 相对移动指针。dx/dy 单位为 CSS px。 */
  function pointerMove(dx, dy) {
    if (!ptr.visible) pointerShow(true);

    /* ★ 关键：如果当前正吸附在某个元素上，先"脱开"再移动。
     *
     *   否则会卡住不动 —— 指针被吸到按钮中心后，再按方向键，
     *   加完 dx/dy 又被吸回同一个按钮中心，坐标纹丝不动。
     *   表现就是"指针定住了、按方向键没反应"。
     *
     *   做法：吸附状态下，让这一步一定离开原元素，并且
     *   下一步【暂时不再吸附】（escapeTicks 冷却），
     *   这样连续按才能一级一级挪出去。 */
    if (ptr.snappedEl && (dx !== 0 || dy !== 0)) {
      var boost = 30;
      if (dx > 0) dx += boost; else if (dx < 0) dx -= boost;
      if (dy > 0) dy += boost; else if (dy < 0) dy -= boost;
      ptr.snappedEl = null;
      ptr.escapeTicks = 1;     // 下一步先不吸，确保真的挪出去了
    }

    ptr.x = Math.max(0, Math.min(VW - 1, ptr.x + dx));
    ptr.y = Math.max(0, Math.min(VH - 1, ptr.y + dy));
    if (ptr.el) {
      ptr.el.style.left = ptr.x + 'px';
      ptr.el.style.top = ptr.y + 'px';
    }

    /* 移动后再尝试吸附 —— 贴到附近最近的按钮上，
     * 这样不用像素级对齐也能按 OK 点中。 */
    if (ptr.escapeTicks > 0) {
      ptr.escapeTicks--;       // 冷却期内不吸附，保证能挪开
    } else {
      try { pointerSnap(); } catch (e) {}
    }

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


  /* ───────────────────────── 主流程 ───────────────────────── */

  function apply() {
    if (!state.enabled) return { off: true };

    try {
      VW = window.innerWidth || VW;
      VH = window.innerHeight || VH;

      ensureBackdrop();

      var p = findPlayer();
      if (!p) {
        // 播放器还没出来（未登录 / 还在加载）——
        // 记下状态，但【不要】把这个当作致命错误，
        // 后续 MutationObserver / 轮询会再来一次。
        state.errA = 'no-player';
        return { ok: false, hasPlayer: false, loggedIn: loggedIn() };
      }

      // 找到播放器了 —— 清掉之前的"没找到"状态
      state.errA = '';
      state.player = p;                 // ★ 供 isInProtectChain 用

      if (MODE !== 'off') floatPlayer(p);
      cleanAbove(p);
      hideFlowContent(p);
      readProgram(p);

      return {
        ok: true,
        hasPlayer: true,
        pinned: state.pinned,
        mode: MODE,
        loggedIn: loggedIn(),
        program: state.program,
        title: state.title,
        vw: VW, vh: VH
      };
    } catch (e) {
      state.errA = String(e);
      return { err: String(e) };
    }
  }

  /* ── 自动跟随：MutationObserver + 定时轮询双保险 ──
   *
   * 单独靠 MutationObserver 不够：某些电视 WebView 里，
   * 播放器是"先插入一个空壳、再异步填充"的，DOM 变动未必连续触发。
   * 加一个 1.5 秒的轻量轮询兜底（找到播放器后自动降频）。
   */
  var applyTimer = null;
  var fastTimer = null;          // ★ 短时高频补扫
  function scheduleApply(delay) {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(function () {
      applyTimer = null;
      try { apply(); } catch (e) {}
    }, delay || 300);
  }

  /* ★ 短时间内连打若干次 apply()
   *
   * 为什么需要它：登录成功的那一刻页面会 location.reload()，
   * 新页面起来后要 2~6 秒才把 <video> 真正渲染出来。
   * 稳定的 6 秒轮询会「正好错过」这个窗口 —— 用户看到的就是
   * "登录成功了，但屏幕上还是一片网页"。
   *
   * 这里在关键时刻（登录确认 / 鼠标模式退出 / 换台完成 / 页面加载完）
   * 打出一串密集补扫，把这段青黄不接的时间盖住。
   * 用 setTimeout 链而不是 setInterval，跑完自动停，不会长期占资源。 */
  function burstApply(count, gapMs) {
    var left = count || 12;
    var gap = gapMs || 500;
    if (fastTimer) { clearTimeout(fastTimer); fastTimer = null; }
    (function step() {
      try { apply(); } catch (e) {}
      left--;
      if (left > 0) fastTimer = setTimeout(step, gap);
    })();
  }

  function startAutoFollow() {
    // 1) DOM 变动跟随
    try {
      var mo = new MutationObserver(function () { scheduleApply(350); });
      mo.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}

    // 2) 定时兜底：播放器没钉住就每 1.5 秒再试；钉住后降到 6 秒一次
    setInterval(function () {
      try {
        var p = findPlayer();
        if (!p) { apply(); return; }
        if (MODE !== 'off' && !state.pinned) { apply(); return; }
        // 定期轻量重扫（页面可能整体重渲染）
        apply();
      } catch (e) {}
    }, 1500);

    /* 3) ★ 补扫 hook：页面自己触发的「马上就该能看到画面」的时机
     *
     *  之前只靠 MutationObserver + 1.5s 轮询。实测在真机上，
     *  登录后的 reload 过程中 WebView 会把 MutationObserver 一起丢掉
     *  （页面换了 document），新页面里注入脚本重跑，但 apply 的
     *  第一次调度要等 300ms + 1.5s，此时 video 还没渲染好，
     *  之后就落到 6 秒低频轮询 —— 表现为"登录完还是网页，要等很久（甚至一直）"。
     *
     *  这里在几个确定的关键点主动打一串补扫。 */
    try {
      window.addEventListener('load', function () { burstApply(10, 400); });
      /* 页面 reload 前一刻也记一笔：新页面起来后立刻补扫 */
      window.addEventListener('pageshow', function () { burstApply(10, 400); });
      /* 登录入口一旦被点击，说明马上要 reload —— 提前把节奏拉起来 */
      document.addEventListener('click', function (ev) {
        try {
          var t = ev.target;
          var d = 0;
          while (t && d < 6) {
            var cls = (t.className && typeof t.className === 'string') ? t.className : '';
            if (/login|play_app_logo|user-btn|platform-item/i.test(cls)) {
              burstApply(24, 500);      // 覆盖 reload + 取流 + 渲染
              return;
            }
            t = t.parentElement; d++;
          }
        } catch (e) {}
      }, true);
    } catch (e) {}
  }

  /* ───────────────────── 换台：点频道 <li> ─────────────────────
   *
   * switchTo(name)：
   *   · name 就是频道显示名（"北京卫视" / "BRTV文艺" …）
   *   · 找到对应的 <li>，.click()
   *   · 页面自己去取流 + 重新渲染播放器
   *
   * 频道 <li> 的真实位置（实测 btime.com/btv）：
   *   DIV.module_live
   *    └ DIV.focus_wrap
   *      └ DIV.right_item.right_list
   *        └ UL
   *          └ LI 北京卫视 / BRTV文艺 / …   （每项 203x52，纵向排列）
   *
   * ⚠ 页面顶部还有一个 .header-menu-list（首页/要闻/电视…），
   *   里面也有 LI —— 所以【不能】只按 LI 文本宽松匹配，
   *   必须精确等于频道名，且优先选"在 module_live 里"的那个。
   *
   * ⚠ 为什么用【纯原生 .click()】：btime 的 LI 事件用 jQuery 委托绑在父级，
   *   任何 stopPropagation 的"安全点击"都会把事件在到达处理函数前拦死。
   *   （这是央视频那边踩过的同一个坑。）
   */
  function normName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s\-_·・]/g, '')
      .replace(/brtv/g, '')
      .replace(/频道/g, '');
  }

  /** 收集所有"看起来是频道项"的 LI 候选 */
  function channelItems() {
    var out = [];
    // ① 优先：module_live 里的频道条（真实站点结构）
    var liveBox = document.querySelector('.module_live');
    if (liveBox) {
      var lis = liveBox.querySelectorAll('li');
      for (var i = 0; i < lis.length; i++) out.push(lis[i]);
    }
    // ② 兜底：全局 LI（万一 module_live 换名字）
    if (!out.length) {
      var all = document.querySelectorAll('li');
      for (var j = 0; j < all.length; j++) {
        var t = (all[j].textContent || '').trim();
        // 频道名都很短，且不含换行
        if (t && t.length <= 12 && t.indexOf('\n') < 0) out.push(all[j]);
      }
    }
    return out;
  }

  function switchTo(name, cb) {
    __muteForSwitch();
    var want = normName(name);
    if (!want) { fire(cb, { ok: false, err: 'empty-name' }); return; }

    var tries = 0;
    function attempt() {
      tries++;
      var items = channelItems();
      var best = null;

      for (var i = 0; i < items.length; i++) {
        var raw = (items[i].textContent || '').trim();
        var t = normName(raw);
        if (!t) continue;

        // 精确匹配优先
        if (t === want) { best = items[i]; break; }
        // 退一步：前缀匹配（"北京卫视" vs "北京卫视高清"）
        if (!best && t.length <= 12 && (t.indexOf(want) === 0 || want.indexOf(t) === 0)) {
          best = items[i];
        }
      }

      if (best) {
        try {
          best.click();
          fire(cb, { ok: true, via: 'click', name: name });
          // 点完重扫一次（播放器会重建）
          setTimeout(function () { try { apply(); } catch (e) {} }, 400);
          setTimeout(function () { try { apply(); } catch (e) {} }, 1500);
          return;
        } catch (e) {
          fire(cb, { ok: false, err: String(e) });
          return;
        }
      }

      if (tries < 8) { setTimeout(attempt, 350); return; }
      fire(cb, { ok: false, err: 'no-match', name: name });
    }

    attempt();
  }

  function fire(cb, obj) {
    if (typeof cb === 'function') { try { cb(obj); } catch (e) {} }
    else { window.__BT_SWR__ = JSON.stringify(obj); }
  }

  /* ───────────────────────── 对外 API ───────────────────────── */


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

  window.BTLive = {
    rescan: function () { try { return apply(); } catch (e) { return { err: String(e) }; } },

    /* ★ 密集补扫：Java 侧在「登录确认 / 退出鼠标模式 / 换台完成」
     *   这几个关键时刻调用，把页面重排 + 取流 + 渲染这段空窗盖住。
     *   参数可省，默认 24 次 × 500ms ≈ 12 秒。 */
    burst: function (count, gapMs) {
      try { burstApply(count || 24, gapMs || 500); return { ok: true }; }
      catch (e) { return { err: String(e) }; }
    },

    on: function () { state.enabled = true; return apply(); },

    off: function () {
      state.enabled = false;
      // 还原被我们改过的样式（备份在 recover 里，简化处理：只撤 display）
      return { off: true };
    },

    setMode: function (m) {
      if (m === 'off' || m === 'safe' || m === 'full') MODE = m;
      return apply();
    },

    getMode: function () { return MODE; },

    /** 换台：name = 频道显示名 */
    switchTo: function (name, cb) {
      try { return switchTo(name, cb); }
      catch (e) { fire(cb, { ok: false, err: String(e) }); }
    },

    /** 当前是否已登录（未登录时 Java 侧可以提示用户先扫码） */
    isLoggedIn: function () { return loggedIn(); },

    /* ── 遥控器模拟鼠标（登录时用）──
     * 注意：pointerShow / pointerHide / pointerMove / pointerClick
     *      等指针 API 不在这里逐条写，而是由文件末尾的
     *      bindPointerApi(window.BTLive) 统一挂上 ——
     *      这样三个源（央视频 / 北京台 / 内蒙古）用的是同一份实现，
     *      改一处三处都生效，不会各自漂移。 */

    info: function () {
      var out = {
        program: state.program,
        title: state.title,
        loggedIn: loggedIn(),
        mode: MODE,
        pinned: state.pinned,
        vw: VW, vh: VH,
        aboveKilled: state.aboveKilled,
        flowKilled: state.flowKilled,
        hiddenTotal: state.hiddenTotal,
        errA: state.errA,
        errF: state.errF
      };
      var p = findPlayer();
      if (p) {
        var r = rect(p);
        out.top = Math.round(r.top);
        out.bottom = Math.round(r.bottom);
        out.left = Math.round(r.left);
        out.right = Math.round(r.right);
        out.videoW = Math.round(r.w);
        out.videoH = Math.round(r.h);
        var tag = (p.tagName || '').toUpperCase();
        out.hasVideo = tag === 'VIDEO';
        if (tag === 'VIDEO') {
          try {
            out.playing = !p.paused && p.readyState > 2;
            out.err = p.error ? (p.error.code + ':' + (p.error.message || '')) : '';
          } catch (e) {}
        }
      } else {
        out.hasVideo = false;
        out.playing = false;
      }
      return out;
    },

    lastError: ''
  };

  /* 指针能力统一挂到本命名空间（Java 侧按当前源的命名空间调用） */
  if (typeof bindPointerApi === 'function') bindPointerApi(window.BTLive);


  /* ── 启动 ──
   *
   * addInitScript 在 document-start 注入，此时 body 可能还没有。
   * apply() 内部已做判空，安全；再用 DOMContentLoaded 补一次，
   * 然后交给 startAutoFollow 持续跟随。
   */
  try { apply(); } catch (e) { window.BTLive.lastError = String(e); }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        try { apply(); } catch (e) {}
      });
    }
    window.addEventListener('load', function () {
      try { apply(); } catch (e) {}
    });
    window.addEventListener('resize', function () {
      try { apply(); } catch (e) {}
    });
    startAutoFollow();
  } catch (e) {}
})();
