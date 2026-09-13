"""Evaluate FastSplit's receipt parser against canonical CORD annotations in a ZIP."""

import argparse
import csv
import json
import re
import zipfile
from pathlib import Path

from parser.layout import reconstruct_layout
from parser.receipt_parser import parse
from parser.validation import validate_and_repair


def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def amount(value: str) -> float | None:
    cleaned = re.sub(r"[^0-9,.-]", "", value)
    if not cleaned or cleaned in {"-", ".", ","}:
        return None
    if re.fullmatch(r"-?\d{1,3}(?:[.,]\d{3})+", cleaned):
        cleaned = cleaned.replace(",", "").replace(".", "")
    else:
        cleaned = cleaned.replace(",", ".")
    try:
        return float(cleaned)
    except ValueError:
        return None


def text_of(line: dict, values_only: bool = False) -> str:
    words = [word for word in line.get("words", []) if not values_only or not word.get("is_key")]
    return " ".join(word.get("text", "") for word in words).strip()


def parse_annotation(data: dict) -> tuple[list[dict], list[dict], float | None]:
    blocks = []
    menu: dict[int, dict] = {}
    grand_total = None
    for line in data.get("valid_line", []):
        category = line.get("category", "")
        group = int(line.get("group_id", -1))
        if category.startswith("menu."):
            item = menu.setdefault(group, {"name": "", "quantity": 1, "total": None, "y": float("inf")})
            value = text_of(line, values_only=True) or text_of(line)
            if category == "menu.nm":
                item["name"] = value
            elif category == "menu.cnt":
                parsed_quantity = amount(value)
                item["quantity"] = max(1, int(parsed_quantity or 1))
            elif category in {"menu.price", "menu.sub_price"}:
                item["total"] = amount(value)
        if category == "total.total_price":
            grand_total = amount(text_of(line, values_only=True) or text_of(line))
        for word in line.get("words", []):
            quad = word.get("quad", {})
            xs = [quad.get(f"x{i}", 0) for i in range(1, 5)]
            ys = [quad.get(f"y{i}", 0) for i in range(1, 5)]
            x, y = min(xs), min(ys)
            width, height = max(xs) - x, max(ys) - y
            item = menu.get(group)
            if item is not None:
                item["y"] = min(item["y"], y)
            blocks.append({"id":len(blocks),"text":word.get("text", ""),"confidence":1.0,"x":x,"y":y,"width":max(1,width),"height":max(1,height),"centerX":x+width/2,"centerY":y+height/2,"polygon":[]})
    expected_items = [item for item in sorted(menu.values(), key=lambda row: row["y"]) if item["name"] and item["total"] is not None]
    return blocks, expected_items, grand_total


def scale_to_expected(actual: float | None, expected: float | None) -> float | None:
    if actual is None or expected is None or actual == 0:
        return None
    for factor in (0.001, 0.01, 0.1, 1.0, 10.0, 100.0, 1000.0):
        if abs(actual * factor - expected) <= max(0.02, abs(expected) * 0.00001):
            return factor
    return None


def item_score(actual: list[dict], expected: list[dict], scale: float | None) -> tuple[int, bool]:
    if scale is None:
        return 0, False
    matched = 0
    used: set[int] = set()
    for wanted in expected:
        candidates = [
            (index, item)
            for index, item in enumerate(actual)
            if index not in used
            and abs(float(item["totalPrice"]) * scale - float(wanted["total"])) <= max(0.02, abs(float(wanted["total"])) * 0.00001)
            and int(item["quantity"]) == int(wanted["quantity"])
        ]
        if candidates:
            used.add(candidates[0][0])
            matched += 1
    return matched, bool(expected) and matched == len(expected) and len(actual) == len(expected)


def evaluate(archive: Path) -> tuple[dict, list[dict]]:
    rows = []
    with zipfile.ZipFile(archive) as source:
        annotations = sorted(name for name in source.namelist() if re.fullmatch(r"CORD/CORD/(?:train|dev|test)/json/receipt_\d+\.json", name))
        for name in annotations:
            split = name.split("/")[2]
            receipt = Path(name).stem
            record = {"split": split, "receipt": receipt}
            try:
                data = json.loads(source.read(name).decode("utf-8-sig"))
                blocks, expected_items, expected_total = parse_annotation(data)
                size = data.get("meta", {}).get("image_size", {})
                width = int(size.get("width") or max((block["x"] + block["width"] for block in blocks), default=1))
                height = int(size.get("height") or max((block["y"] + block["height"] for block in blocks), default=1))
                layout = reconstruct_layout(blocks, width, height)
                parsed = parse(layout)
                validation = validate_and_repair(parsed, layout)
                actual_total = parsed.get("grandTotal")
                scale = scale_to_expected(actual_total, expected_total)
                matched_items, all_items_exact = item_score(parsed["items"], expected_items, scale)
                total_ok = scale is not None
                record.update({"expected_items":len(expected_items),"actual_items":len(parsed["items"]),"matched_items":matched_items,"all_items_exact":all_items_exact,"expected_total":expected_total,"actual_total":actual_total,"accepted_scale":scale,"total_ok":total_ok,"internally_valid":validation["valid"],"pass":all_items_exact and total_ok,"error":""})
            except Exception as error:
                record.update({"expected_items":0,"actual_items":0,"matched_items":0,"all_items_exact":False,"expected_total":None,"actual_total":None,"accepted_scale":None,"total_ok":False,"internally_valid":False,"pass":False,"error":f"{type(error).__name__}: {error}"})
            rows.append(record)

    summary = {"archive":str(archive),"dataset":"CORD canonical train/dev/test","pass_definition":"all item quantities and amounts plus grand total match; currency labels and uniform x10/x100/x1000 scale are ignored","splits":{}}
    for split in ("all", "train", "dev", "test"):
        subset = rows if split == "all" else [row for row in rows if row["split"] == split]
        total = len(subset)
        passed = sum(bool(row["pass"]) for row in subset)
        expected_count = sum(int(row["expected_items"]) for row in subset)
        matched_count = sum(int(row["matched_items"]) for row in subset)
        summary["splits"][split] = {"receipts":total,"no_exception":total-sum(bool(row["error"]) for row in subset),"receipts_with_items":sum(int(row["actual_items"])>0 for row in subset),"grand_total_exact":sum(bool(row["total_ok"]) for row in subset),"expected_items":expected_count,"matched_items":matched_count,"item_match_percent":round(matched_count/max(1,expected_count)*100,2),"passed":passed,"pass_rate_percent":round(passed/max(1,total)*100,2)}
    return summary, rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("--output", type=Path, default=Path("debug/cord-evaluation"))
    args = parser.parse_args()
    summary, rows = evaluate(args.archive)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.with_suffix(".json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    with args.output.with_suffix(".csv").open("w", newline="", encoding="utf-8-sig") as target:
        writer = csv.DictWriter(target, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
