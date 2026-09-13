"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDateKey = localDateKey;
exports.isOfferValid = isOfferValid;
function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function validDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const date = new Date(`${value}T12:00:00`);
    return Number.isFinite(date.getTime()) && localDateKey(date) === value;
}
function isOfferValid(offer, today) {
    return validDateKey(offer.validFrom) && validDateKey(offer.validTo) &&
        offer.validFrom <= today && today <= offer.validTo;
}
