# /// script
# dependencies = ["Pillow"]
# ///
"""
從 images/og-image.png 產生 PWA 所需的螢幕截圖。

使用方式：
    uv run scripts/generate_screenshots.py

產生檔案：
    images/screenshot-desktop.png  — 桌機截圖（1280×800，form_factor: wide）
    images/screenshot-mobile.png   — 手機截圖（390×844，無 form_factor）
"""

from pathlib import Path
from PIL import Image, ImageOps

PROJECT_ROOT = Path(__file__).parent.parent
SOURCE = PROJECT_ROOT / 'images' / 'og-image.png'
BG_COLOR = (26, 26, 26)  # #1a1a1a，與網站深色主題一致

SCREENSHOTS: list[tuple[str, int, int]] = [
    ('screenshot-desktop.png', 1280, 800),
    ('screenshot-mobile.png',   390, 844),
]


def make_screenshot(src: Image.Image, width: int, height: int) -> Image.Image:
    """將來源圖片等比縮放後置中貼到指定尺寸的深色背景上。"""
    fitted = ImageOps.contain(src, (width, height))
    canvas = Image.new('RGB', (width, height), BG_COLOR)
    offset = ((width - fitted.width) // 2, (height - fitted.height) // 2)
    canvas.paste(fitted, offset)
    return canvas


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f'找不到來源檔案：{SOURCE}')

    src = Image.open(SOURCE).convert('RGB')

    for filename, width, height in SCREENSHOTS:
        output_path = PROJECT_ROOT / 'images' / filename
        img = make_screenshot(src, width, height)
        img.save(output_path, 'PNG', optimize=True)
        print(f'[OK] {filename} ({width}x{height})')

    print('Done.')


if __name__ == '__main__':
    main()
