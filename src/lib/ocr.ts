// Browser-side OCR seam for the documents module. pdf.js renders PDF pages to
// <canvas>; tesseract.js recognizes each canvas (eng+ara for Dubai docs).
// Both heavy libs are dynamically imported INSIDE ocrFile, so Vite emits them
// into a separate lazy chunk loaded only when a user actually drops a file on
// /documents — the main `index` chunk and the Worker bundle (esbuild of
// api/boot.ts) never see them. This is the key reason the module stays
// Cloudflare-deployable: OCR is a client concern, the server stays light.
//
// Constraint: tesseract.js fetches its language traineddata (~10-40MB per
// language) from a CDN on first use. There's no offline way around that
// without bundling the traineddata (huge). Acceptable for a personal practice;
// first OCR run per language is slow as it caches.

// pdf.js worker URL — Vite resolves this as a bundled asset via the `?url`
// suffix. Resolved within the lazy chunk (ocr.ts is only ever dynamic-imported).
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type ProgressCb = (p: number, label: string) => void;

/** Recognize a PDF or image File. Returns the concatenated OCR text. */
export async function ocrFile(file: File, onProgress: ProgressCb = () => {}): Promise<string> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    return ocrPdf(file, onProgress);
  }
  return ocrImage(file, onProgress);
}

async function ocrImage(file: File, onProgress: ProgressCb): Promise<string> {
  const Tesseract = await import("tesseract.js");
  onProgress(0.02, "loading OCR engine");
  // tesseract.js accepts a File/Blob directly in the browser (ImageLike).
  const { data } = await Tesseract.recognize(file, "eng+ara", {
    logger: (m: any) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") {
        onProgress(0.1 + m.progress * 0.9, "recognizing");
      }
    },
  });
  onProgress(1, "done");
  return (data.text ?? "").trim();
}

async function ocrPdf(file: File, onProgress: ProgressCb): Promise<string> {
  // Dynamic import keeps pdf.js out of the main bundle.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const buf = await file.arrayBuffer();
  onProgress(0.02, "opening PDF");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const numPages = doc.numPages;
  let text = "";
  for (let i = 1; i <= numPages; i++) {
    const pageBase = (i - 1) / numPages;
    const pageSpan = 1 / numPages;
    onProgress(pageBase + 0.01, `rendering page ${i}/${numPages}`);
    const page = await doc.getPage(i);
    // scale 2 is a decent OCR-quality/size tradeoff; bump for tiny text.
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2d context unavailable");
    await page.render({ canvasContext: ctx, viewport }).promise;

    // OCR this page's canvas. Allocate 90% of this page's span to recognition.
    const Tesseract = await import("tesseract.js");
    const { data } = await Tesseract.recognize(canvas, "eng+ara", {
      logger: (m: any) => {
        if (m.status === "recognizing text" && typeof m.progress === "number") {
          onProgress(pageBase + pageSpan * (0.1 + m.progress * 0.9), `page ${i}/${numPages}`);
        }
      },
    });
    text += (data.text ?? "").trim() + "\n\n";
  }
  onProgress(1, "done");
  return text.trim();
}