"""Render invented F13.1 receipt rows to image-only PDFs and PNG reference scans.

Uses an installed font for rendering only; no font binary or real receipt is copied.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

parser = argparse.ArgumentParser()
parser.add_argument("--output", default="scratch/ocr-spike/scans")
parser.add_argument("--font", default="C:/Windows/Fonts/consola.ttf")
args = parser.parse_args()
target = Path(args.output)
target.mkdir(parents=True, exist_ok=True)
fixtures = json.loads(Path("tests/fixtures/receipts/ocr-benchmark.json").read_text(encoding="utf-8"))

for receipt in fixtures["receipts"]:
    for variant in fixtures["variants"]:
        dpi = variant["dpi"]
        margin = round(dpi * 0.12)
        font = ImageFont.truetype(args.font, round(9 * dpi / 72))
        step = round(12 * dpi / 72)
        width = round(80 / 25.4 * dpi)
        height = step * len(receipt["rows"]) + 2 * margin
        image = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(image)
        for n, row in enumerate(receipt["rows"]):
            if draw.textlength(row, font=font) > width - 2 * margin:
                raise ValueError("Fixture text exceeds paper width")
            draw.text((margin, margin + n * step), row, font=font, fill="black")
        image = ImageEnhance.Contrast(image).enhance(variant["contrast"])
        if variant["blur"]:
            image = image.filter(ImageFilter.GaussianBlur(variant["blur"]))
        if variant["angle"]:
            image = image.rotate(variant["angle"], expand=True, fillcolor="white", resample=Image.Resampling.BICUBIC)
        name = f"{receipt['id']}-{variant['id']}"
        image.save(target / f"{name}.png", dpi=(dpi, dpi))
        # The page contains only one raster image, with no hidden text/OCR layer.
        page_size = (image.width / dpi * 72, image.height / dpi * 72)
        pdf = canvas.Canvas(str(target / f"{name}.pdf"), pagesize=page_size, invariant=1)
        pdf.drawImage(ImageReader(image), 0, 0, width=page_size[0], height=page_size[1])
        pdf.showPage()
        pdf.save()
print(f"Created {len(fixtures['receipts']) * len(fixtures['variants'])} synthetic image-only PDFs")
