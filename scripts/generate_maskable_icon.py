# /// script
# dependencies = ["svglib", "reportlab", "Pillow"]
# ///
"""
從 images/favicon-maskable.svg 產生 PWA maskable 圖示。

favicon-maskable.svg 規格：
  - 全方形背景（#1a1a2e，延伸至四角，無圓角）
  - 圖標內容縮放至 70% 並置中（安全區域：80% 以內）

使用方式：
    uv run scripts/generate_maskable_icon.py

產生檔案：
    images/icon-512-maskable.png
"""

import io
from pathlib import Path

from PIL import Image
from reportlab.graphics import renderPM
from svglib.svglib import svg2rlg

PROJECT_ROOT = Path(__file__).parent.parent
SOURCE = PROJECT_ROOT / 'images' / 'favicon-maskable.svg'
OUTPUT = PROJECT_ROOT / 'images' / 'icon-512-maskable.png'
TARGET_SIZE = 512


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f'找不到來源檔案：{SOURCE}')

    drawing = svg2rlg(str(SOURCE))
    if drawing is None:
        raise ValueError('SVG 解析失敗')

    # 等比縮放至 512×512
    sx = TARGET_SIZE / drawing.width
    sy = TARGET_SIZE / drawing.height
    drawing.width = TARGET_SIZE
    drawing.height = TARGET_SIZE
    drawing.transform = (sx, 0, 0, sy, 0, 0)

    # 轉換為 PNG bytes
    png_bytes = renderPM.drawToString(drawing, fmt='PNG')

    # 透過 Pillow 儲存（確保格式正確，RGB 無 alpha）
    img = Image.open(io.BytesIO(png_bytes)).convert('RGB')
    img.save(OUTPUT, 'PNG', optimize=True)

    print(f'[OK] icon-512-maskable.png ({TARGET_SIZE}x{TARGET_SIZE})')


if __name__ == '__main__':
    main()
