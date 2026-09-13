const assert = require('assert/strict');
const {
  isPromoOrLegalText,
  isMeasurementOnlyText,
  hasBrandSignal,
  isWeakPackagedTitle,
  isBrandOnlyTitle,
  relevantName,
} = require('./update-lidl.cjs');

assert.equal(isPromoOrLegalText('Kč. Standardní cena'), true);
assert.equal(relevantName('Kč. Standardní cena'), false);
assert.equal(isMeasurementOnlyText('ø 9 cm, ↑ 23 cm'), true);
assert.equal(relevantName('ø 9 cm, ↑ 23 cm'), false);

assert.equal(isWeakPackagedTitle('Kokosová tyčinka'), true);
assert.equal(isWeakPackagedTitle('světlý ležák, retro edice,'), true);
assert.equal(isWeakPackagedTitle('SVIJANSKÝ MÁZ světlý ležák, retro edice'), false);
assert.equal(hasBrandSignal('SVIJANSKÝ MÁZ světlý ležák'), true);
assert.equal(hasBrandSignal('ARGUS Nealko'), true);
assert.equal(hasBrandSignal('ROSHEN Oplatky'), true);
assert.equal(isWeakPackagedTitle('Brambory přílohové'), false);
assert.equal(isWeakPackagedTitle('Cibulka lahůdková svazek'), false);
assert.equal(isWeakPackagedTitle('Sýrový preclík / Pizza kapsa'), false);

console.log('[LIDL-DATA] title validation tests OK');

assert.equal(relevantName('-20 Kč *'), false);
assert.equal(relevantName('-80 Kč'), false);
assert.equal(relevantName('-200 Kč'), false);
assert.equal(isBrandOnlyTitle("LAY'S"), true);
assert.equal(isBrandOnlyTitle('MATTONI'), true);
assert.equal(isBrandOnlyTitle('ARGUS Nealko'), false);
assert.equal(relevantName('ARGUS Nealko'), true);

const { isTechnicalOrCampaignTitle, finalCatalogTitle } = require('./update-lidl.cjs');
assert.equal(isTechnicalOrCampaignTitle('• výkon: 1 600 W'), true);
assert.equal(isTechnicalOrCampaignTitle('12V Li-Ion (2 Ah)'), true);
assert.equal(isTechnicalOrCampaignTitle('-500 Kč 2499.- *'), true);
assert.equal(finalCatalogTitle('-500 Kč 2499.- *'), false);
assert.equal(finalCatalogTitle('Ceny v klidu'), false);
assert.equal(finalCatalogTitle('• sací výkon: 250 Airwatt'), false);
assert.equal(finalCatalogTitle("LAY'S"), false);
assert.equal(finalCatalogTitle('ARGUS Nealko'), true);
assert.equal(finalCatalogTitle('Cibulka lahůdková svazek'), true);
assert.equal(finalCatalogTitle('PILOS Smetana ke šlehání'), true);
assert.equal(finalCatalogTitle('KUBÍK RAUCH Waterrr My Tea ledový čaj'), false);
assert.equal(finalCatalogTitle('BOŽKOV Republica Exclusive RADEGAST Ryze hořká 12'), false);
console.log('[LIDL-DATA] final catalog quality tests OK');

for (const title of ['-500 Kč','Kč. Standardní cena','Ceny v klidu','12V Li-Ion (2 Ah)','výkon: 1600 W','ø 9 cm ↑ 23 cm','Tyčinka',"LAY'S",'PILOS Smetana LACRUM Mléko']) assert.equal(finalCatalogTitle(title), false, title);
const { enrichOffersFromHtml } = require('./update-lidl.cjs');
const item = {productName:'PILOS Smetana',price:19.9,quantity:200,unit:'g'};
enrichOffersFromHtml([item],[{name:'PIKOK Vařená šunka',price:19.9,pack:{quantity:200,unit:'g'},imageUrl:'https://imgproxy-retcat.assets.schwarz/other.jpg'}]);
assert.equal(item.imageUrl, undefined, 'Same price and pack must never identify a different product');

const {pageValidity}=require('./update-lidl.cjs');
assert.deepEqual(pageValidity('Od pátku 11. 9. do 13. 9.',{validFrom:'2026-09-10',validTo:'2026-09-13'}),{validFrom:'2026-09-11',validTo:'2026-09-13'});
assert.equal(finalCatalogTitle('A: upevňovací lano (18 m),'),false);
