# FastSplit receipt annotation tool

This is a local-only annotation interface. It reads the original SROIE images,
OCR polygons, and entity JSON without changing them. New semantic labels are
saved separately under `training/fastsplit_annotations/`.

## Start with an extracted dataset

```powershell
cd training/annotation-tool
npm install
npm start -- --dataset ../dataset
```

The dataset path may point either to the directory containing `SROIE2019/` or
directly to `SROIE2019/`.

## Start directly from the supplied ZIP

No extraction is required:

```powershell
cd training/annotation-tool
npm install
npm start -- --dataset "C:\path\to\archive.zip"
```

Then open `http://127.0.0.1:4179`.

## Annotation rules

- Every displayed token is an original `box/*.txt` text region and retains its
  original four-point polygon.
- Tokens start as `UNLABELED`. The tool does not generate semantic labels.
- Select one or more tokens, select a label, then assign them.
- For `ITEM_NAME`, `QUANTITY`, `UNIT_PRICE`, and `LINE_TOTAL`, create/select an
  item group. Assignments sharing an item group form one receipt item.
- Receipt-level fields do not use an item group.
- `OTHER` is an explicit human decision; unreviewed tokens remain unlabeled.
- `Save Annotation` writes JSON locally. `Skip` and `Mark Unclear` save those
  statuses without inventing field labels.

## Stored format

An assignment groups one or more original token IDs into one semantic field:

```json
{
  "id": "a001",
  "label": "ITEM_NAME",
  "tokenIds": ["t0017", "t0018", "t0019"],
  "text": "Teh O Ais",
  "itemId": "item-001"
}
```

Assignments with the same `itemId` associate item name, quantity, unit price,
and line total. See `../fastsplit_annotations/schema.json` for the complete
schema.

