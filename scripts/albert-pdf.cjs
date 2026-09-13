const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const {extractPage} = require('./albert-layout.cjs');
const {currentAlbertPublications,parseAlbertSpreads,ALBERT_URL,restoreAlbertCatalog} = require('./runtime/services/offers/albert/parse.js');
const {categoryFor} = require('./runtime/services/offers/penny/parse.js');
async function read(url, kind='json') {
  let failure;
  for(let n=0;n<3;n++) {try {const r=await fetch(url,{signal:AbortSignal.timeout(90000),headers:{'User-Agent':'NakupniSeznamCatalog/1.0'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r[kind]();}catch(e){failure=e;}}
  throw failure;
}
exports.fetchAlbertPdfCatalog = async () => {
  const publications = currentAlbertPublications(await read(ALBERT_URL,'text')).filter(p=>/(sm|hm)_akcni_letak$/.test(p)).slice(0,8);
  const fetchedAt = new Date().toISOString();
  const results = await Promise.allSettled(publications.map(async publication=>{
    const spreads=await read(`https://letaky.albert.cz/${publication}/spreads.json`);
    const base=parseAlbertSpreads(spreads,fetchedAt,publication);
    const dates={validFrom:base.offers[0].validFrom,validTo:base.offers[0].validTo};
    const metadata=await read(`https://api.publitas.com/v1/groups/albert/publications/${publication}.json`);
    const url=new URL(metadata.config.downloadPdfUrl,'https://view.publitas.com').href;
    if(!url.startsWith('https://view.publitas.com/'))throw Error('Unexpected PDF host');
    const pdf=await pdfjs.getDocument({data:new Uint8Array(await read(url,'arrayBuffer')),disableFontFace:true}).promise;
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
  const catalog={...catalogs[0],scope:'CZ-ALL',offers:catalogs.flatMap(c=>c.offers)};
  if(!restoreAlbertCatalog(catalog))throw Error('Albert PDF validation failed');
  return catalog;
};
