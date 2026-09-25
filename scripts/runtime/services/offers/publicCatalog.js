"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clean = exports.object = void 0;
exports.safeImage = safeImage;
exports.restorePublicCatalog = restorePublicCatalog;
exports.nuxtData = nuxtData;
const productImages_1 = require("./productImages");
const offerValidity_1 = require("../../utils/offerValidity");
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
exports.object = object;
const clean = (value) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim().slice(0, 600) : '';
exports.clean = clean;
function safeImage(value, source) {
    if (typeof value !== 'string')
        return;
    if ((0, productImages_1.isCatalogProductImage)(value))
        return value;
    try {
        const url = new URL(value);
        const allowed = source === 'globus' ? ['gapi.globus.cz'] : ['images.cdn.europe-west1.gcp.commercetools.com'];
        if (url.protocol === 'https:' && !url.username && !url.password && allowed.includes(url.hostname))
            return value;
    }
    catch { }
}
function restorePublicCatalog(value, source, storeId) {
    const data = (0, exports.object)(value);
    if (data.version !== 1 || data.source !== source || typeof data.fetchedAt !== 'string' || !Number.isFinite(Date.parse(data.fetchedAt)) ||
        typeof data.storeId !== 'string' || !/^[a-z0-9-]+$/.test(data.storeId) || (storeId && data.storeId !== storeId) ||
        typeof data.partial !== 'boolean' || !Number.isInteger(data.skipped) || Number(data.skipped) < 0 ||
        !Array.isArray(data.offers) || !data.offers.length || data.offers.length > 3000)
        return null;
    const valid = data.offers.every(raw => {
        const item = (0, exports.object)(raw);
        const sourceUrlValid = (() => {
            if (typeof item.sourceUrl !== 'string')
                return false;
            if (source === 'globus') {
                return item.sourceUrl === `https://www.globus.cz/${data.storeId}/hypermarket/akcni-nabidka`;
            }
            try {
                const url = new URL(item.sourceUrl);
                return (url.protocol === 'https:' &&
                    !url.username &&
                    !url.password &&
                    url.hostname === 'www.billa.cz' &&
                    (url.pathname === '/' || url.pathname.startsWith('/letaky-billa/') || url.pathname === '/akcni-letaky' || url.pathname === '/letaky-billa' || /^\/akcni-letaky\/special-[a-z0-9-]+$/.test(url.pathname)));
            }
            catch {
                return false;
            }
        })();
        return item.source === source && item.retailer === (source === 'billa' ? 'Billa' : 'Globus') && sourceUrlValid &&
            typeof item.id === 'string' && item.id.startsWith(`${source}-`) && typeof item.productKey === 'string' && item.productKey.startsWith(`${source}-`) &&
            typeof item.productName === 'string' && item.productName.length > 0 && item.productName.length <= 600 && typeof item.category === 'string' && typeof item.subcategory === 'string' &&
            typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 && item.price < 1000000 &&
            (item.regularPrice === undefined || typeof item.regularPrice === 'number' && Number.isFinite(item.regularPrice) && item.regularPrice > item.price) &&
            typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 10000 && ['g', 'kg', 'ml', 'l', 'ks'].includes(String(item.unit)) &&
            typeof item.validFrom === 'string' && typeof item.validTo === 'string' && (0, offerValidity_1.isOfferValid)(raw, item.validFrom) &&
            (item.soldByWeight === undefined || typeof item.soldByWeight === 'boolean') &&
            (item.imageUrl === undefined || safeImage(item.imageUrl, source) === item.imageUrl);
    });
    return valid ? data : null;
}
/** Decode data only; never evaluate the scripts published by the retailer. */
function nuxtData(html) {
    if (html.length > 10000000)
        throw new Error('Příliš velká stránka nabídky.');
    const raw = html.match(/<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    const data = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(data) || data.length > 100000)
        throw new Error('Neznámý formát nabídky.');
    const entries = data;
    let visited = 0;
    function decode(index, depth = 0) {
        if (++visited > 100000)
            throw new Error('Příliš složitá data nabídky.');
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= entries.length || depth > 30)
            return null;
        const value = entries[index];
        if (Array.isArray(value)) {
            if (typeof value[0] === 'string')
                return ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'].includes(value[0]) ? decode(value[1], depth + 1) : null;
            return value.map(item => decode(item, depth + 1));
        }
        if (value && typeof value === 'object')
            return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, ref]) => [key, decode(ref, depth + 1)]));
        return value;
    }
    return { data, decode };
}
