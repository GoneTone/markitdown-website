# /// script
# dependencies = ["cairosvg"]
# ///
"""
從 images/favicon.svg 產生 PWA 所需的 PNG 圖示。

使用方式：
    uv run scripts/generate_icons.py

產生檔案：
    images/icon-192.png  — manifest 用（192×192）
    images/icon-512.png  — manifest 用（512×512，含 maskable）
    images/icon-180.png  — iOS apple-touch-icon（180×180）
"""

import cairosvg
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SVG_SOURCE = PROJECT_ROOT / 'images' / 'favicon.svg'

ICONS = [
    ('icon-192.png', 192),
    ('icon-512.png', 512),
    ('icon-180.png', 180),
]

def main():
    if not SVG_SOURCE.exists():
        raise FileNotFoundError(f'找不到來源檔案：{SVG_SOURCE}')

    svg_data = SVG_SOURCE.read_bytes()

    for filename, size in ICONS:
        output_path = PROJECT_ROOT / 'images' / filename
        cairosvg.svg2png(
            bytestring=svg_data,
            write_to=str(output_path),
            output_width=size,
            output_height=size,
        )
        print(f'✓ {filename} ({size}×{size})')

    print('圖示產生完成。')

if __name__ == '__main__':
    main()
