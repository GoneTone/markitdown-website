#!/usr/bin/env python3
"""
MarkItDown Website 建置腳本
============================
此腳本會下載所有必要的檔案，讓網站可以在瀏覽器中離線執行文件轉換。

使用方式：
    python scripts/download_wheels.py

執行前請確認：
    - Python 3.10 或以上版本（輸入 python --version 確認）
    - pip 已安裝（輸入 pip --version 確認）
    - 網路連線（第一次執行需要下載約 400MB 資料）

執行一次即可，檔案會快取在 pyodide/ 和 wheels/ 目錄中。
"""

import os
import sys
import json
import shutil
import subprocess
import urllib.request
import tarfile
from pathlib import Path

# ── 設定 ────────────────────────────────────────────────────────────────────

# Pyodide 版本（如需更新，請至 https://github.com/pyodide/pyodide/releases 確認最新版本）
PYODIDE_VERSION = "0.26.4"

# 根目錄（此腳本的上一層）
ROOT_DIR = Path(__file__).parent.parent.resolve()
PYODIDE_DIR = ROOT_DIR / "pyodide"
WHEELS_DIR = ROOT_DIR / "wheels"
SCRIPTS_DIR = ROOT_DIR / "scripts"

# 需要額外下載的套件（不在 Pyodide 內建套件清單中的純 Python 套件）
EXTRA_PACKAGES = [
    "markitdown[docx,xlsx,pptx,pdf]",
    "html2text",
    "ebooklib",
]

# ── 工具函式 ─────────────────────────────────────────────────────────────────

def log(msg):
    print(f"[建置] {msg}", flush=True)

def check_prerequisites():
    """確認執行環境符合需求。"""
    log("檢查執行環境...")
    if sys.version_info < (3, 10):
        print(f"錯誤：需要 Python 3.10 或以上版本，目前版本為 {sys.version}")
        sys.exit(1)
    log(f"Python {sys.version.split()[0]} ✓")

def download_file(url, dest_path):
    """下載單一檔案並顯示進度。"""
    def reporthook(count, block_size, total_size):
        if total_size > 0:
            percent = min(100, count * block_size * 100 // total_size)
            print(f"\r  下載中... {percent}%", end="", flush=True)

    log(f"下載：{url}")
    urllib.request.urlretrieve(url, dest_path, reporthook)
    print()  # 換行

def download_pyodide():
    """下載 Pyodide 發行包並解壓至 pyodide/ 目錄。"""
    if PYODIDE_DIR.exists() and (PYODIDE_DIR / "pyodide.js").exists():
        log("pyodide/ 目錄已存在，跳過下載。（如需重新下載，請先刪除 pyodide/ 目錄）")
        return

    tarball_name = f"pyodide-{PYODIDE_VERSION}.tar.bz2"
    tarball_path = SCRIPTS_DIR / tarball_name
    url = f"https://github.com/pyodide/pyodide/releases/download/{PYODIDE_VERSION}/{tarball_name}"

    log(f"開始下載 Pyodide {PYODIDE_VERSION}（約 400MB，僅需下載一次）...")
    download_file(url, tarball_path)

    log("解壓縮中...")
    with tarfile.open(tarball_path, "r:bz2") as tar:
        tar.extractall(ROOT_DIR)

    # Pyodide 解壓後目錄名為 "pyodide"，與我們的目標一致
    tarball_path.unlink()
    log(f"Pyodide {PYODIDE_VERSION} 解壓完成 ✓")

def download_extra_wheels():
    """下載 markitdown 及其依賴的純 Python wheel 檔案。"""
    WHEELS_DIR.mkdir(exist_ok=True)

    log("下載 markitdown 及相關套件...")
    tmp_dir = WHEELS_DIR / "_tmp"
    tmp_dir.mkdir(exist_ok=True)

    # 使用 pip download 下載套件（僅下載 wheel 格式）
    cmd = [
        sys.executable, "-m", "pip", "download",
        "--dest", str(tmp_dir),
        "--only-binary=:all:",
        "--quiet",
        *EXTRA_PACKAGES,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"錯誤：pip download 失敗：\n{result.stderr}")
        sys.exit(1)

    # 只保留純 Python wheel（檔名包含 "none-any"，代表無平台相依性）
    kept = []
    skipped = []
    for whl in tmp_dir.glob("*.whl"):
        filename = whl.name
        # 純 Python wheel 的標籤格式：...-py3-none-any.whl 或 ...-cp3xx-none-any.whl
        if "none-any" in filename or filename.endswith("-py3-none-any.whl"):
            dest = WHEELS_DIR / filename
            shutil.move(str(whl), str(dest))
            kept.append(filename)
        else:
            # 平台相依的套件由 Pyodide 內建版本處理，不需要額外下載
            skipped.append(filename)
            whl.unlink()

    shutil.rmtree(tmp_dir)

    if skipped:
        log(f"跳過 {len(skipped)} 個平台相依套件（將使用 Pyodide 內建版本）：")
        for s in skipped:
            log(f"  - {s}")

    log(f"保留 {len(kept)} 個純 Python wheel ✓")
    return kept

def write_manifest(wheel_filenames):
    """產生 wheels/manifest.json，供 Web Worker 讀取。"""
    manifest_path = WHEELS_DIR / "manifest.json"
    manifest = sorted(wheel_filenames)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"已產生 wheels/manifest.json（共 {len(manifest)} 個套件）✓")

# ── 主程式 ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  MarkItDown Website 建置腳本")
    print("=" * 60)

    check_prerequisites()
    download_pyodide()

    existing_wheels = [f.name for f in WHEELS_DIR.glob("*.whl")] if WHEELS_DIR.exists() else []
    if existing_wheels:
        log(f"wheels/ 已有 {len(existing_wheels)} 個套件，跳過下載。（如需重新下載，請先刪除 wheels/ 目錄）")
        write_manifest(existing_wheels)
    else:
        new_wheels = download_extra_wheels()
        write_manifest(new_wheels)

    print()
    print("=" * 60)
    print("  建置完成！")
    print()
    print("  後續步驟：")
    print("  1. 將整個目錄部署至 Nginx 伺服器")
    print("  2. 使用 nginx.conf 中的設定範本設定虛擬主機")
    print()
    print("  本地測試（需要 Python）：")
    print("  python -m http.server 8080 --directory .")
    print("  然後開啟 http://localhost:8080")
    print("=" * 60)
