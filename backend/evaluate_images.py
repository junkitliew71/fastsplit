"""Run FastSplit's complete local OCR pipeline against one or more receipt images."""

import argparse
import json
from pathlib import Path

import cv2

from main import _candidate_rank, _needs_enhanced, _understand
from ocr.paddle_ocr import recognize
from ocr.preprocessing import prepare
from ocr.quality import analyse


def evaluate(path: Path) -> dict:
    image = cv2.imread(str(path))
    if image is None:
        return {"image": str(path), "error": "IMAGE_DECODE_FAILED"}
    quality = analyse(image)
    if quality["fatal"]:
        return {"image": str(path), "quality": quality, "error": quality["fatal"][0]}

    prepared, operations = prepare(image, quality)
    primary = _understand(prepared, recognize(prepared), quality)
    candidates = [("NORMAL", operations, primary)]
    if _needs_enhanced(primary):
        enhanced, enhanced_operations = prepare(image, quality, True)
        candidates.append(("ENHANCED", enhanced_operations, _understand(enhanced, recognize(enhanced), quality)))

    name, operations, selected = max(candidates, key=lambda candidate: _candidate_rank(candidate[2]))
    parsed = selected["parsed"]
    return {
        "image": str(path),
        "selectedPass": name,
        "operations": operations,
        "quality": quality,
        "blockCount": len(selected["blocks"]),
        "restaurant": parsed["restaurant"],
        "items": [
            {key: value for key, value in item.items() if key != "sourceBlockIds"}
            for item in parsed["items"]
        ],
        "subtotal": parsed["subtotal"],
        "grandTotal": parsed["grandTotal"],
        "validation": selected["validation"],
        "confidence": selected["confidence"],
        "diagnostics": parsed.get("diagnostics", {}),
        "layoutRows": [
            {
                "text": row["text"],
                "centerY": round(row["centerY"], 1),
                "blocks": [
                    {"id": block["id"], "text": block["text"], "centerX": round(block["centerX"], 1)}
                    for block in row["blocks"]
                ],
            }
            for row in selected["layout"]["rows"]
        ],
        "passes": [
            {
                "name": candidate_name,
                "rank": round(_candidate_rank(candidate), 4),
                "blocks": len(candidate["blocks"]),
                "items": len(candidate["parsed"]["items"]),
                "valid": candidate["validation"]["valid"],
            }
            for candidate_name, _, candidate in candidates
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("images", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = {"receipts": [evaluate(path) for path in args.images]}
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
