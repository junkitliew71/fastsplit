"""Evaluate FastSplit's parser against every annotated receipt in a SROIE ZIP."""

import argparse
import csv
import json
import re
import zipfile
from pathlib import Path

from parser.layout import reconstruct_layout
from parser.receipt_parser import parse
from parser.validation import validate_and_repair


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def block_rows(raw: bytes) -> list[dict]:
    blocks = []
    for index, line in enumerate(raw.decode("utf-8-sig", errors="replace").splitlines()):
        parts = line.split(",", 8)
        if len(parts) != 9:
            continue
        try:
            coordinates = [int(value) for value in parts[:8]]
        except ValueError:
            continue
        xs, ys = coordinates[0::2], coordinates[1::2]
        x, y = min(xs), min(ys)
        width, height = max(xs) - x, max(ys) - y
        blocks.append(
            {
                "id": index,
                "text": parts[8].strip(),
                "confidence": 1.0,
                "x": x,
                "y": y,
                "width": max(1, width),
                "height": max(1, height),
                "centerX": x + width / 2,
                "centerY": y + height / 2,
                "polygon": [],
            }
        )
    return blocks


def evaluate(archive: Path) -> tuple[dict, list[dict]]:
    rows = []
    with zipfile.ZipFile(archive) as source:
        box_names = sorted(
            name for name in source.namelist() if re.search(r"/(?:train|test)/box/[^/]+\.txt$", name)
        )
        for box_name in box_names:
            split = "train" if "/train/" in box_name else "test"
            receipt_id = Path(box_name).stem
            entity_name = box_name.replace("/box/", "/entities/")
            record = {"split": split, "receipt": receipt_id}
            try:
                blocks = block_rows(source.read(box_name))
                expected = json.loads(source.read(entity_name).decode("utf-8-sig"))
                width = max((block["x"] + block["width"] for block in blocks), default=1)
                height = max((block["y"] + block["height"] for block in blocks), default=1)
                layout = reconstruct_layout(blocks, width, height)
                parsed = parse(layout)
                validation = validate_and_repair(parsed, layout)
                expected_total_text = re.sub(r"[^0-9.-]", "", expected["total"].replace(",", ""))
                expected_total = float(expected_total_text) if expected_total_text not in {"", "-", "."} else None
                actual_total = parsed.get("grandTotal")
                company_ok = normalized(parsed.get("restaurant", "")) == normalized(expected.get("company", ""))
                total_ok = expected_total is not None and actual_total is not None and abs(actual_total - expected_total) <= 0.02
                structured = bool(parsed["items"]) and actual_total is not None
                record.update(
                    {
                        "blocks": len(blocks),
                        "items": len(parsed["items"]),
                        "restaurant": parsed.get("restaurant", ""),
                        "expected_company": expected.get("company", ""),
                        "company_ok": company_ok,
                        "actual_total": actual_total,
                        "expected_total": expected_total,
                        "total_ok": total_ok,
                        "structured": structured,
                        "internally_valid": validation["valid"],
                        "pass": structured and total_ok,
                        "error": "",
                    }
                )
            except Exception as error:  # Keep evaluating the remaining receipts.
                record.update(
                    {
                        "blocks": 0,
                        "items": 0,
                        "restaurant": "",
                        "expected_company": "",
                        "company_ok": False,
                        "actual_total": None,
                        "expected_total": None,
                        "total_ok": False,
                        "structured": False,
                        "internally_valid": False,
                        "pass": False,
                        "error": f"{type(error).__name__}: {error}",
                    }
                )
            rows.append(record)

    def count(key: str, subset: list[dict]) -> int:
        return sum(bool(row[key]) for row in subset)

    summary = {"archive": str(archive), "pass_definition": "one or more parsed items and exact annotated grand total (±RM0.02)", "splits": {}}
    for split in ("all", "train", "test"):
        subset = rows if split == "all" else [row for row in rows if row["split"] == split]
        total = len(subset)
        summary["splits"][split] = {
            "receipts": total,
            "no_exception": total - sum(bool(row["error"]) for row in subset),
            "structured": count("structured", subset),
            "grand_total_exact": count("total_ok", subset),
            "company_exact": count("company_ok", subset),
            "internally_valid": count("internally_valid", subset),
            "passed": count("pass", subset),
            "pass_rate_percent": round(count("pass", subset) / max(1, total) * 100, 2),
        }
    return summary, rows


def evaluate_real_ocr_sample(archive: Path, annotated_rows: list[dict], limit: int) -> dict:
    import cv2
    import numpy as np

    from ocr.paddle_ocr import recognize
    from ocr.preprocessing import prepare
    from ocr.quality import analyse

    results = []
    chosen = [row for row in annotated_rows if row["split"] == "test"][:limit]
    with zipfile.ZipFile(archive) as source:
        for expected in chosen:
            image_name = f'SROIE2019/test/img/{expected["receipt"]}.jpg'
            image = cv2.imdecode(np.frombuffer(source.read(image_name), dtype=np.uint8), cv2.IMREAD_COLOR)
            prepared, _ = prepare(image, analyse(image))
            blocks = recognize(prepared)
            height, width = prepared.shape[:2]
            layout = reconstruct_layout(blocks, width, height)
            parsed = parse(layout)
            validation = validate_and_repair(parsed, layout)
            expected_total = float(expected["expected_total"]) if expected["expected_total"] is not None else None
            actual_total = parsed.get("grandTotal")
            total_ok = expected_total is not None and actual_total is not None and abs(actual_total - expected_total) <= 0.02
            results.append(
                {
                    "receipt": expected["receipt"],
                    "ocr_blocks": len(blocks),
                    "items": len(parsed["items"]),
                    "actual_total": actual_total,
                    "expected_total": expected_total,
                    "total_ok": total_ok,
                    "internally_valid": validation["valid"],
                    "pass": bool(parsed["items"]) and total_ok,
                }
            )
    return {
        "receipts": len(results),
        "passed": sum(row["pass"] for row in results),
        "results": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path("debug/sroie-evaluation"))
    parser.add_argument("--real-ocr-sample", type=int, default=0)
    args = parser.parse_args()
    summary, rows = evaluate(args.archive)
    if args.real_ocr_sample:
        summary["real_ocr_sample"] = evaluate_real_ocr_sample(args.archive, rows, args.real_ocr_sample)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    with args.output.with_suffix(".csv").open("w", newline="", encoding="utf-8-sig") as target:
        writer = csv.DictWriter(target, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
