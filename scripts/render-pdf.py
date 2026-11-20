"""Render PDF pages to PNG for visual DOCX verification (development only)."""
from pathlib import Path
import sys
import fitz

source = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
with fitz.open(source) as document:
    for index, page in enumerate(document):
        page.get_pixmap(matrix=fitz.Matrix(1.4, 1.4), alpha=False).save(out / f"page-{index + 1}.png")
    print(f"Rendered {len(document)} pages from {source}")
