const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),manifest=require('../public/manifest.json');
const {offerIdentity}=require('./runtime/services/offers/catalogPolicy');
const validators={kaufland:'restoreCatalog',penny:'restorePennyCatalog',lidl:'restoreLidlCatalog',albert:'restoreAlbertCatalog',billa:'restoreBillaCatalog',globus:'restoreGlobusCatalog'};
for(const [key,entry] of Object.entries(manifest.catalogs)) {
 const source=key.split('/')[0],catalog=JSON.parse(fs.readFileSync(path.join(root,'public',entry.path)));
 assert.ok(require(`./runtime/services/offers/${source}/parse`)[validators[source]](catalog),key);
 assert.equal(catalog.offers.length,entry.count,key);
 assert.equal(new Set(catalog.offers.map(offerIdentity)).size,catalog.offers.length,`Duplicates: ${key}`);
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(catalog.offers)).digest('hex'),entry.catalogVersion,key);
 if(key.includes('/')) {assert.equal(catalog.storeId,key.split('/')[1]);assert.ok(catalog.offers.every(o=>o.branchId===catalog.storeId&&o.branchSpecific));}
 else assert.ok(catalog.offers.every(o=>o.branchSpecific===false));
 if(source==='lidl') {
   const {finalCatalogTitle}=require('./update-lidl.cjs');
   assert.ok(catalog.pipelineVersion>=5);
   assert.ok(catalog.offers.every(o=>finalCatalogTitle(o.productName)));
   assert.ok(catalog.offers.every(o=>!o.imageUrl||o.imageUrl.startsWith('https://imgproxy-retcat.assets.schwarz/')));
 }
}
console.log(`OK: ${Object.keys(manifest.catalogs).length} published catalogs validated, unique, hashed and branch-scoped`);
