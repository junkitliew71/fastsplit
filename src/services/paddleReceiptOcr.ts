import { PaddleOCR } from '@paddleocr/paddleocr-js';

interface PaddleLine {
  poly: [number, number][];
  text: string;
  score: number;
}
export interface PaddleOcrToken {text:string;confidence:number;boundingBox:[number,number][];x:number;y:number;width:number;height:number}

export interface PaddleReceiptOcrResult {
  rawText: string;
  tsv: string;
  tokens:PaddleOcrToken[];
  metrics: {
    modelLoadMs: number;
    detectionMs: number;
    recognitionMs: number;
    totalMs: number;
    modelBytes: number;
  };
}

const receiptAsset = (path: string) =>
  new URL(`${import.meta.env.BASE_URL}ocr/paddle/${path}`, document.baseURI).toString();

function resultToTsv(lines: PaddleLine[], width: number, height: number) {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const page = `1\t1\t0\t0\t0\t0\t0\t0\t${width}\t${height}\t-1\t`;
  const rows = lines.map((line, index) => {
    const xs = line.poly.map(point => point[0]);
    const ys = line.poly.map(point => point[1]);
    const left = Math.floor(Math.min(...xs));
    const top = Math.floor(Math.min(...ys));
    const boxWidth = Math.max(1, Math.ceil(Math.max(...xs)) - left);
    const boxHeight = Math.max(1, Math.ceil(Math.max(...ys)) - top);
    return `5\t1\t1\t1\t${index + 1}\t1\t${left}\t${top}\t${boxWidth}\t${boxHeight}\t${(line.score * 100).toFixed(4)}\t${line.text}`;
  });
  return [header, page, ...rows].join('\n');
}

export async function recognizeReceiptWithPaddle(image: Blob): Promise<PaddleReceiptOcrResult> {
  const startedAt = performance.now();
  const engine = await PaddleOCR.create({
    lang: 'ch',
    ocrVersion: 'PP-OCRv5',
    textDetectionModelName: 'PP-OCRv5_mobile_det',
    textRecognitionModelName: 'PP-OCRv5_mobile_rec',
    textDetectionModelAsset: { url: receiptAsset('PP-OCRv5_mobile_det_onnx_infer.tar') },
    textRecognitionModelAsset: { url: receiptAsset('PP-OCRv5_mobile_rec_onnx_infer.tar') },
    ortOptions: {
      backend: 'wasm',
      numThreads: 1,
      simd: true,
      wasmPaths: receiptAsset('runtime-v2/'),
    },
  });
  const initializedAt = performance.now();
  try {
    const [result] = await engine.predict(image, {
      textDetLimitSideLen: 1600,
      textDetLimitType: 'max',
      textDetThresh: 0.25,
      textDetBoxThresh: 0.5,
    });
    if (!result) throw new Error('Local PaddleOCR returned no receipt result.');
    const tokens=(result.items as PaddleLine[]).map(line=>{const xs=line.poly.map(point=>point[0]),ys=line.poly.map(point=>point[1]),x=Math.floor(Math.min(...xs)),y=Math.floor(Math.min(...ys)),width=Math.max(1,Math.ceil(Math.max(...xs))-x),height=Math.max(1,Math.ceil(Math.max(...ys))-y);return{text:line.text,confidence:line.score*100,boundingBox:line.poly,x,y,width,height};});
    return {
      // PaddleOCR returns recognized lines, not a separately rewritten text
      // field. This is a direct, lossless line join for the debug panel.
      rawText: result.items.map(item => item.text).join('\n'),
      tsv: resultToTsv(result.items as PaddleLine[], result.image.width, result.image.height),
      tokens,
      metrics: {
        modelLoadMs: Math.round(initializedAt - startedAt),
        detectionMs: Math.round(result.metrics.detMs),
        recognitionMs: Math.round(result.metrics.recMs),
        totalMs: Math.round(performance.now() - startedAt),
        modelBytes: 4_843_520 + 16_701_440,
      },
    };
  } finally {
    await engine.dispose();
  }
}
