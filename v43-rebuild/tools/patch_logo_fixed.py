# -*- coding: utf-8 -*-
"""
修复版台标补丁（解决启动崩溃）：
原版把台标代码插在 buildMask 中间，污染了原代码还要用的 v2/v3
（v2 被赋成 maskLayer 对象，原代码 .line764 却把它当 int 传给
 setGravity(I) → 类型冲突 → VerifyError → 一开 App 就崩）。

本版改为：
  - 台标创建代码整体插到 buildMask 末尾（root.addView 之后、return-void 之前），
    此时原代码已用完所有寄存器，随便用；
  - 用 addView(view, params, 0) 把台标插到 maskLayer 顶部，视觉顺序不变；
  - showMask 里的台标文字赋值移到方法最末尾（return-void 之前），
    同样避开原代码对 v0/v1/v2 的使用。
"""
import io, os, sys

P = r"C:/Users/DMJ-Office/WorkBuddy/2026-11-19-12-46-55/apktool_fixed/smali/com/live/tv/MainActivity.smali"
CLS = "Lcom/live/tv/MainActivity;"
src = io.open(P, "r", encoding="utf-8").read()

if "->maskLogo:" in src:
    print("SKIP: 已打过台标补丁"); sys.exit(0)

# 1) 新增字段
fa = ".field private maskHint:Landroid/widget/TextView;\n"
if fa not in src:
    print("ERROR: field anchor not found"); sys.exit(1)
src = src.replace(fa, fa + ".field private maskLogo:Landroid/widget/TextView;\n", 1)

# 2) buildMask: .locals 6 -> 8（台标代码放在末尾，用 v6/v7 不与原代码 v0-v5 冲突）
bm = ".method private buildMask()V\n    .locals 6\n"
if bm not in src:
    print("ERROR: buildMask locals anchor not found"); sys.exit(1)
src = src.replace(bm, ".method private buildMask()V\n    .locals 8\n", 1)

# 3) buildMask 末尾（root.addView 之后、return-void 之前）插入台标创建
tail_anchor = (
    "    invoke-virtual {v0, v1, v2}, Landroid/widget/FrameLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V\n\n"
    "    return-void\n.end method"
)
logo_create = (
    "    invoke-virtual {v0, v1, v2}, Landroid/widget/FrameLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V\n\n"
    "    # [MASK-LOGO-FIX] 台标占位（方法末尾，避开原代码寄存器）\n"
    "    new-instance v6, Landroid/graphics/drawable/GradientDrawable;\n\n"
    "    invoke-direct {v6}, Landroid/graphics/drawable/GradientDrawable;-><init>()V\n\n"
    "    const/4 v7, 0x1\n\n"
    "    invoke-virtual {v6, v7}, Landroid/graphics/drawable/GradientDrawable;->setShape(I)V\n\n"
    "    const v7, -0xd0b09\n\n"
    "    invoke-virtual {v6, v7}, Landroid/graphics/drawable/GradientDrawable;->setColor(I)V\n\n"
    "    const/high16 v7, 0x41a00000    # 20.0f\n\n"
    "    invoke-virtual {v6, v7}, Landroid/graphics/drawable/GradientDrawable;->setCornerRadius(F)V\n\n"
    "    new-instance v7, Landroid/widget/TextView;\n\n"
    "    invoke-direct {v7, p0}, Landroid/widget/TextView;-><init>(Landroid/content/Context;)V\n\n"
    "    iput-object v7, p0, " + CLS + "->maskLogo:Landroid/widget/TextView;\n\n"
    "    const-string v0, \"TV\"\n\n"
    "    invoke-virtual {v7, v0}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V\n\n"
    "    const v0, -0x1\n\n"
    "    invoke-virtual {v7, v0}, Landroid/widget/TextView;->setTextColor(I)V\n\n"
    "    const/high16 v0, 0x41c00000    # 24.0f\n\n"
    "    const/4 v1, 0x0\n\n"
    "    invoke-virtual {v7, v1, v0}, Landroid/widget/TextView;->setTextSize(IF)V\n\n"
    "    const/16 v0, 0x11\n\n"
    "    invoke-virtual {v7, v0}, Landroid/widget/TextView;->setGravity(I)V\n\n"
    "    invoke-virtual {v7, v6}, Landroid/widget/TextView;->setBackground(Landroid/graphics/drawable/Drawable;)V\n\n"
    "    const/16 v0, 0x6e    # 110dp\n\n"
    "    invoke-direct {p0, v0}, " + CLS + "->dp(I)I\n\n"
    "    move-result v6\n\n"
    "    const/16 v0, 0x6e    # 110dp\n\n"
    "    invoke-direct {p0, v0}, " + CLS + "->dp(I)I\n\n"
    "    move-result v7\n\n"
    "    new-instance v0, Landroid/widget/LinearLayout$LayoutParams;\n\n"
    "    invoke-direct {v0, v6, v7}, Landroid/widget/LinearLayout$LayoutParams;-><init>(II)V\n\n"
    "    const/16 v1, 0x14    # 20dp bottomMargin\n\n"
    "    invoke-direct {p0, v1}, " + CLS + "->dp(I)I\n\n"
    "    move-result v1\n\n"
    "    iput v1, v0, Landroid/widget/LinearLayout$LayoutParams;->bottomMargin:I\n\n"
    "    iget-object v1, p0, " + CLS + "->maskLayer:Landroid/widget/LinearLayout;\n\n"
    "    iget-object v2, p0, " + CLS + "->maskLogo:Landroid/widget/TextView;\n\n"
    "    const/4 v3, 0x0    # index=0 插到顶部\n\n"
    "    invoke-virtual {v1, v2, v3, v0}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;)V\n\n"
    "    return-void\n.end method"
)
if tail_anchor not in src:
    print("ERROR: buildMask tail anchor not found"); sys.exit(1)
src = src.replace(tail_anchor, logo_create, 1)

# 4) showMask 末尾插入台标文字赋值（避开原代码 v0/v1/v2）
# 定位 showMask 的结尾：postDelayed 之后 return-void
s_tail = (
    "    const-wide/16 v1, 0x1770\n\n"
    "    invoke-virtual {p1, v0, v1, v2}, Landroid/os/Handler;->postDelayed(Ljava/lang/Runnable;J)Z\n\n"
    "    return-void\n.end method"
)
s_new = (
    "    const-wide/16 v1, 0x1770\n\n"
    "    invoke-virtual {p1, v0, v1, v2}, Landroid/os/Handler;->postDelayed(Ljava/lang/Runnable;J)Z\n\n"
    "    # [MASK-LOGO-FIX] 台标显示当前频道 shortName，空则回退 TV\n"
    "    iget-object p1, p0, " + CLS + "->maskLogo:Landroid/widget/TextView;\n\n"
    "    if-eqz p1, :cond_logo_skip\n\n"
    "    iget v1, p0, " + CLS + "->currentIndex:I\n\n"
    "    invoke-static {v1}, Lcom/live/tv/ChannelTable;->get(I)Lcom/live/tv/ChannelTable$Channel;\n\n"
    "    move-result-object v1\n\n"
    "    const-string v2, \"TV\"\n\n"
    "    if-eqz v1, :cond_logo_apply\n\n"
    "    iget-object v2, v1, Lcom/live/tv/ChannelTable$Channel;->shortName:Ljava/lang/String;\n\n"
    "    :cond_logo_apply\n"
    "    invoke-virtual {p1, v2}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V\n\n"
    "    :cond_logo_skip\n"
    "    return-void\n.end method"
)
if s_tail not in src:
    print("ERROR: showMask tail anchor not found"); sys.exit(1)
src = src.replace(s_tail, s_new, 1)

io.open(P, "w", encoding="utf-8").write(src)
print("OK: 修复版台标补丁已注入")
print("  maskLogo 字段:", src.count(".field private maskLogo"))
print("  末尾创建标记:", src.count("[MASK-LOGO-FIX] 台标占位"))
print("  末尾赋值标记:", src.count("[MASK-LOGO-FIX] 台标显示"))
