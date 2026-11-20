/*
 * inject.js —— 注入央视频直播页的整理脚本
 *
 * ⚠ 版本说明（v2.7）：本文件是【v2.4 时代引擎的完整回滚】。
 *   v2.5.1~v2.6.1 在电视上「无声音无图像」，事后确认主根因是
 *   Java 侧 loadChannel 的启动去重把首次 loadUrl 吞掉了（已修）；
 *   但按用户要求，注入脚本也一并回滚到 v2.4 已验证的稳定版本。
 *   v2.4 特征：hideFlowContent 祖先链保留法 + floatPlayer 钉容器
 *   + switchTo 先文本匹配、失败走 location.hash 路由。
 *   （头注释里的 v1.7 是当年的历史版本号，未随小版本更新。）
 *
 * ── 前面几版为什么失败 ──
 * v1.3 用「隐藏页面其它节点」→ 破坏布局基准，且把播放器自己也设了
 *      overflow:hidden，导致黑屏有声音。
 * v1.4 用「appendChild 把播放器搬到自建舞台」→ 更糟：
 *      播放器依赖原父节点的堆叠上下文与脚本引用，拔出来就只剩声音。
 * v1.5 靠「全屏不透明黑底遮罩 + 只碰尺寸」→ 仍黑屏（TCL 65Q9K 实测）。
 * v1.6 默认 safe 模式，完全不碰播放器定位 → 仍然黑屏。
 *
 * ── v1.7 关键发现（TCL 等电视端 WebView）──
 * 电视端 WebView 的 <video> 是【独立硬件合成层】（SurfaceView / 叠加层），
 * 它并不参与网页的普通 DOM 绘制顺序。网页里再垫一层
 * 「position:fixed + 全屏 + 不透明 background + 高 z-index」的元素，
 * 在这些设备上会把视频那层整个「盖掉」或让它被判定为不可见而丢弃，
 * 结果就是：音频照常走，画面全黑。
 *
 *   证据：多份资料一致指出，给 WebView 里叠加不透明浮层，
 *   会导致 video 渲染缓冲被判定处于不可见区域而丢弃，只剩音频。
 *
 * ── v1.7 策略 ──
 *   1. 【不再用网页内黑底遮罩盖住视频】。改用原生 View 做黑底/遮罩，
 *      它们和 WebView 是两个独立的 View，不会进入同一个合成层。
 *   2. 页面里只做「清高位浮层」——把登录弹窗、下载横幅这类
 *      z-index 极高的 fixed/absolute 节点 display:none 掉。
 *      这类节点是普通 DOM，隐藏它们不会碰视频层。
 *   3. 完全不碰 <video> 自身的 position/尺寸（safe 模式）。
 *      full 模式才钉满屏，供画面偏小的设备选用。
 *
 * 不写死任何 class / id 名，全部按位置 + 尺寸 + 层级判断。
 */
(function () {
  'use strict';
  if (window.__TV_LIVE_INJECTED__) { window.TVLive.rescan(); return; }
  window.__TV_LIVE_INJECTED__ = true;

  var VW = 1, VH = 1, AREA = 1;
  var HIGH_Z = 2147482000;          // 判定"浮层"的层级门槛
  var PLAYER_Z = 2147483000;        // full 模式下播放器层级
  var state = { player: null, program: '', title: '', enabled: true, mode: 'safe', pinned: false };

  /* ── 工作模式 ──
   * safe   : 默认。【不垫任何网页内遮罩】，只清高位浮层，不碰 <video>。
   *          对电视端 WebView 最安全 —— 视频层不会被任何东西盖住。
   * full   : 在 safe 基础上，把播放器钉成 fixed 铺满全屏。
   *          画面偏小/有留白、且设备能接受 fixed 化 video 时使用。
   * off    : 完全不注入（全交回原网页）。
   *
   * backdrop 选项（针对"想盖住网页其它内容"的需求）：
   *   由原生侧负责。网页内不再生成 __tv_backdrop__。
   */
  var MODE = 'safe';

  function px(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }

  function visible(el) {
    var cs = getComputedStyle(el);
    if (!cs) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (px(cs.opacity, 1) < 0.05) return false;
    return true;
  }

  function box(el) {
    var r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, area: r.width * r.height, x: r.left, y: r.top };
  }

  function winW() {
    return Math.round(Math.max(
      window.innerWidth || 0,
      document.documentElement ? document.documentElement.clientWidth : 0) || 1280);
  }
  function winH() {
    return Math.round(Math.max(
      window.innerHeight || 0,
      document.documentElement ? document.documentElement.clientHeight : 0) || 720);
  }

  /* ================= 1. 识别播放器 =================
   * 只认真正承载画面的节点：video 优先，其次 canvas。
   * 刻意不做「容器兜底」——之前那版会误判成大 div，
   * 把页面某块内容当播放器去操作，正是黑屏与露界面的来源之一。
   */
  function scoreOf(el) {
    var b = box(el);
    if (b.area <= 0) return 0;
    var s = b.area / AREA;
    var tag = el.tagName;

    if (tag === 'VIDEO') {
      s += 0.8;
      try {
        if (el.videoWidth > 0) s += 1.0;
        if (!el.paused) s += 0.8;
      } catch (e) {}
    } else if (tag === 'CANVAS') {
      s += 0.5;
      if (el.width > 0 && el.height > 0) s += 0.3;
    }

    var ratio = b.w / Math.max(b.h, 1);
    if (ratio > 1.1 && ratio < 2.6) s += 0.2;

    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    var dx = Math.abs(cx - VW / 2) / Math.max(VW, 1);
    var dy = Math.abs(cy - VH / 2) / Math.max(VH, 1);
    s += Math.max(0, 0.3 - (dx + dy) * 0.3);

    return s;
  }

  function findPlayer() {
    var best = null, bestScore = 0, i;

    var vids = document.querySelectorAll('video');
    for (i = 0; i < vids.length; i++) {
      var sv = scoreOf(vids[i]);
      if (sv > bestScore) { bestScore = sv; best = vids[i]; }
    }
    // video 只要足够大就认定，不再要求极高分数
    if (best && bestScore >= 0.5) return best;

    var cvs = document.querySelectorAll('canvas');
    for (i = 0; i < cvs.length; i++) {
      var sc = scoreOf(cvs[i]);
      if (sc > bestScore) { bestScore = sc; best = cvs[i]; }
    }
    if (best && bestScore >= 0.6) return best;

    return best;
  }

  /* ================= 1.5 找到播放器的「容器」 =================
   *
   * v1.8 关键改进（借鉴已验证的开源方案 LiteWebTV）：
   * 全屏不该去改 <video> 本身，而应该把它外面那层「播放器容器」钉满屏。
   *
   * 原因：video 的尺寸通常由容器决定（width:100% / height:100%）。
   * 只改 video 而容器还是网页里那一小块，video 照样被容器框住。
   * 把容器 fixed 铺满，video 自然撑满，且 Overflow 由容器收口 ——
   * 这比直接动 video 稳得多，也不容易出现黑屏。
   *
   * 容器怎么找：从 video 往上走，找第一个「尺寸明显大于 video、
   * 且在网页里属于播放区域」的祖先（一般是 .c-container / .video-con 之类）。
   * 不写死 class 名 —— 按 尺寸 + 包含关系 判断。
   */
  function findContainer(v) {
    if (!v) return null;
    var vb = box(v);
    if (vb.area <= 0) return null;

    // 沿祖先链往上走，收集所有"能包住 video"的层。
    // 选其中【面积最大、但还没到整页级别】的那一层当舞台：
    //   - 太小 -> video 被框在网页一小块（之前的问题）
    //   - 太大（接近整页）-> 会把页面导航一起钉住
    // 真机上央视频的播放舞台通常是 .c-container / .video-con 这种，
    // 比 video 略大一圈、但远小于整页。
    var best = null;
    var node = v.parentElement;
    var depth = 0;
    while (node && depth < 7) {
      var tag = (node.tagName || '').toLowerCase();
      if (tag === 'body' || tag === 'html') break;

      var b = box(node);
      var wraps = b.w >= vb.w * 0.98 && b.h >= vb.h * 0.98;

      if (wraps) {
        // 记下当前这层；只要还没超过"屏幕的 4/5"，就继续往上试更大的
        best = node;
        if (b.area >= AREA * 0.8) break;   // 已经接近满屏，再往上就过头了
      } else {
        // 出现一层比 video 小的，说明已经越过舞台边界，停
        break;
      }
      node = node.parentElement;
      depth++;
    }

    // 没找到包裹层时，退而求其次用直接父元素
    if (!best) {
      var par = v.parentElement;
      if (par) {
        var pt = (par.tagName || '').toLowerCase();
        if (pt !== 'body' && pt !== 'html') best = par;
      }
    }
    return best;
  }

  /* ================= 2. 黑底遮罩 —— 已废弃 =================
   *
   * v1.7 起这里不再生成任何网页内的全屏黑底。
   * 原因见文件头：【电视端 WebView 的视频是独立硬件层，
   * 网页里再垫一层不透明全屏元素会把视频层盖掉 / 判定为不可见而丢弃】，
   * 表现就是有声音、没画面。
   *
   * 需要"黑底 + 换台遮罩"时，由原生 View（MainActivity 的 maskLayer）承担，
   * 那是独立于 WebView 的 View，不会参与网页合成。
   *
   * 保留这个函数名是为了兼容旧调用点，现在只做一件事：清掉历史遗留在
   * DOM 里的 __tv_backdrop__（如果是从旧版本热更新过来的话）。
   */
  function ensureBackdrop() {
    var old = document.getElementById('__tv_backdrop__');
    if (old && old.parentNode) {
      // 之前版本用来压住视频的那层黑底 —— 直接摘掉。
      // 它就是电视端黑屏的元凶之一。
      old.parentNode.removeChild(old);
    }

    /* ★ 顺手把页面自身的底色刷黑。
     *
     * 注意：这和上面摘掉的"黑底 View"完全不是一回事 ——
     *   那个是盖在视频【上面】的浮层（所以会黑屏）；
     *   这里改的是 html / body 的 background，是最底层的页面底色，
     *   位于 video 之下，绝不会挡住视频。
     *
     * 作用：万一顶边因为合成层对齐裂出一丝缝，露出来的是黑的，
     *      而不是刺眼的白，用户根本看不出来。 */
    try {
      if (document.documentElement && document.documentElement.style) {
        document.documentElement.style.setProperty('background', '#000', 'important');
      }
      if (document.body && document.body.style) {
        document.body.style.setProperty('background', '#000', 'important');
      }
    } catch (e) {}

    return null;
  }

  /* ================= 3. 播放器铺满（钉「容器」，不钉 video） =================
   *
   * v1.8 重写。方案来自已实机验证的开源项目 LiteWebTV：
   *
   *   1) 把 video 的「容器」设为 fixed 铺满全屏、z-index 拉高、overflow:hidden
   *   2) video 本身只设 width/height:100% + object-fit:contain
   *
   * 这才是正确的分工 —— 容器负责"铺满屏"，video 负责"在容器里等比撑满"。
   * 之前几版一直纠结直接动 video，方向就错了：
   * 只动 video，它外面那层容器仍按网页原布局占位，video 就被框在那一块。
   *
   * MODE:
   *   safe —— 默认。仍然执行容器铺满（这是出全屏的关键），
   *           但绝不改 video 的 overflow / 父链结构。
   *   full —— 额外把 video 也钉满（个别设备容器铺满后画面仍偏小时用）。
   *   off  —— 不注入。
   */
  function floatPlayer(p) {
    if (!p) return;

    var W = winW(), H = winH();
    var shell = findContainer(p);

    // —— 第一优先级：让「容器」铺满全屏 ——
    // 用 100vw/100vh（CSS 原生单位）而不是 JS 算的像素：
    // 不受注入时机、窗口尺寸变化影响，永远等于视口。
    if (shell) {
      shell.style.setProperty('position', 'fixed', 'important');
      shell.style.setProperty('top', '0', 'important');
      shell.style.setProperty('left', '0', 'important');
      shell.style.setProperty('width', '100vw', 'important');
      shell.style.setProperty('height', '100vh', 'important');
      shell.style.setProperty('max-width', 'none', 'important');
      shell.style.setProperty('max-height', 'none', 'important');
      shell.style.setProperty('min-width', '0', 'important');
      shell.style.setProperty('min-height', '0', 'important');
      shell.style.setProperty('margin', '0', 'important');
      shell.style.setProperty('padding', '0', 'important');
      shell.style.setProperty('transform', 'none', 'important');
      shell.style.setProperty('background', '#000', 'important');
      shell.style.setProperty('overflow', 'hidden', 'important');
      /* ★ 顶边一丝不留（见 btime 侧同名注释）：
       *   硬件合成层与普通绘制之间可能差零点几像素，
       *   顶上会裂出一条缝露出页面白底。整体上移 2px 压死。 */
      shell.style.setProperty('margin-top', '-2px', 'important');
      shell.style.setProperty('border-top-width', '0', 'important');
      shell.style.setProperty('box-shadow', 'none', 'important');
      shell.style.setProperty('z-index', PLAYER_Z + '!important');
      shell.style.setProperty('display', 'block', 'important');

      // —— 中间层（容器 > 中间层 > video）——
      // 关键：这些层不能用 absolute ！
      // 之前给中间层设 absolute+100%，会脱离文档流，父级若没有确定高度
      // 就会链式塌成 0（实测 video 变 0x0）。
      // 正确做法：保持它们在普通文档流里，只设 width/height:100%，
      // 由最外层的 fixed 容器给它们撑出确定尺寸。
      var mid = p.parentElement;
      var guard = 0;
      while (mid && mid !== shell && guard < 6) {
        mid.style.setProperty('position', 'static', 'important');
        mid.style.setProperty('top', 'auto', 'important');
        mid.style.setProperty('left', 'auto', 'important');
        mid.style.setProperty('right', 'auto', 'important');
        mid.style.setProperty('bottom', 'auto', 'important');
        mid.style.setProperty('width', '100%', 'important');
        mid.style.setProperty('height', '100%', 'important');
        mid.style.setProperty('max-width', 'none', 'important');
        mid.style.setProperty('max-height', 'none', 'important');
        mid.style.setProperty('min-width', '0', 'important');
        mid.style.setProperty('min-height', '0', 'important');
        mid.style.setProperty('margin', '0', 'important');
        mid.style.setProperty('padding', '0', 'important');
        mid.style.setProperty('transform', 'none', 'important');
        mid.style.setProperty('display', 'block', 'important');
        mid.style.setProperty('overflow', 'hidden', 'important');
        mid = mid.parentElement;
        guard++;
      }
    }

    // —— 第二优先级：video 自身撑满 ——
    // 与中间层同理：用普通流 + 100%，不用 absolute。
    // absolute 一旦遇上父级高度不确定就会塌成 0（实测踩过）。
    //   有 shell  -> 静态定位，宽高 100%，跟着容器走
    //   没 shell  -> 直接 fixed 视口像素，不依赖任何祖先
    if (shell) {
      p.style.setProperty('position', 'static', 'important');
      p.style.setProperty('top', 'auto', 'important');
      p.style.setProperty('left', 'auto', 'important');
      p.style.setProperty('right', 'auto', 'important');
      p.style.setProperty('bottom', 'auto', 'important');
      p.style.setProperty('width', '100%', 'important');
      p.style.setProperty('height', '100%', 'important');
      p.style.setProperty('display', 'block', 'important');
    } else {
      p.style.setProperty('position', 'fixed', 'important');
      p.style.setProperty('top', '0', 'important');
      p.style.setProperty('left', '0', 'important');
      p.style.setProperty('right', 'auto', 'important');
      p.style.setProperty('bottom', 'auto', 'important');
      p.style.setProperty('width', W + 'px', 'important');
      p.style.setProperty('height', H + 'px', 'important');
      p.style.setProperty('z-index', (PLAYER_Z + 1) + '!important');
      /* 顶边上移 2px，压死合成层缝隙（见 shell 分支注释） */
      p.style.setProperty('margin-top', '-2px', 'important');
    }
    p.style.setProperty('max-width', 'none', 'important');
    p.style.setProperty('max-height', 'none', 'important');
    p.style.setProperty('min-width', '0', 'important');
    p.style.setProperty('min-height', '0', 'important');
    p.style.setProperty('margin', '0', 'important');
    p.style.setProperty('padding', '0', 'important');
    p.style.setProperty('object-fit', 'contain', 'important');
    p.style.setProperty('background', '#000', 'important');

    return !!shell;
  }

  /* ================= 4. 清掉页面上的浮层 =================
   *
   * v1.7：不再有网页内遮罩，所以判定门槛从"高于遮罩"改为
   * "高于普通内容"。凡是脱离文档流、层级很高的 fixed/absolute 节点，
   * 基本都是登录弹窗、下载 App 横幅、活动浮层 —— 一律隐藏。
   *
   * 这些是普通 DOM 节点，隐藏它们不会影响 <video> 的独立合成层，
   * 所以是安全的（跟"黑底盖视频"完全是两回事）。
   */
  function cleanAbove(p) {
    var killed = 0;
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el || el === p || !el.style) continue;
      if (el.id === '__tv_focus__' || el.id === '__tv_vp__') continue;
      if (!visible(el)) continue;

      // 【铁律】绝不隐藏播放器的祖先 —— 那会把播放器一起带没。
      // 之前就是这个疏漏：把含播放器的外层容器 display:none 掉，
      // 结果画面直接消失（实测 display:none）。
      if (el.contains(p)) continue;

      var cs = getComputedStyle(el);
      if (!cs) continue;
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;

      // —— 播放器一脉的节点一律放过（控制条、弹幕层等）——
      var isPlayerKin = false;
      var par = el.parentElement;
      for (var d = 0; d < 4 && par; d++) {
        if (par === p) { isPlayerKin = true; break; }
        par = par.parentElement;
      }
      if (isPlayerKin) continue;

      // —— 判定：按「位置 + 大小」识别浮层，不靠 class 名 ——
      var z = px(cs.zIndex, 0);
      var b = box(el);
      if (b.area <= 0) continue;              // 没面积的不管

      var abovePlayer = false;
      if (p) {
        var pb = box(p);
        var overlapY = Math.min(pb.y + pb.h, b.y + b.h) - Math.max(pb.y, b.y);
        var overlapX = Math.min(pb.x + pb.w, b.x + b.w) - Math.max(pb.x, b.x);
        abovePlayer = overlapY > 0 && overlapX > 0 && z >= 100;
      }

      // 只清理「明确是浮层」的：层级很高，或压在播放器之上。
      // 去掉原来的 screenLevel(面积≥60%) 判定 ——
      // 它会误伤页面主容器，属于过度清理。
      if (z <= 1000 && !abovePlayer) continue;

      el.style.setProperty('display', 'none', 'important');
      killed++;
    }

    // —— 顺手藏掉播放器「旁边」的栏目（右侧节目单 / 推荐位）——
    // v2.3：主战场交给 hideFlowContent（清文档流内容），这里保留兜底
    hideSideRails(p);

    return killed;
  }

  /* 隐藏播放器之外的"栏目块"（兜底用；主战场是 hideFlowContent） */
  function hideSideRails(p) {
    if (!p) return 0;
    var pb = box(p);
    if (pb.area <= 0) return 0;
    var pLeft = pb.x, pRight = pb.x + pb.w;
    var pTop = pb.y, pBottom = pb.y + pb.h;
    var killed = 0;

    var all = document.querySelectorAll('body > *, body > * > *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!el || !el.style) continue;
      if (el === p || el.contains(p)) continue;
      if (el.id === '__tv_focus__') continue;
      if (!visible(el)) continue;
      if (el.querySelector('video')) continue;   // 含 video 的是播放器一脉

      var b = box(el);
      if (b.area <= 0) continue;
      var left = b.x, right = b.x + b.w;
      var top = b.y, bottom = b.y + b.h;

      // 垂直方向必须和播放器重叠（说明是同一屏的内容）
      var vOverlap = Math.min(pBottom, bottom) - Math.max(pTop, top);
      if (vOverlap <= 0) continue;

      // 水平方向要基本在播放器右侧或左侧之外
      var rightSide = left >= pRight - 8;
      var leftSide = right <= pLeft + 8;
      if (!rightSide && !leftSide) continue;

      // 且它得是个"成规模的栏目"（面积占屏的 3% 以上），别误伤小图标
      if (b.area < AREA * 0.03) continue;

      el.style.setProperty('display', 'none', 'important');
      killed++;
    }
    return killed;
  }

  /* ================= 4.5 清掉文档流里的"页面本体" =================
   *
   * v2.3 新增。这是本次修复的核心。
   *
   * 背景：真机上"上方还有网页 / 下方还有网页"，就是页面里
   * 【普通文档流】里的栏目块 —— 页头导航、下方推荐位、页脚等。
   * cleanAbove 只清 position:fixed/absolute 且 z-index≥1000 的浮层
   * （弹窗、横幅那类），对这些文档流内容无能为力。
   *
   * 之前的 hideSideRails 只处理"播放器左右两侧"，但 floatPlayer
   * 一旦把播放器容器钉成 fixed 铺满全屏，剩余页面内容就不再位于
   * 播放器的"左右"，这个判定就全落空了 —— 这正是 v2.2 的漏洞。
   *
   * v2.4 策略重写 —— 改为【祖先链保留法】，也就是最彻底的做法：
   *
   *   1. 先算出「从播放器一路上到 body」的那条祖先链
   *   2. 沿着这条链自上而下，把每一层里【不属于这条链的兄弟节点】全部隐藏
   *
   * 这样做的道理很直白：播放器能显示，只依赖它自己那条祖先链。
   * 链上的每一层必须留着（动了就黑屏 —— v1.3 的教训），
   * 而链外的兄弟节点全是"页面其余部分"，一律盖掉。
   *
   * 相比 v2.3 的"下钻 4 层找可疑块"，这个做法：
   *   · 不设深度限制 —— 页面嵌 20 层也能一路清到底
   *   · 不需要判断"是否与播放器重叠" —— 链外的内容本来就该清
   *   · 判定条件更少，更不容易漏
   *
   * 三重保险，确保绝不误伤播放器：
   *   ① 祖先链上的节点绝不隐藏（用 contains 判定，写死不了）
   *   ② 含 <video>/<canvas> 的节点绝不隐藏
   *   ③ 面积小于屏幕 0.5% 的小节点不动（装饰、圆点之类）
   */
  function hideFlowContent(p) {
    if (!p || !document.body) return 0;
    var killed = 0;
    var body = document.body;

    // —— 第 1 步：收集祖先链（不含 body 本身）——
    var chain = [];
    var node = p.parentElement;
    var guard = 0;
    while (node && node !== body && guard < 50) {
      chain.push(node);
      node = node.parentElement;
      guard++;
    }
    // body 也要算进去，方便下面从 body 开始清扫
    chain.push(body);

    var chainSet = [];
    for (var c = 0; c < chain.length; c++) chainSet.push(chain[c]);

    function inChain(el) {
      for (var i = 0; i < chainSet.length; i++) {
        if (chainSet[i] === el) return true;
      }
      return false;
    }

    /* 该不该隐藏这个节点 */
    function shouldHide(el) {
      if (!el || !el.style) return false;
      if (el === p) return false;
      if (inChain(el)) return false;                 // ① 祖先链保护
      if (el.contains(p)) return false;              // 含播放器（保险）
      if (el.id === '__tv_focus__' || el.id === '__tv_vp__') return false;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE'
          || el.tagName === 'LINK' || el.tagName === 'META'
          || el.tagName === 'NOSCRIPT' || el.tagName === 'TITLE') return false;
      if (!visible(el)) return false;
      // ② 含 video/canvas 的一律不碰
      if (el.querySelector
          && (el.querySelector('video') || el.querySelector('canvas'))) return false;

      // ③ 太小的不动（装饰、状态点、进度条之类）
      var b = box(el);
      if (b.area > 0 && b.area < AREA * 0.005) return false;

      return true;
    }

    /* —— 第 2 步：沿祖先链自上而下，逐层清扫链外兄弟 ——
     * 注意必须【自上而下】：把外层兄弟隐藏掉之后，里层的节点
     * 可能因布局变化而脱离可见区，不宜再遍历。
     * 对链上的每一层，处理它的子节点；不在链上的子节点直接隐藏，
     * 在链上的则继续往下走。 */
    for (var lv = 0; lv < chain.length; lv++) {
      var host = chain[lv];
      var kids = host.children;
      if (!kids) continue;

      // 自下而上删会造成索引错乱，所以先收集再处理
      for (var k = 0; k < kids.length; k++) {
        var kid = kids[k];
        if (!kid || !kid.style) continue;
        if (inChain(kid)) continue;      // 链上的一层，保留
        if (kid === p) continue;         // 播放器本身（含在链的末端）
        if (shouldHide(kid)) {
          kid.style.setProperty('display', 'none', 'important');
          killed++;
        }
      }
    }

    /* —— 第 3 步：兜底清扫 —— 
     * 有些页面把内容放在祖先链之外的深层位置（例如通过 shadow DOM
     * 或动态挂载到 body 深处的浮层）。这里对「和播放器在屏幕上
     * 重叠、但不在链上」的可见块再扫一遍，最多下钻 8 层。 */
    if (killed === 0) {
      var pb = box(p);
      if (pb.area > 0) {
        var queue2 = [{ node: body, depth: 0 }];
        var visited = 0;
        while (queue2.length && visited < 600) {
          var cur2 = queue2.shift();
          visited++;
          if (cur2.depth > 8) continue;
          var ks = cur2.node.children;
          if (!ks) continue;
          for (var m = 0; m < ks.length; m++) {
            var e2 = ks[m];
            if (!e2 || !e2.style) continue;
            if (inChain(e2) || e2 === p || e2.contains(p)) {
              queue2.push({ node: e2, depth: cur2.depth + 1 });
              continue;
            }
            if (!shouldHide(e2)) {
              queue2.push({ node: e2, depth: cur2.depth + 1 });
              continue;
            }
            // 只清「真的挡在播放画面上」的
            var b2 = box(e2);
            var ovX = Math.min(pb.x + pb.w, b2.x + b2.w) - Math.max(pb.x, b2.x);
            var ovY = Math.min(pb.y + pb.h, b2.y + b2.h) - Math.max(pb.y, b2.y);
            if (ovX > 0 && ovY > 0) {
              e2.style.setProperty('display', 'none', 'important');
              killed++;
            } else {
              queue2.push({ node: e2, depth: cur2.depth + 1 });
            }
          }
        }
      }
    }

    return killed;
  }

  /* [v2.3 的旧实现，保留备查] */
  function hideFlowContentOld(p) {
    if (!p) return 0;
    var pb = box(p);
    if (pb.area <= 0) return 0;
    var killed = 0;

    function tryKill(el) {
      if (!el || !el.style) return false;
      if (el === p) return false;
      if (el.contains(p)) return false;
      if (el.id === '__tv_focus__' || el.id === '__tv_vp__') return false;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return false;
      if (!visible(el)) return false;
      // 含 video/canvas 的是播放器一脉，绝不碰
      if (el.querySelector && (el.querySelector('video') || el.querySelector('canvas'))) return false;

      var b = box(el);
      if (b.area <= 0) return false;

      // 与播放器有重叠才算"在挡事"
      var ovX = Math.min(pb.x + pb.w, b.x + b.w) - Math.max(pb.x, b.x);
      var ovY = Math.min(pb.y + pb.h, b.y + b.h) - Math.max(pb.y, b.y);
      if (ovX <= 0 || ovY <= 0) return false;

      // 面积太小的不动（可能是装饰、进度点之类）
      if (b.area < AREA * 0.005) return false;

      el.style.setProperty('display', 'none', 'important');
      return true;
    }

    /* 从 body 直接子元素开始，若它包含 video 则跳过；若不包含，
     * 先看它本身能否直接隐藏 —— 能则记 killed；不能（比如它包住
     * 了播放器的兄弟节点）则下钻一层再试。最多下钻 3 层。 */
    var body = document.body;
    if (!body) return 0;
    var tops = body.children;
    for (var i = 0; i < tops.length; i++) {
      var el = tops[i];
      if (!el || !el.style) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;

      // 【关键】若这一支包含播放器（el.contains(p)），不能整支跳过 ——
      // 那样会把"和播放器并列排布的兄弟块"（典型：播放器旁边的右侧
      // 节目单）一起漏掉。正确做法是继续下钻，只在遇到"真正包含
      // 播放器的那个子节点"时才不收。
      if (!el.contains(p) && tryKill(el)) { killed++; continue; }

      // 下钻队列：包含播放器的分支也要下钻，只是不入 kill 判定
      var queue = [{ node: el, depth: 1 }];
      while (queue.length) {
        var cur = queue.shift();
        if (cur.depth > 4) continue;
        var kids = cur.node.children;
        if (!kids) continue;
        for (var j = 0; j < kids.length; j++) {
          var k = kids[j];
          if (!k || !k.style) continue;
          if (k.tagName === 'SCRIPT' || k.tagName === 'STYLE' || k.tagName === 'LINK') continue;

          // 含 video/canvas 的子节点：跳过它自身，但若它还有兄弟块
          // 需要处理，继续把它当容器下钻（只下钻，不隐藏）。
          var hasMedia = k.contains(p) ||
              (k.querySelector && (k.querySelector('video') || k.querySelector('canvas')));
          if (hasMedia) {
            if (visible(k)) queue.push({ node: k, depth: cur.depth + 1 });
            continue;
          }
          if (tryKill(k)) { killed++; continue; }
          if (visible(k) && box(k).area > AREA * 0.01) {
            queue.push({ node: k, depth: cur.depth + 1 });
          }
        }
      }
    }
    return killed;
  }

  /* ================= 5. 可聚焦层（保遥控器按键） =================
   *
   * v1.7：这层不再叠在视频上方（之前 z-index = PLAYER_Z+1，
   * 等于又在视频上压了一层 fixed 元素，同样是黑屏风险）。
   * 现在挪到最底层、1px、全透明 —— 只为让页面有个 focus 目标，
   * 保证按键事件链完整，绝不参与遮挡。
   */
  function ensureFocusable() {
    var f = document.getElementById('__tv_focus__');
    if (!f) {
      f = document.createElement('div');
      f.id = '__tv_focus__';
      f.setAttribute('tabindex', '0');
      f.style.cssText =
        'position:fixed!important;top:0!important;left:0!important;'
        + 'width:1px!important;height:1px!important;'
        + 'opacity:0!important;'
        + 'background:transparent!important;'
        + 'pointer-events:none!important;outline:none!important;'
        + 'z-index:-1!important;';
      (document.body || document.documentElement).appendChild(f);
    }
    try {
      var ae = document.activeElement;
      if (!ae || ae === document.body || ae === document.documentElement) f.focus();
    } catch (e) {}
  }

  /* ================= 6. 回读"正在播" ================= */

  function readProgram() {
    var best = '', bestSize = 0;
    var all = document.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length > 1) continue;
      var t = (el.textContent || '').trim();
      if (!t || t.length < 2 || t.length > 30) continue;
      if (/^\d+$/.test(t)) continue;
      var cs = getComputedStyle(el);
      if (!cs || cs.visibility === 'hidden' || cs.display === 'none') continue;
      var fs = px(cs.fontSize, 0);
      if (fs < 15 || fs <= bestSize) continue;
      var b = box(el);
      if (b.area <= 0) continue;
      bestSize = fs;
      best = t;
    }
    return best;
  }

  /* ================= 7. 换台 ================= */

  /* 找频道名的"文字节点"并点击。
   * 返回 true 表示点到了。 */
  function clickByName(sid) {
    var want = sid.replace(/[\s\-]/g, '').toLowerCase();
    if (!want) return false;
    var nodes = document.querySelectorAll('a,button,li,span,div');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.children.length > 1) continue;
      var t = (el.textContent || '').trim().toLowerCase().replace(/[\s\-]/g, '');
      if (!t || t.length > 16) continue;
      if (t === want) {
        try { el.click(); return true; } catch (e) {}
      }
    }
    return false;
  }

  /* 切换央视频频道列表的分类 Tab。
   *
   * ⚠ 实测（真实页面结构，2024 改版后）：
   *   · 频道列表宿主 .tv-main-con-r-list-left 里【始终有 73 个子项】
   *     #1~#40 是央视系（CCTV/CGTN/付费），class 后缀 -imga
   *     #41~#73 是省级卫视 + 教育台，     class 后缀 -imgb
   *   · Tab 切换靠的就是 CSS 对 a/b 两组做 display 切换：
   *       Tab1 → visibleA=40, visibleB=0
   *       Tab2 → visibleA=0,  visibleB=33
   *   · 所以"卫视播不了"的根因是：脚本只在【当前可见】的 Tab1 里找，
   *     卫视全是 display:none，根本点不到。
   *
   *   Tab 元素：.tv-main-con-r-tab-img（两个，149x60，只有图标没文字）
   *   宿主 .tv-main-con-r-tab 有 3 个子节点（2 个 tab-img + 1 个空 div），
   *   所以【不能按 children[index] 取】，必须按 .tv-main-con-r-tab-img 过滤。
   *
   * ⚠ 原生 el.click() 实测有效（Vue 委托在祖先上，捕获阶段拦截会失效，
   *   所以这里绝不包裹 stopPropagation）。
   */
  function switchTab(index) {
    var tabs = document.querySelectorAll('.tv-main-con-r-tab-img');
    if (!tabs || tabs.length <= index) return false;
    var tab = tabs[index];
    if (!tab) return false;
    try { tab.click(); return true; } catch (e) { return false; }
  }

  /* 当前显示的是哪一组：0=央视(a)，1=卫视(b)，-1=未知 */
  function currentTab() {
    var host = document.querySelector('.tv-main-con-r-list-left');
    if (!host) return -1;
    var a = 0, b = 0;
    for (var i = 0; i < host.children.length; i++) {
      var c = host.children[i];
      if (box(c).area <= 0) continue;
      var cls = (c.className && typeof c.className === 'string') ? c.className : '';
      if (/-imga/.test(cls)) a++;
      else if (/-imgb/.test(cls)) b++;
    }
    if (a > 0 && b === 0) return 0;
    if (b > 0 && a === 0) return 1;
    return -1;
  }

  /* 卫视名字特征 —— 用来判断"这次要切的是卫视，得先去 Tab2"。
   * 不写死 class，只认名字，页面改版也不怕。 */
  var SAT_HINT = /(东方卫视|湖南卫视|浙江卫视|江苏卫视|安徽卫视|山东卫视|天津卫视|广东卫视|深圳卫视|湖北卫视|四川卫视|重庆卫视|河南卫视|河北卫视|山西卫视|辽宁卫视|吉林卫视|黑龙江卫视|内蒙古卫视|陕西卫视|甘肃卫视|宁夏卫视|青海卫视|新疆卫视|西藏卫视|云南卫视|贵州卫视|广西卫视|东南卫视|江西卫视|海南卫视|中国教育电视台)/;

  /* 换台主入口。
   *
   * 顺序：
   *   1) 先在当前可见列表里按名字点（央视走这条，最快、不闪）
   *   2) 点不到 → 切到 Tab2（卫视），再按名字点
   *   3) 还点不到 → 切回 Tab1 再试一次（防止上次停在 Tab2 导致央视找不到）
   *   4) 都不行才返回失败（绝不再走 location.hash 整页跳转）
   *
   * ⚠ 切 Tab 后页面会重渲染换 DOM 节点，所以必须重新查询再点。
   */
  function switchTo(stationId, name, displayName) {
    __muteForSwitch();
    var sid = String(stationId || '').toLowerCase();
    // 优先用显示名匹配（"北京卫视""湖南卫视"），它才是页面上写的字；
    // stationId（btv1/hunan）在页面上并不出现。
    var byName = String(name || displayName || '').trim();

    // ① 当前列表直接点
    if (byName && clickByName(byName)) return { ok: true, via: 'click' };
    if (sid && clickByName(sid)) return { ok: true, via: 'click-id' };

    // ② 点不到 → 切到另一个分类再点。
    //    卫视在 Tab2，央视在 Tab1。用 currentTab() 判断当前在哪一组，
    //    避免"本来就在目标组还乱切"。
    var want = SAT_HINT.test(byName) ? 1 : 0;
    if (currentTab() !== want && switchTab(want)) {
      return { ok: false, via: 'tab-switch', retry: true };
    }

    return { ok: false, via: 'none' };
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


  /* ================= 8. 主流程 ================= */

  function apply() {
    VW = winW();
    VH = winH();
    AREA = Math.max(VW * VH, 1);

    if (!state.enabled) return { off: true };

    try {
      ensureBackdrop();        // 摘掉旧版遗留的网页内黑底（它会杀视频层）
      var p = findPlayer();
      if (p) {
        state.player = p;
        state.pinned = floatPlayer(p);   // 钉住 video 的容器（全屏关键）
        state.program = readProgram();
        state.title = (document.title || '').trim();
      }

      // v2.4：清理顺序调整 —— 先清浮层，再清文档流内容。
      // 两者各自独立调用，任何一个出问题都不影响另一个。
      var aboveKilled = 0, flowKilled = 0;
      try { aboveKilled = cleanAbove(p); } catch (e) { state.errA = String(e); }
      try { flowKilled = hideFlowContent(p); } catch (e) { state.errF = String(e); }
      try { ensureFocusable(); } catch (e) {}

      state.aboveKilled = aboveKilled;
      state.flowKilled = flowKilled;

      return { found: !!p, program: state.program, w: VW, h: VH,
               aboveKilled: aboveKilled, flowKilled: flowKilled };
    } catch (e) {
      // 任何意外都不能让整条维护链断掉 ——
      // setInterval 里如果抛异常，后面几轮就永远不会跑了。
      window.TVLive.lastError = String(e);
      return { err: String(e), found: false };
    }
  }

  /* 撤销注入：把容器和 video 上的内联样式清干净，恢复网页原样 */
  function restoreAll() {
    var props = ['position', 'top', 'left', 'right', 'bottom',
                 'width', 'height', 'max-width', 'max-height',
                 'min-width', 'min-height', 'margin', 'padding',
                 'transform', 'z-index', 'background', 'object-fit',
                 'overflow', 'display'];
    try {
      var v = document.querySelector('video');
      if (v) {
        props.forEach(function (k) { v.style.removeProperty(k); });
        var shell = findContainer(v);
        // 中间层也要清
        var mid = v.parentElement;
        var guard = 0;
        while (mid && guard < 8) {
          props.forEach(function (k) { mid.style.removeProperty(k); });
          if (shell && mid === shell) break;
          mid = mid.parentElement;
          guard++;
        }
        if (shell) {
          props.forEach(function (k) { shell.style.removeProperty(k); });
        }
      }
    } catch (e) {}
    ['__tv_backdrop__', '__tv_focus__'].forEach(function (id) {
      var e = document.getElementById(id);
      if (e && e.parentNode) e.parentNode.removeChild(e);
    });
  }


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

  window.TVLive = {
    rescan: function () { try { return apply(); } catch (e) { return { err: String(e) }; } },
    // 应急：一键撤销所有注入效果
    off: function () {
      state.enabled = false;
      state.pinned = false;
      restoreAll();
      return { off: true };
    },
    on: function () { state.enabled = true; return apply(); },
    info: function () {
      var v = document.querySelector('video');
      var playing = false, w = 0, h = 0, sw = 0, sh = 0, top = 0;
      if (v) {
        try {
          playing = !v.paused && v.currentTime > 0;
          w = v.videoWidth || 0;
          h = v.videoHeight || 0;
          var r = v.getBoundingClientRect();
          sw = Math.round(r.width); sh = Math.round(r.height); top = Math.round(r.top);
        } catch (e) {}
      }
      var cs = v ? getComputedStyle(v) : null;
      // 容器信息：用于确认"钉容器"是否生效
      var cw = 0, ch = 0, cpos = '';
      var shell = v ? findContainer(v) : null;
      if (shell) {
        try {
          var cr = shell.getBoundingClientRect();
          cw = Math.round(cr.width);
          ch = Math.round(cr.height);
          cpos = getComputedStyle(shell).position;
        } catch (e) {}
      }
      // v2.4：清理统计 —— 用于确认"页面其余部分"是否真的被清掉了。
      // 注意用【累计去重后的总数】，不是最后一次的增量：
      // 清理是幂等的，第二次调用时元素已是 none，增量会是 0，
      // 直接显示增量会让人误以为"没清理"。
      var hiddenTotal = 0;
      try {
        var allNodes = document.querySelectorAll('body *');
        for (var hi = 0; hi < allNodes.length; hi++) {
          var hn = allNodes[hi];
          if (hn.id === '__tv_focus__' || hn.id === '__tv_vp__') continue;
          if (hn.style && hn.style.display === 'none'
              && hn.style.getPropertyPriority('display') === 'important') {
            hiddenTotal++;
          }
        }
      } catch (e) {}

      return {
        program: readProgram(),
        title: (document.title || '').trim(),
        hasVideo: !!v,
        playing: playing,
        vw: w, vh: h, sw: sw, sh: sh, top: top,
        bottom: v ? Math.round(v.getBoundingClientRect().bottom) : 0,
        left: v ? Math.round(v.getBoundingClientRect().left) : 0,
        right: v ? Math.round(v.getBoundingClientRect().right) : 0,
        overflow: cs ? cs.overflow : '',
        visibility: cs ? cs.visibility : '',
        position: cs ? cs.position : '',
        mode: MODE,
        pinned: !!state.pinned,
        hasShell: !!shell,
        cw: cw, ch: ch, cpos: cpos,
        screenW: VW, screenH: VH,
        aboveKilled: state.aboveKilled || 0,
        flowKilled: state.flowKilled || 0,
        hiddenTotal: hiddenTotal,
        errA: state.errA || '',
        errF: state.errF || '',
        backdrop: !!document.getElementById('__tv_backdrop__')
      };
    },
    switchTo: function (sid, name, displayName) { return switchTo(sid, name, displayName); },

    /* 带 Tab 切换重试的换台。
     *
     * 为什么需要它：卫视在 Tab2，切 Tab 后 Vue 要重渲染，
     * 同一帧内点不到。这里自己按节奏重试，直到点到或超时。
     * 每次重试都重新查询 DOM，避免拿到已被替换的旧节点。
     *
     * 返回 {ok:true} 表示点到并已触发换台；
     *      {ok:false,err:'timeout'} 表示确实找不到。
     */
    switchToRetry: function (sid, name, displayName, done) {
      __muteForSwitch();
      var tries = 0, maxTries = 10;
      var byName = String(name || displayName || '').trim();
      function attempt() {
        tries++;
        // ① 当前列表直接点
        if (byName && clickByName(byName)) { if (done) try { done({ ok: true, via: 'click', tries: tries }); } catch (e) {} return; }
        if (sid && clickByName(String(sid))) { if (done) try { done({ ok: true, via: 'click-id', tries: tries }); } catch (e) {} return; }
        // ② 还没切过 Tab 就先切一次（按目标名判断该去哪一组）
        if (tries === 1) {
          var want = SAT_HINT.test(byName) ? 1 : 0;
          if (currentTab() !== want) switchTab(want);
        } else if (tries === 5) {
          // ③ 兜底：切另一个 Tab 再试（防止判断失误）
          var want2 = SAT_HINT.test(byName) ? 1 : 0;
          switchTab(want2 === 0 ? 1 : 0);
        }
        if (tries < maxTries) { setTimeout(attempt, 400); return; }
        if (done) try { done({ ok: false, err: 'timeout', tries: tries }); } catch (e) {}
      }
      attempt();
    },
    // 切换模式：safe / full / off
    setMode: function (m) {
      MODE = (m === 'full' || m === 'off') ? m : 'safe';
      try {
        if (MODE === 'off') {
          state.enabled = false;
          state.pinned = false;
          restoreAll();
          return { off: true, mode: MODE };
        }
        state.enabled = true;
        // 先清掉上一轮的内联样式，再按新模式重新铺 ——
        // 避免 safe/full 反复切换时旧样式残留。
        restoreAll();
        return apply();
      } catch (e) {
        return { err: String(e) };
      }
    },
    getMode: function () { return MODE; },
    lastError: ''
  };

  /* 指针能力统一挂到本命名空间（Java 侧按当前源的命名空间调用） */
  if (typeof bindPointerApi === 'function') bindPointerApi(window.TVLive);

  /* ================= 9. 持续维护 ================= */
  setInterval(function () {
    try { apply(); } catch (e) { window.TVLive.lastError = String(e); }
  }, 2000);

  window.addEventListener('resize', function () { apply(); }, false);
  window.addEventListener('load', function () { apply(); }, false);

  apply();
  setTimeout(apply, 600);
  setTimeout(apply, 1500);
  setTimeout(apply, 3000);
  setTimeout(apply, 6000);
})();
