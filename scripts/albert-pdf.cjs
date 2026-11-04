const pdfjs = require('./pdf-reader.cjs');
const {extractPage} = require('./albert-layout.cjs');
const {restoreAlbertCatalog} = require('./runtime/services/offers/albert/parse.js');
const {categoryFor} = require('./runtime/services/offers/penny/parse.js');
const {albertPublications,fetchAlbertOverview} = require('./albert-publications.cjs');
async function read(url, kind='json') {
  let failure;
  for(let n=0;n<3;n++) {try {const r=await fetch(url,{signal:AbortSignal.timeout(90000),headers:{'User-Agent':'NakupniSeznamCatalog/1.0'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r[kind]();}catch(e){failure=e;}}
  throw failure;
}
exports.fetchAlbertPdfCatalog = async () => {
  const publications = albertPublications(await fetchAlbertOverview());
  const fetchedAt = new Date().toISOString();
  const results = await Promise.allSettled(publications.map(async ({publication,...dates})=>{
    const base={version:1,source:'albert',fetchedAt,scope:'CZ-ALL',publication,skipped:0,pipelineVersion:2};
    const metadata=await read(`https://api.publitas.com/v1/groups/albert/publications/${publication}.json`);
    const url=new URL(metadata.config.downloadPdfUrl,'https://view.publitas.com').href;
    if(!url.startsWith('https://view.publitas.com/'))throw Error('Unexpected PDF host');
    const pdf=await pdfjs.getDocument({ isEvalSupported: false,data:new Uint8Array(await read(url,'arrayBuffer')),disableFontFace:true}).promise;
    const offers=[];
    try {for(let i=1;i<=pdf.numPages;i++) {
      const page=await pdf.getPage(i),viewport=page.getViewport({scale:1}),content=await page.getTextContent();
      const items=content.items.filter(t=>t.str?.trim()).map(t=>({t:t.str,x:t.transform[4],y:viewport.height-t.transform[5],w:t.width,h:t.height,f:t.fontName}));
      offers.push(...extractPage({items,height:viewport.height,number:i},dates,publication).map(o=>({...o,category:categoryFor(o.productName),flyerUrl:`${url}#page=${i}`,flyerPage:i})));
    }}finally{await pdf.destroy();}
    console.log(`Albert ${publication}: ${offers.length} PDF offers`);
    return {...base,offers};
  }));
  const catalogs=results.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
  if(!catalogs.length)throw Error(`Albert PDFs unavailable: ${results.map(r=>r.reason?.message).join('; ')}`);
  const catalog={...catalogs[0],scope:'CZ-ALL',partial:results.some(r=>r.status==='rejected'),offers:catalogs.flatMap(c=>c.offers)};
  if(!restoreAlbertCatalog(catalog))throw Error('Albert PDF validation failed');
  return catalog;
};
