const { imageKey } = require('./data-product-images.cjs');
const { nuxtData } = require('./runtime/services/offers/publicCatalog.js');

/** Read optional photos independently from prices and promotion conditions. */
function photoEntries(html, retailer) {
  const {data, decode} = nuxtData(html);
  const photos = new Map();
  const ambiguous = new Set();
  for (const node of data) {
    if (!node || typeof node !== 'object' || typeof node.images !== 'number' || typeof node.name !== 'number') continue;
    const productName = decode(node.name), quantity = Number(decode(node.amount)), unit = decode(node.volumeLabelShort);
    const images = decode(node.images);
    if (typeof productName !== 'string' || !Number.isFinite(quantity) || quantity <= 0 || !['g','kg','ml','l','ks','m'].includes(unit) || !Array.isArray(images)) continue;
    const url = images.find(value => typeof value === 'string' && value.startsWith('https://images.cdn.europe-west1.gcp.commercetools.com/'));
    if (!url) continue;
    const key = imageKey({retailer,productName,quantity,unit});
    if (photos.has(key) && photos.get(key) !== url) ambiguous.add(key);
    photos.set(key, url);
  }
  for (const key of ambiguous) photos.delete(key);
  return photos;
}

async function fetchPhotos(source) {
  const url = source==='penny' ? 'https://www.penny.cz/nabidky?tab=akcni-polozky' : 'https://www.billa.cz/';
  const response = await fetch(url, {signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw Error(`Photo source HTTP ${response.status}`);
  return photoEntries(await response.text(), source==='penny' ? 'Penny' : 'Billa');
}

module.exports = { photoEntries, fetchPhotos };
