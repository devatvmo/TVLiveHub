# -*- coding: utf-8 -*-
"""把台标占位文字从固定 'TV' 改为当前频道 shortName（回退 'TV'）。"""
import io, sys

P = r"C:/Users/DMJ-Office/WorkBuddy/2026-11-19-12-46-55/apktool_clean/smali/com/live/tv/MainActivity.smali"
CLS = "Lcom/live/tv/MainActivity;"
src = io.open(P, "r", encoding="utf-8").read()

old = (
    "    # [MASK-LOGO] 台标占位固定显示 \"TV\"\n"
    "    iget-object p1, p0, " + CLS + "->maskLogo:Landroid/widget/TextView;\n\n"
    "    if-eqz p1, :cond_logo_skip\n\n"
    "    const-string v1, \"TV\"\n\n"
    "    invoke-virtual {p1, v1}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V\n\n"
    "    :cond_logo_skip\n"
)

new = (
    "    # [MASK-LOGO] 台标显示当前频道 shortName，空则回退 TV\n"
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
)

if old not in src:
    print("ERROR: old fixed-TV block not found"); sys.exit(1)
src = src.replace(old, new, 1)
io.open(P, "w", encoding="utf-8").write(src)
print("OK: 台标改为当前频道 shortName（回退 TV）")
