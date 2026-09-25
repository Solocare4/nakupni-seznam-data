const registry = require('./catalog-product-images.json');

function imageKey(offer) {
  // Do not infer identity from price, category, similar spelling or package size alone.
  const name = offer.productName.normalize('NFKC').toLocaleLowerCase('cs-CZ').replace(/\s+/g, ' ').trim();
  const unit = ['g','kg'].includes(offer.unit) ? 'kg' : ['ml','l'].includes(offer.unit) ? 'l' : offer.unit;
  const quantity = ['g','ml'].includes(offer.unit) ? offer.quantity / 1000 : offer.quantity;
  return [offer.retailer, name, Math.round(quantity * 1e6) / 1e6, unit].join('|');
}

function enrichPhotos(offers) {
  return offers.map(offer => {
    const photo = registry[imageKey(offer)];
    return offer.imageUrl || !photo ? offer : {...offer, imageUrl:photo.imageUrl};
  });
}

module.exports = { imageKey, enrichPhotos };
