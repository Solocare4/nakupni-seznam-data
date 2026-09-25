"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCatalogProductImage = isCatalogProductImage;
/** Only our immutable, content-addressed catalog photos are allowed here. */
function isCatalogProductImage(value) {
    return typeof value === 'string' && /^https:\/\/raw\.githubusercontent\.com\/Solocare4\/nakupni-seznam-data\/main\/public\/product-images\/[a-f0-9]{64}\.png$/.test(value);
}
