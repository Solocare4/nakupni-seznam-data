const assert=require('node:assert/strict');
const b=require('./update-billa.cjs'),p=require('./update-penny.cjs');
assert.equal(b.conditionalText('Při koupi 2 ks'),true);
assert.equal(b.clubText('s BILLA klubem'),true);
assert.equal(b.plausibleTitle('Tchibo Espresso zrnková káva'),true);
assert.throws(()=>b.slugDates('neplatne'));
assert.equal(b.slugDates('velky-letak-9-9-15-9-2026').validTo,'2026-09-15');
assert.equal(p.unitInfo(20,'m').dimension,'length');
assert.equal(p.invalidOfferName('VYROBENO V ČR'),true);
console.log('OK: BILLA conditions, titles, dates and PENNY units/title regressions');
const {mergeCatalog}=require('./runtime/services/offers/catalogPolicy');
const row={id:'albert-same-publication',source:'albert',retailer:'Albert',productName:'Máslo',quantity:250,unit:'g',validFrom:'2026-09-09',validTo:'2026-09-15',price:39.9,verification:'pdf-layout-v1'};
const merged=mergeCatalog(null,{fetchedAt:'2026-09-13T12:00:00Z',offers:[row,{...row,price:34.9,verification:undefined}]});
assert.equal(merged.offers.length,1);assert.equal(merged.offers[0].price,39.9);
console.log('OK: Albert conflicting source revision');


const {selectPublicationSlug}=require('./update-billa.cjs');
const html='https://view.publitas.com/billa-cz/velky-letak-16-9-22-9-2026/page/1 https://view.publitas.com/billa-cz/maly-letak-16-9-22-9-2026/page/1';
assert.equal(selectPublicationSlug(html,'https://www.billa.cz/letaky-billa?tab=letaky-billa/maly-letak'),'maly-letak-16-9-22-9-2026');
assert.equal(selectPublicationSlug(html,'https://www.billa.cz/letaky-billa?tab=letaky-billa/velky-letak'),'velky-letak-16-9-22-9-2026');
assert.throws(()=>selectPublicationSlug(html,'https://www.billa.cz/akcni-letaky/special-bilovec'));
assert.throws(()=>selectPublicationSlug(html+' https://view.publitas.com/billa-cz/maly-letak-23-9-29-9-2026','https://www.billa.cz/letaky-billa?tab=letaky-billa/maly-letak'));
console.log('OK: BILLA selects exact format, rejects missing and ambiguous publications');
