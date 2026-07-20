"""把拍摄的 die-cut 贴纸照片抠成带 alpha 的 PNG。

用法：python3 tools/cutout.py 输入.jpg 输出.png [饱和度阈值] [内缩像素]

背景是有光照梯度的灰色桌面，用绝对颜色阈值会误伤；但背景整体低饱和，
而贴纸的 die-cut 描边是高饱和的黄/粉，所以用「饱和度」当键、从画面四边
flood fill。狗毛虽然也低饱和，但被闭合的黄边包住，填充进不去。

只依赖 Pillow，不需要 numpy。
"""
import sys
from collections import deque
from PIL import Image, ImageFilter

SRC = sys.argv[1]
DST = sys.argv[2]
SAT_MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 45   # 低于此饱和度视为背景
ERODE = int(sys.argv[4]) if len(sys.argv) > 4 else 2      # 向内收几像素, 吃掉投影残留

im = Image.open(SRC).convert("RGB")
W, H = im.size
px = im.load()


def sat(p):
    return max(p) - min(p)


# 1. 从四边 flood fill
bg = bytearray(W * H)          # 1 = 背景
q = deque()
for x in range(W):
    for y in (0, H - 1):
        if not bg[y * W + x] and sat(px[x, y]) <= SAT_MAX:
            bg[y * W + x] = 1
            q.append((x, y))
for y in range(H):
    for x in (0, W - 1):
        if not bg[y * W + x] and sat(px[x, y]) <= SAT_MAX:
            bg[y * W + x] = 1
            q.append((x, y))

while q:
    x, y = q.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < W and 0 <= ny < H:
            i = ny * W + nx
            if not bg[i] and sat(px[nx, ny]) <= SAT_MAX:
                bg[i] = 1
                q.append((nx, ny))

filled = sum(bg)
print(f"flood fill 覆盖 {filled}/{W * H} 像素 ({filled * 100 // (W * H)}%)")

# 2. 生成 alpha：背景透明
alpha = Image.frombytes("L", (W, H), bytes(255 if not b else 0 for b in bg))

# 3. 向内收缩，吃掉贴纸边缘外那圈投影和 JPEG 压缩色边
if ERODE > 0:
    alpha = alpha.filter(ImageFilter.MinFilter(ERODE * 2 + 1))

# 4. 轻微羽化，避免锯齿（着色器按 alpha<0.01 discard，半透明边会被保留成抗锯齿）
alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))

out = im.convert("RGBA")
out.putalpha(alpha)

# 5. 裁到实际内容的包围盒，去掉四周多余的透明边（贴纸的世界尺寸按宽高比推导，
#    留着空白会让贴纸显得比实际小，撕开的卷起线也会先在空气里走一段）
bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
print("内容包围盒", bbox)
out = out.crop(bbox)

out.save(DST)
print("已写出", DST, out.size)
