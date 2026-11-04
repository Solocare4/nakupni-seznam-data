// PDF.js 5 is ESM. Keep importing parser helpers cheap for pure unit tests.
let library;
function getDocument(options) {
  library ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  // PDF.js transfers the input buffer to its worker. Preserve the caller's
  // original bytes for source hashes, audit copies and subsequent readers.
  const data = options.data instanceof Uint8Array ? Uint8Array.from(options.data)
    : options.data instanceof ArrayBuffer ? options.data.slice(0) : options.data;
  return { promise: library.then(pdfjs => pdfjs.getDocument({ ...options, data, isEvalSupported: false }).promise) };
}
async function extractText(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), disableFontFace: true }).promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str ?? '').join(' '));
    }
    return { text: pages.join('\n\n'), numpages: pdf.numPages };
  } finally { await pdf.destroy(); }
}
module.exports = { getDocument, extractText };
