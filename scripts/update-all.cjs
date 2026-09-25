require('./network.cjs');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runtime = name => require(`./runtime/${name}.js`);
const { mergeCatalog, catalogDay } = runtime('services/offers/catalogPolicy');
const day = catalogDay();
const { enrichPhotos, imageKey } = require('./data-product-images.cjs');
const webPhotos = new Map();
const validators = {
  kaufland: runtime('services/offers/kaufland/parse').restoreCatalog,
  penny: runtime('services/offers/penny/parse').restorePennyCatalog,
  lidl: runtime('services/offers/lidl/parse').restoreLidlCatalog,
  albert: runtime('services/offers/albert/parse').restoreAlbertCatalog,
  billa: runtime('services/offers/billa/parse').restoreBillaCatalog,
  globus: runtime('services/offers/globus/parse').restoreGlobusCatalog,
};
const publicDir = path.join(root, 'public');
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const manifest = read(path.join(publicDir, 'manifest.json')) ?? { version: 1, catalogs: {} };
function atomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n'); fs.renameSync(file + '.tmp', file); }
function publish(key, incoming) {
  if (incoming?.offers) incoming = {...incoming, offers:enrichPhotos(incoming.offers).map(o => webPhotos.has(imageKey(o)) ? {...o,imageUrl:webPhotos.get(imageKey(o))} : o)};
  const source = key.split('/')[0], validate = validators[source];
  if (!validate(incoming)) throw Error(`${key}: invalid catalog`);
  if (!incoming.offers.some(o => o.validFrom <= day && o.validTo >= day)) throw Error(`${key}: no current offers`);
  const oldEntry = manifest.catalogs[key];
  const baseline = read(path.join(root, 'data/baseline', `${source}Catalog.json`));
  const oldPublished = oldEntry ? read(path.join(publicDir, oldEntry.path)) : null;
  const old = validate(baseline) && (!key.includes('/') || key.endsWith('/'+baseline.storeId)) ? (validate(oldPublished) ? mergeCatalog(baseline, oldPublished) : baseline) : oldPublished;
  let final = mergeCatalog(validate(old), incoming);
  // A parser revision may intentionally remove unsafe rows; never reintroduce them.
  if (source === 'lidl' && Number(incoming.pipelineVersion) > Number(old?.pipelineVersion ?? 0)) final = incoming;
  final.offers = final.offers.filter(o => o.validTo >= day).map(o => ({...o,currency:'CZK',branchSpecific:['kaufland','globus'].includes(source),...(['kaufland','globus'].includes(source)?{branchId:final.storeId}:{})}));
  if (!validate(final)) throw Error(`${key}: merged validation failed`);
  const catalogVersion = crypto.createHash('sha256').update(JSON.stringify(final.offers)).digest('hex');
  const relative = `catalogs/${key}/${catalogVersion}.json`;
  const generatedAt = new Date().toISOString();
  const validFrom = final.offers.map(o=>o.validFrom).sort()[0], validTo = final.offers.map(o=>o.validTo).sort().at(-1);
  const result = {...final,generatedAt,sourceUpdatedAt:incoming.fetchedAt,catalogVersion,validFrom,validTo,retailer:final.offers[0].retailer};
  if (!fs.existsSync(path.join(publicDir,relative))) atomic(path.join(publicDir,relative),result);
  manifest.catalogs[key] = {path:relative,catalogVersion,generatedAt:read(path.join(publicDir,relative)).generatedAt,validFrom,validTo,count:final.offers.length};
  console.log(`${key}: ${final.offers.filter(o=>o.validFrom<=day&&o.validTo>=day).length} current; ${final.offers.length} total; ${final.offers.filter(o=>o.imageUrl).length} photos`);
  const app = path.resolve(root,'../nakupni-seznam/data');
  if (process.argv.includes('--sync-app') && fs.existsSync(app) && (!key.includes('/') || key.endsWith('/CZ3300') || key.endsWith('/cerny-most'))) atomic(path.join(app,`${source}Catalog.json`),result);
}
function generated(source) {
  if (!process.argv.includes('--skip-generate')) {
    const file = path.join(root,`data/${source}Catalog.json`), before = fs.existsSync(file) ? fs.readFileSync(file) : null;
    const result = spawnSync(process.execPath,['--max-http-header-size=131072','--require','./scripts/network.cjs',`scripts/update-${source}.cjs`],{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:8e6});
    if (result.status !== 0) {
      if(before)fs.writeFileSync(file,before);
      throw Error(`${source}: generator failed: ${result.stderr?.slice(-1000) || result.error}`);
    }
    console.log(result.stdout.slice(-1600));
  }
  let data = read(path.join(root,`data/${source}Catalog.json`));
  if(source==='penny' && data?.source==='penny-generated') {
    const convert=runtime('services/offers/penny/fetch').generatedOfferToOffer;
    const offers=data.offers.map(convert).filter(Boolean);
    data={version:1,source:'penny',scope:'CZ',fetchedAt:data.generatedAt,offers,skipped:data.offers.length-offers.length};
  }
  publish(source,data);
}
async function main() {
  const failures=[];
  const only=process.argv.find(a=>a.startsWith('--only='))?.split('=')[1];
  for (const source of ['penny','billa'].filter(s=>!only||s===only)) {
    try { for (const [key,url] of await require('./data-web-photos.cjs').fetchPhotos(source)) webPhotos.set(key,url); }
    catch (error) { console.warn(`${source}: optional web photos unavailable: ${error.message}`); }
  }
  for(const source of ['penny','lidl'].filter(s=>!only||s===only)) { try { generated(source); } catch(e){failures.push(String(e));console.error(String(e));} }
  const branches = require('./branches.json');
  const all = process.argv.includes('--all-branches');
  const jobs=[{key:'billa',run:()=>require('./billa-multi.cjs').fetchCatalog()},{key:'albert',run:()=>require('./albert-pdf.cjs').fetchAlbertPdfCatalog()}];
  for(const b of branches.filter(b=>b.retailer==='Kaufland'&&(all||['CZ3300','CZ3710'].includes(b.sourceStoreId)))) jobs.push({key:`kaufland/${b.sourceStoreId}`,run:()=>runtime('services/offers/kaufland/fetch').fetchKauflandCatalog({storeId:b.sourceStoreId,storeName:b.name,url:`https://prodejny.kaufland.cz/nabidka/prehled.storeName%3D${b.sourceStoreId}.html`})});
  for(const b of branches.filter(b=>b.retailer==='Globus'&&(all||['globus-cerny-most','globus-brno'].includes(b.id)))) {const storeId=b.id.replace('globus-',''); jobs.push({key:`globus/${storeId}`,run:()=>runtime('services/offers/globus/fetch').fetchGlobusCatalog({storeId,storeName:b.name})});}
  if(only) for(let i=jobs.length-1;i>=0;i--) if(!jobs[i].key.startsWith(only)) jobs.splice(i,1);
  for(let i=0;i<jobs.length;i+=3) await Promise.allSettled(jobs.slice(i,i+3).map(async job=>{try{publish(job.key,await job.run());}catch(e){failures.push(`${job.key}: ${e.message}`);console.error(`${job.key}: ${e.message}`);}}));
  for (const source of ['albert','billa','lidl','penny'].filter(s=>!only||s===only)) {
    try {
      const current=read(path.join(publicDir,manifest.catalogs[source].path));
      const offers=await require('./branch-coverage.cjs').enrich(source,current.offers,branches);
      publish(source,{...current,offers});
    } catch(e){failures.push(`${source} branches: ${e.message}`);console.error(e.message);}
  }
  atomic(path.join(publicDir,'manifest.json'),manifest);
  atomic(path.join(root,'update-report.json'),{at:new Date().toISOString(),failures,catalogs:Object.keys(manifest.catalogs).length});
  if(failures.length) process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});


