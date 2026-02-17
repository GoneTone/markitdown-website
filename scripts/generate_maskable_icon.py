# /// script
# dependencies = ["Pillow"]
# ///
"""
產生 PWA maskable 圖示（icon-512-maskable.png）。

Maskable 圖示規格：
  - 安全區域（safe zone）：圖示中心半徑為圖示尺寸 40% 的圓形範圍
  - 重要視覺內容必須完全在安全區域內（即圖示中心 80% × 80% 的區域）
  - 背景必須延伸至四角（不能有透明角落）

做法：
  - 以品牌色（#1a1a2e）填滿 512×512 正方形背景
  - 將 icon-512.png 縮放至 80%（409×409）後置中貼上
  - 縮放過的圖示內容即落在安全區域內，角落由背景色補滿

使用方式：
    uv run scripts/generate_maskable_icon.py

產生檔案：
    images/icon-512-maskable.png
"""

from pathlib import Path
from PIL import Image

PROJECT_ROOT = Path(__file__).parent.parent
SOURCE = PROJECT_ROOT / 'images' / 'icon-512.png'
OUTPUT = PROJECT_ROOT / 'images' / 'icon-512-maskable.png'

SIZE = 512
SAFE_ZONE_RATIO = 0.8  # 內容縮放至 80%，確保落在安全區域內
BG_COLOR = (26, 26, 46)  # #1a1a2e，與 favicon.svg 背景色一致


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f'找不到來源檔案：{SOURCE}（請先執行 generate_icons.py）')

    icon = Image.open(SOURCE).convert('RGBA')

    # 縮放至 80% 使內容落在安全區域內
    inner_size = round(SIZE * SAFE_ZONE_RATIO)
    icon_resized = icon.resize((inner_size, inner_size), Image.LANCZOS)

    # 建立實心背景（無透明，maskable 必要條件）
    canvas = Image.new('RGBA', (SIZE, SIZE), (*BG_COLOR, 255))

    # 置中貼上，透明部分由背景色填補
    offset = (SIZE - inner_size) // 2
    canvas.alpha_composite(icon_resized, dest=(offset, offset))

    # 存為 RGB PNG（無 alpha，符合 maskable 最佳實踐）
    canvas.convert('RGB').save(OUTPUT, 'PNG', optimize=True)
    print(f'[OK] icon-512-maskable.png ({SIZE}x{SIZE}, inner content {inner_size}x{inner_size})')


if __name__ == '__main__':
    main()
