# FastSplit Dataset Inspection Report

Date inspected: 2026-09-11  
Source inspected: `C:\Users\liewj\Downloads\archive.zip`  
Archive size: 874,643,738 bytes (approximately 834.1 MiB)

> Note: `training/dataset/` did not exist in the checked-out FastSplit workspace at inspection time. The supplied `archive.zip` was inspected directly and completely without extracting it. No training was started, and no FastSplit application code was changed as part of this dataset inspection.

## Executive summary

The archive contains the SROIE 2019 receipt dataset, with 973 JPEG receipt images and a complete one-to-one pairing of image, OCR-box annotation, and entity annotation. It is useful for receipt text detection/recognition and for extracting merchant, address, date, and grand total. It is **not sufficient by itself for FastSplit's bill-item extraction task**, because it does not provide structured item rows or semantic labels for quantity, unit price, line total, subtotal, tax, service charge, or discount.

The recommended use is as an OCR/layout evaluation or fine-tuning source. FastSplit would still need a separate restaurant-focused annotation layer that links each item row to its quantity, unit price, and line total and labels all bill-level charges.

## 1. Files and folders

The archive contains 2,925 files and expands to 1,016,463,701 bytes (approximately 969.4 MiB).

```text
SROIE2019/
├── layoutlm-base-uncased/
│   ├── config.json
│   ├── pytorch_model.bin
│   ├── special_tokens_map.json
│   ├── tokenizer_config.json
│   ├── training_args.bin
│   └── vocab.txt
├── train/
│   ├── img/       626 JPG files
│   ├── box/       626 TXT files
│   └── entities/  626 TXT files
└── test/
    ├── img/       347 JPG files
    ├── box/       347 TXT files
    └── entities/  347 TXT files
```

File-type totals:

| Extension | Count | Purpose |
|---|---:|---|
| `.jpg` | 973 | Receipt images |
| `.txt` | 1,947 | 973 box files, 973 entity files, and one LayoutLM vocabulary |
| `.json` | 3 | LayoutLM configuration/tokenizer metadata |
| `.bin` | 2 | LayoutLM PyTorch weights and training arguments |

The bundled LayoutLM directory occupies 453,288,451 bytes. Its `config.json` describes a 12-layer, 768-hidden-size model with `num_labels: 2`; it is model material, not additional FastSplit item-level annotations.

## 2. Receipt image count and integrity

There are **973 receipt images**:

- Train: 626
- Test: 347
- Duplicate image IDs across train and test: 0
- Images missing a matching box annotation: 0
- Images missing a matching entity annotation: 0
- Orphan box annotations: 0
- Orphan entity annotations: 0

All 973 JPEGs were opened successfully during inspection. Dimensions range from 435 to 4,961 pixels wide and 605 to 7,016 pixels high. The images are therefore not normalized to one resolution.

## 3. Annotation formats

### OCR/layout annotation: `box/*.txt`

Each non-empty line is comma-separated:

```text
x1,y1,x2,y2,x3,y3,x4,y4,transcribed text
```

The first eight values describe a four-corner polygon, followed by the text inside that region. This preserves spatial layout. It is generally a text-line or text-region annotation rather than a guaranteed word-level token annotation.

Across the complete dataset:

- Train box lines: 33,626
- Test box lines: 18,705
- Total annotated text regions: **52,331**
- Malformed box lines: **0**

### Entity annotation: `entities/*.txt`

Despite the `.txt` extension, each file contains a JSON object. The available semantic keys are:

```json
{
  "company": "...",
  "date": "...",
  "address": "...",
  "total": "..."
}
```

All 973 entity files contain valid JSON. One train annotation, `X51005663280`, lacks `address`; one train annotation, `X51005433522`, has an empty `total`. The remaining semantic values are populated.

## 4. FastSplit field coverage

“Present as OCR text” means the value may appear somewhere in the box transcription. It does **not** mean the dataset identifies its role or links it to an item row.

| Required information | Present? | Annotation quality |
|---|---|---|
| OCR text | Yes | 52,331 transcribed text regions |
| Bounding boxes | Yes | Four-point polygon for every transcribed region |
| Item names | Partially | Visible in OCR text, but not labelled as item names |
| Quantities | Partially | Visible in OCR text, but not linked to items |
| Unit prices | Partially | Visible in OCR text, but not semantically labelled or linked |
| Line totals | Partially | Amounts appear in item-area OCR, but are not labelled as line totals |
| Subtotal | Partially | Appears as OCR text in 245 receipts; no structured field |
| Tax / GST / SST | Partially | Appears as OCR text in 949 receipts; no structured field |
| Service charge | Very limited | Matching text appears in 24 receipts; no structured field |
| Discount | Partially | Matching text appears in 299 receipts; no structured field |
| Grand total | Yes | Structured `total` for 972/973 receipts, plus OCR text |

The entity JSON does not contain arrays of items. It also has no keys for `quantity`, `unit_price`, `line_total`, `subtotal`, `tax`, `service_charge`, or `discount`.

Keyword occurrence counts above describe only whether the corresponding wording appears in a receipt's OCR annotation. They are not reliable semantic ground truth, because values such as `3.50` are not assigned to a field or item.

## 5. Three example annotations

### Example A — `X00016469612`

Entity annotation:

```json
{
  "company": "BOOK TA .K (TAMAN DAYA) SDN BHD",
  "date": "25/12/2018",
  "address": "NO.53 55,57 & 59, JALAN SAGU 18, TAMAN DAYA, 81100 JOHOR BAHRU, JOHOR.",
  "total": "9.00"
}
```

Selected box annotations:

```text
159,570,396,570,396,584,159,584,KF MODELLING CLAY KIDDY FISH
77,598,113,598,113,613,77,613,1 PC
202,597,245,597,245,612,202,612,9.000
411,596,443,596,443,613,411,613,9.00
```

Explanation: the polygons and transcriptions contain an apparent item name, quantity, price, and amount. However, the dataset never declares that these four regions belong to one item or assigns field names to them. A FastSplit training conversion would have to infer that relationship or add it manually.

### Example B — `X00016469619`

Entity annotation:

```json
{
  "company": "INDAH GIFT & HOME DECO",
  "date": "19/10/2018",
  "address": "27, JALAN DEDAP 13, TAMAN JOHOR JAYA, 81100 JOHOR BAHRU, JOHOR.",
  "total": "60.30"
}
```

Selected box annotations:

```text
22,591,257,591,257,613,22,613,GF-TABLE LAMP/STITCH <I>
196,615,222,615,222,636,196,636,1
233,610,292,610,292,634,233,634,55.90
312,612,376,612,376,635,312,635,55.90
216,642,270,642,270,661,216,661,10.00%
318,641,378,641,378,662,318,662,-5.59
```

Explanation: this receipt includes a recognisable item row and discount values. The final entity JSON labels only the receipt total; it does not expose the discount or item structure. This is useful OCR/layout evidence but incomplete bill semantics.

### Example C — `X00016469620`

Entity annotation:

```json
{
  "company": "MR D.I.Y. (JOHOR) SDN BHD",
  "date": "12-01-19",
  "address": "LOT 1851-A & 1851-B, JALAN KPB 6, KAWASAN PERINDUSTRIAN BALAKONG, 43300 SERI KEMBANGAN, SELANGOR (MR DIY TESCO TERBAU)",
  "total": "33.90"
}
```

Selected box annotations:

```text
15,394,371,394,371,417,15,417,AIR PRESSURE SPRAYER SX-575-1 1.5L
245,438,258,438,258,458,245,458,1
296,439,343,439,343,459,296,459,8.02
364,436,413,436,413,460,364,460,8.02
16,667,216,667,216,688,16,688,ROUNDING ADJUSTMENT
345,667,436,667,436,689,345,689,-RM 0.02
```

Explanation: multiple item rows and rounding are visible and spatially annotated. Again, only `company`, `date`, `address`, and final `total` are structured. Item membership, column roles, and rounding are not semantic labels.

## 6. Suitability for FastSplit

### Suitable uses

- Evaluating or improving local OCR text recognition on Malaysian receipts.
- Training/evaluating text-region detection because quadrilateral boxes are supplied.
- Testing receipt layout reconstruction from coordinates.
- Merchant, date, address, and grand-total extraction.
- Pretraining a general receipt encoder before fine-tuning on a FastSplit-specific dataset.

### Important limitations

- No structured list of receipt items.
- No relationship annotation connecting item name, quantity, unit price, and line total.
- No structured subtotal, service charge, tax, discount, or rounding fields.
- The examples are predominantly general retail receipts; the schema has no restaurant category label or restaurant-specific bill structure.
- Box annotations are text-region based, not consistently word-token based.
- A large bundled LayoutLM/PyTorch model is not directly browser-compatible with FastSplit's current ONNX Runtime Web OCR pipeline.
- One missing address and one empty grand total need handling if the entity labels are used.

### Verdict

**Useful, but not sufficient as FastSplit's primary training dataset.**

It is a strong supporting dataset for OCR detection, transcription, and generic Malaysian receipt layout. For FastSplit's required output, create an additional restaurant receipt annotation format such as:

```json
{
  "items": [
    {
      "name": "...",
      "quantity": 1,
      "unitPrice": 3.50,
      "lineTotal": 3.50,
      "boxes": {
        "name": [0, 0, 0, 0],
        "quantity": [0, 0, 0, 0],
        "unitPrice": [0, 0, 0, 0],
        "lineTotal": [0, 0, 0, 0]
      }
    }
  ],
  "subtotal": null,
  "serviceCharge": null,
  "tax": null,
  "discount": null,
  "grandTotal": 0.00
}
```

Those labels should be attached to the original polygons or to explicit row/column relationships. This would allow separate evaluation of OCR recognition, layout reconstruction, and FastSplit semantic parsing without relying on receipt keywords.

## Inspection status

- Training started: **No**
- FastSplit app modified: **No**
- Dataset extracted into workspace: **No**
- Report created: `training/DATASET_REPORT.md`
