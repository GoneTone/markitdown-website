# /// script
# dependencies = ["cairosvg"]
# ///
"""
從 images/favicon.svg 產生 PWA 所需的 PNG 圖示。

使用方式：
    uv run scripts/generate_icons.py

注意：cairosvg 需要 Cairo 系統函式庫。
  - Linux/macOS：通常已內建，直接執行即可。
  - Windows：需安裝 Cairo（libcairo-2.dll），建議改用 WSL2：
      wsl uv run scripts/generate_icons.py

產生檔案：
    images/icon-192.png  — manifest 用（192×192）
    images/icon-512.png  — manifest 用（512×512，含 maskable）
    images/icon-180.png  — iOS apple-touch-icon（180×180）
"""

import sys
import cairosvg
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SVG_SOURCE = PROJECT_ROOT / 'images' / 'favicon.svg'

ICONS: list[tuple[str, int]] = [
    ('icon-192.png', 192),
    ('icon-512.png', 512),
    ('icon-180.png', 180),
]

def main():
    if sys.platform == 'win32':
        print(
            '錯誤：cairosvg 在 Windows 上需要 Cairo 系統函式庫（libcairo-2.dll）。\n'
            '建議使用 WSL2 執行：wsl uv run scripts/generate_icons.py'
        )
        sys.exit(1)

    if not SVG_SOURCE.exists():
        raise FileNotFoundError(f'找不到來源檔案：{SVG_SOURCE}')

    svg_data = SVG_SOURCE.read_bytes()

    for filename, size in ICONS:
        output_path = PROJECT_ROOT / 'images' / filename
        try:
            cairosvg.svg2png(
                bytestring=svg_data,
                write_to=output_path,
                output_width=size,
                output_height=size,
            )
        except Exception as e:
            raise RuntimeError(f'產生 {filename} 時發生錯誤') from e
        print(f'✓ {filename} ({size}×{size})')

    print('圖示產生完成。')

if __name__ == '__main__':
    main()
