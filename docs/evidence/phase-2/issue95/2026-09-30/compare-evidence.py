"""Compare Q17-95 screen regions and retain before component crops; no baseline writes."""
import json
import math
from pathlib import Path

from PIL import Image, ImageChops

root = Path(__file__).parent
records = []
for metadata in sorted((root / "visual/after").glob("gallery-empty-*.json")):
    result = json.loads(metadata.read_text())
    name = metadata.with_suffix(".png").name
    before = Image.open(root / "visual/before" / name).convert("RGBA")
    after = Image.open(root / "visual/after" / name).convert("RGBA")
    bounds = result["emptyStateBounds"]
    x, top = math.floor(bounds["x"]), math.floor(bounds["y"])
    right = math.ceil(bounds["x"] + bounds["width"])
    # Added block: 21.125px line + 40px button + 12px gap + 16px margin.
    # Its 89.125px layout increase moves the footer by 89 raster rows.
    bottom = math.ceil(bounds["y"] + bounds["height"] - 89.125)
    before.crop((x, top, right, bottom)).save(
        root / "visual/before" / name.replace(".png", "-component.png"))
    prefix = ImageChops.difference(before.crop((0, 0, before.width, top)),
                                  after.crop((0, 0, after.width, top)))
    changed_prefix = sum(any(pixel) for pixel in prefix.get_flattened_data())
    height_delta = 89
    tail_height = min(before.height - bottom, after.height - bottom - height_delta)
    old_bottom_tail = before.crop((0, bottom, before.width, bottom + tail_height))
    new_bottom_tail = after.crop((0, bottom + height_delta, after.width, bottom + height_delta + tail_height))
    tail = ImageChops.difference(old_bottom_tail, new_bottom_tail)
    changed_tail = sum(any(pixel) for pixel in tail.get_flattened_data())
    records.append({
        "changeId": "Q17-95", "state": "gallery-empty", "viewport": result["viewport"],
        "beforeFull": f"visual/before/{name}", "afterFull": f"visual/after/{name}",
        "beforeComponent": f"visual/before/{name.replace('.png', '-component.png')}",
        "afterComponent": f"visual/after/{name.replace('.png', '-component.png')}",
        "beforeSize": before.size, "afterSize": after.size,
        "beforeComponentRegion": [x, top, right, bottom], "afterComponentBounds": bounds,
        "unchangedHeaderIntroFiltersDifferentPixels": changed_prefix,
        "footerShiftPixels": height_delta, "alignedFooterDifferentPixels": changed_tail,
        "fullComparison": result["comparisonStatus"], "fullDifferentPixels": result["differentPixels"],
        "review": "HITL 권장안 채택; DomineYH 승인(2026-09-30, 권장안 일괄 승인); condition/button and height/wrapping only",
    })
assert len(records) == 5
(root / "source-differences.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n")
print(json.dumps([{k: record[k] for k in ["viewport", "unchangedHeaderIntroFiltersDifferentPixels", "alignedFooterDifferentPixels", "footerShiftPixels"]} for record in records]))
