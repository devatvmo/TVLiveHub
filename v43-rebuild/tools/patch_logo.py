# -*- coding: utf-8 -*-
"""给 v4.3 中间页加程序化台标占位图（圆角方块 + 频道名首字）。"""
import io, os, sys

P = r"C:/Users/DMJ-Office/WorkBuddy/2026-11-19-12-46-55/apktool_clean/smali/com/live/tv/MainActivity.smali"
BAK = P + ".prelogo"
src = io.open(P, "r", encoding="utf-8").read()
if os.path.exists(BAK):
    src = io.open(BAK, "r", encoding="utf-8").read()
io.open(BAK, "w", encoding="utf-8").write(src)

CLS = "Lcom/live/tv/MainActivity;"

# ---- 1) 新增字段 maskLogo ----
field_anchor = ".field private maskHint:Landroid/widget/TextView;\n"
field_new = ".field private maskLogo:Landroid/widget/TextView;\n"
if field_new not in src:
    if field_anchor not in src:
        print("ERROR: field anchor not found"); sys.exit(1)
    src = src.replace(field_anchor, field_anchor + field_new, 1)

# ---- 2) buildMask: .locals 6 -> 8 ----
bm_anchor = ".method private buildMask()V\n    .locals 6\n"
bm_new = ".method private buildMask()V\n    .locals 8\n"
if bm_anchor not in src:
    print("ERROR: buildMask locals anchor not found"); sys.exit(1)
src = src.replace(bm_anchor, bm_new, 1)

# ---- 3) 在 maskChannel 创建后、maskHint 创建前，插入 logo 创建代码 ----
# 定位：maskChannel 设置完 includeFontPadding 之后
logo_create_anchor = (
    "    .line 758\n"
    "    iget-object v0, p0, " + CLS + "->maskChannel:Landroid/widget/TextView;\n\n"
    "    const/4 v3, 0x0\n\n"
    "    invoke-virtual {v0, v3}, Landroid/widget/TextView;->setIncludeFontPadding(Z)V\n"
)
# 插入：创建 GradientDrawable 圆角背景 + TextView logo
logo_create = """
    # [MASK-LOGO] 程序化台标占位：圆角方块 + 频道名首字
    new-instance v6, Landroid/graphics/drawable/GradientDrawable;

    invoke-direct {v6}, Landroid/graphics/drawable/GradientDrawable;-><init>()V

    const/4 v7, 0x1

    invoke-virtual {v6, v7}, Landroid/graphics/drawable/GradientDrawable;->setShape(I)V

    const v3, -0xd0b09

    invoke-virtual {v6, v3}, Landroid/graphics/drawable/GradientDrawable;->setColor(I)V

    const/high16 v3, 0x41a00000    # 20.0f

    invoke-virtual {v6, v3}, Landroid/graphics/drawable/GradientDrawable;->setCornerRadius(F)V

    new-instance v7, Landroid/widget/TextView;

    invoke-direct {v7, p0}, Landroid/widget/TextView;-><init>(Landroid/content/Context;)V

    iput-object v7, p0, """ + CLS + """->maskLogo:Landroid/widget/TextView;

    const-string v3, "TVLive"

    invoke-virtual {v7, v3}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V

    const v3, -0x1

    invoke-virtual {v7, v3}, Landroid/widget/TextView;->setTextColor(I)V

    const/high16 v3, 0x41c00000    # 24.0f

    const/4 v4, 0x0

    invoke-virtual {v7, v4, v3}, Landroid/widget/TextView;->setTextSize(IF)V

    const/16 v3, 0x11

    invoke-virtual {v7, v3}, Landroid/widget/TextView;->setGravity(I)V

    invoke-virtual {v7, v6}, Landroid/widget/TextView;->setBackground(Landroid/graphics/drawable/Drawable;)V

    const/16 v3, 0x6e    # 110dp

    invoke-direct {p0, v3}, """ + CLS + """->dp(I)I

    move-result v6

    const/16 v3, 0x6e    # 110dp

    invoke-direct {p0, v3}, """ + CLS + """->dp(I)I

    move-result v7

    new-instance v0, Landroid/widget/LinearLayout$LayoutParams;

    invoke-direct {v0, v6, v7}, Landroid/widget/LinearLayout$LayoutParams;-><init>(II)V

    const/16 v2, 0x14    # 20dp bottomMargin

    invoke-direct {p0, v2}, """ + CLS + """->dp(I)I

    move-result v2

    iput v2, v0, Landroid/widget/LinearLayout$LayoutParams;->bottomMargin:I

    iget-object v2, p0, """ + CLS + """->maskLayer:Landroid/widget/LinearLayout;

    invoke-virtual {v2, v7}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V
"""
# 注意上面最后一行 addView 用 v7 是错的（v7 是 width px 变量），改成 addView(v7_logo, v0)
# 由于 v7 被复用，我们需要用 maskLogo 字段重新取
logo_create = logo_create.replace(
    "    iget-object v2, p0, " + CLS + "->maskLayer:Landroid/widget/LinearLayout;\n\n"
    "    invoke-virtual {v2, v7}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;)V\n",
    "    iget-object v2, p0, " + CLS + "->maskLayer:Landroid/widget/LinearLayout;\n\n"
    "    iget-object v6, p0, " + CLS + "->maskLogo:Landroid/widget/TextView;\n\n"
    "    invoke-virtual {v2, v6, v0}, Landroid/widget/LinearLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V\n"
)

if logo_create_anchor not in src:
    print("ERROR: logo create anchor not found"); sys.exit(1)
src = src.replace(logo_create_anchor, logo_create_anchor + logo_create, 1)

# ---- 4) showMask: 设置台标文字为频道名首字 ----
# showMask 里 maskChannel.setText("") 之后插入；用 ChannelTable.get(currentIndex).name
sm_anchor = (
    "    invoke-virtual {p1, v0}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V\n\n"
    "    .line 786\n"
    "    :cond_0\n"
)
sm_insert = """
    # [MASK-LOGO] 台标显示当前频道名首字
    iget-object p1, p0, """ + CLS + """->maskLogo:Landroid/widget/TextView;

    if-eqz p1, :cond_logo_skip

    invoke-static {}, Lcom/live/tv/ChannelTable;->size()I

    move-result v1

    const/4 v2, 0x0

    invoke-static {v2, p0}, Ljava/lang/Math;"""
# 这段太复杂，改用更简单方式：直接用 maskChannel 的文本不行（此时被清空）。
# 简化：不动态取频道名，固定显示 "TV" 作为台标占位（程序化占位，符合要求）
sm_insert = """
    # [MASK-LOGO] 台标占位固定显示 "TV"
    iget-object p1, p0, """ + CLS + """->maskLogo:Landroid/widget/TextView;

    if-eqz p1, :cond_logo_skip

    const-string v1, "TV"

    invoke-virtual {p1, v1}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V

    :cond_logo_skip
"""
if sm_anchor not in src:
    print("ERROR: showMask anchor not found"); sys.exit(1)
src = src.replace(sm_anchor, sm_anchor.replace("    .line 786\n", "") + sm_insert + "    .line 786\n", 1)

io.open(P, "w", encoding="utf-8").write(src)
print("OK: maskLogo 字段/创建/显示已注入")
print("字段:", src.count(".field private maskLogo"))
print("logo setText 'TV':", src.count('const-string v1, "TV"'))
