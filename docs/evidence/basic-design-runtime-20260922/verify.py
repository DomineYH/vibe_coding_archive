#!/usr/bin/env python3
"""Verify saved evidence; optionally compare a fresh HAR replay at pixel level."""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def read(path):
    return json.loads(path.read_text())


def verify(candidate=None):
    counts = {}
    for kind, expected in [("baseline", 1), ("reference", 130)]:
        folder = HERE / kind
        run = read(folder / "run.json")
        assert run["sourcesUnchanged"] and not run["pageerrors"]
        assert not run["failed"] and not run["blockedRequests"]
        assert not [c for c in run["console"] if c["type"] == "error"]
        assert len(run["captures"]) == expected
        manifest = read(folder / "sources.json")
        assert len(manifest) == 11
        for item in manifest:
            assert hashlib.sha256((ROOT / item["path"]).read_bytes()).hexdigest() == item["sha256"], item["path"]
        for item in run["captures"]:
            p = folder / item["file"]
            metrics = read(p.with_suffix(".json"))
            with Image.open(p) as im:
                assert im.width == metrics["viewport"]["width"] and im.height >= metrics["viewport"]["height"]
                im.verify()
            assert metrics["fontStatus"] == "loaded" and metrics["LRMatchesGlobal"]
            assert metrics["actualHeadingFonts"] and all(f["familyName"] == "Pretendard Variable" and f["isCustomFont"] for f in metrics["actualHeadingFonts"])
        with zipfile.ZipFile(folder / "cdn.har.zip") as archive:
            assert archive.testzip() is None
            har = json.loads(archive.read("har.har"))
            assert all(e["response"]["status"] in [200, 302] for e in har["log"]["entries"])
            for e in har["log"]["entries"]:
                body = e["response"]["content"].get("_file")
                if body:
                    assert len(archive.read(body)) == e["response"]["content"]["size"]
        counts[kind] = {"states": expected, "pngs": len(list(folder.rglob("*.png"))), "sourceFiles": 11}
    for p in HERE.rglob("*.png"):
        with Image.open(p) as im:
            im.verify()
    assert (HERE / "thumbnail-original.webp").read_bytes() == (ROOT / "basic_design/.thumbnail").read_bytes()
    with Image.open(HERE / "thumbnail-original.webp") as im:
        assert im.format == "WEBP" and im.size == (640, 358)
        im.verify()
    with zipfile.ZipFile(HERE / "reference/cdn.har.zip") as archive:
        assets = read(HERE / "cdn-assets.json")
        for item in assets["assets"]:
            if item["archiveMember"]:
                assert hashlib.sha256(archive.read(item["archiveMember"])).hexdigest() == item["sha256"]
        assert len(assets["sriChecks"]) == 3 and all(item["match"] for item in assets["sriChecks"])
    for line in (HERE / "SHA256SUMS").read_text().splitlines():
        digest, name = line.split("  ", 1)
        assert hashlib.sha256((HERE / name).read_bytes()).hexdigest() == digest, name
    result = {"artifacts": counts, "integrity": "PASS"}
    if candidate:
        run = read(candidate / "run.json")
        assert run["mode"] == "replay" and len(run["captures"]) == 130
        assert run["sourcesUnchanged"] and not run["failed"] and not run["pageerrors"] and not run["blockedRequests"]
        assert not [c for c in run["console"] if c["type"] == "error"]
        different = []
        images = list((HERE / "reference").rglob("*.png"))
        stable_keys = ["screen", "viewport", "dpr", "date", "widths", "outsideViewport", "internalOverflow",
                       "gridColumns", "text", "inputValues", "svgCount", "LRMatchesGlobal",
                       "actualHeadingFonts", "colors", "state"]
        for item in run["captures"]:
            relative = Path(item["file"]).with_suffix(".json")
            a = read(HERE / "reference" / relative)
            b = read(candidate / relative)
            assert all(a[k] == b[k] for k in stable_keys), str(relative)
        for p in images:
            relative = p.relative_to(HERE / "reference")
            with Image.open(p).convert("RGB") as a, Image.open(candidate / relative).convert("RGB") as b:
                assert a.size == b.size, str(relative)
                diff = ImageChops.difference(a, b)
                if diff.getbbox():
                    different.append({"file": str(relative), "bounds": diff.getbbox(),
                        "pixels": sum(pixel != (0, 0, 0) for pixel in diff.get_flattened_data()),
                        "maxChannelDelta": max(hi for lo, hi in diff.getextrema())})
        result["replay"] = {"pixelIdentical": len(images) - len(different), "different": different,
                            "stableMetricsIdentical": 130, "networkFailures": 0,
                            "exactPixelCheck": "FAIL" if different else "PASS",
                            "visualApproval": "not assessed"}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if candidate:
        assert not different, "Exact pixel differences are recorded above; no tolerance is approved."


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path)
    verify(parser.parse_args().candidate)
