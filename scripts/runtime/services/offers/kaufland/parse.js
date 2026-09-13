"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultKauflandStore = exports.KAUFLAND_STORE = exports.KAUFLAND_URL = void 0;
exports.parsePack = parsePack;
exports.parseKauflandHtml = parseKauflandHtml;
exports.restoreCatalog = restoreCatalog;
const offerValidity_1 = require("../../../utils/offerValidity");
exports.KAUFLAND_URL = 'https://prodejny.kaufland.cz/nabidka/prehled.html';
exports.KAUFLAND_STORE = 'Kaufland Praha-Vypich';
exports.defaultKauflandStore = { storeId: 'CZ3300', storeName: exports.KAUFLAND_STORE, url: exports.KAUFLAND_URL };
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const clean = (value) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 600) : '';
const normal = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Explicit packs and multipacks only. Never choose one amount from a range or alternatives.
function parsePack(value) {
    if (typeof value !== 'string')
        return null;
    const match = value.trim().match(/^(?:cena za\s+)?(?:(\d+)\s*[x×]\s*)?(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|ks|kus|kusy|kusů|kapslí)(?:\s+(?:balení(?: síť)?|plech|láhev|PET(?: láhev)?|(?:ne)?vratná láhev|Tetra Pak|Bag in Box)|\s*=\s*\d+\s+pracích dávek)?$/i);
    if (!match)
        return null;
    const quantity = Math.round((match[1] ? Number(match[1]) : 1) * Number(match[2].replace(',', '.')) * 1e6) / 1e6;
    const unit = /^(?:ks|kus|kaps)/i.test(match[3]) ? 'ks' : match[3].toLowerCase();
    return quantity > 0 && quantity <= 10000 ? { quantity, unit } : null;
}
function categoryFor(name, sourceCategory) {
    const text = normal(name);
    if (/^(?:09|11|12)_/.test(sourceCategory) || /^CZ\d+NF$/.test(sourceCategory))
        return 'home';
    if (/\bmaslo\b/.test(text) && !/arasid|orech|mandl|kaka|pomaz|susenk|susenky|bylin/.test(text))
        return 'maslo';
    if (/\bmleko\b/.test(text) && !/kokos|mandl|oves|susene|kondenz|kefir|detsk|kojene|kock|kočk/.test(text))
        return 'mleko';
    if (/\bvejce\b/.test(text))
        return 'vejce';
    if (/\bmouka\b/.test(text))
        return 'mouka';
    if (/\b(?:coca.cola|pepsi)\b/.test(text))
        return 'cola';
    if (/kureci/.test(text) && /prs|rizky/.test(text))
        return 'kureci_maso';
    return `kaufland:${sourceCategory}`;
}
function parseKauflandHtml(html, fetchedAt, store = exports.defaultKauflandStore) {
    if (html.length > 10_000_000)
        throw new Error('Nabídka je příliš velká.');
    const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
        .map(match => match[1]).find(text => text.includes('"component":"OfferTemplate"'));
    if (!script)
        throw new Error('Kaufland změnil podobu nabídky.');
    const start = script.indexOf('{"component":"OfferTemplate"');
    let data;
    try {
        data = object(JSON.parse(script.slice(start).trim().replace(/;$/, '')));
    }
    catch {
        throw new Error('Nabídku se nepodařilo přečíst.');
    }
    const cycles = object(object(data.props).offerData).cycles;
    if (!Array.isArray(cycles))
        throw new Error('Chybí přehled nabídek.');
    const offers = new Map();
    // Campaigns repeat products from the ordinary categories. Keep their useful classification.
    const primaryCategories = new Map();
    for (const cycle of cycles) {
        const categories = object(cycle).categories;
        if (!Array.isArray(categories))
            continue;
        for (const rawCategory of categories) {
            const category = object(rawCategory);
            if (category.main !== true || !Array.isArray(category.offers))
                continue;
            for (const raw of category.offers)
                primaryCategories.set(clean(object(raw).klNr), clean(category.name));
        }
    }
    let skipped = 0;
    for (const cycle of cycles) {
        const categories = object(cycle).categories;
        if (!Array.isArray(categories))
            continue;
        for (const categoryValue of categories) {
            const category = object(categoryValue);
            if (!Array.isArray(category.offers))
                continue;
            for (const raw of category.offers) {
                const item = object(raw);
                const id = clean(item.offerId);
                if (!id.includes(`.${store.storeId}.`))
                    throw new Error('Nabídky patří jiné prodejně.');
                const pack = parsePack(item.unit);
                const description = clean(item.detailDescription);
                const conditions = normal(`${clean(category.displayName)} ${clean(item.title)} ${clean(item.detailTitle)} ${description} ${clean(item.subtitle)}`);
                if (!pack || item.bonusbuy || item.bbyNo || item.customerType || item.loyaltyFormattedPrice || Number(item.loyaltyDiscount ?? 0) > 0 ||
                    /kaufland card|kxtra|pri koupi|pri nakupu|kupon|\d+\s*\+\s*\d|zaplatite|cena od|od \d+[,.]\d+/.test(conditions) ||
                    typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price <= 0 || item.price > 999999.99 ||
                    !/^\d+$/.test(clean(item.klNr))) {
                    skipped++;
                    continue;
                }
                const productName = [clean(item.title), clean(item.subtitle)].filter(Boolean).join(' · ');
                if (!productName) {
                    skipped++;
                    continue;
                }
                const sourceCategory = primaryCategories.get(clean(item.klNr)) ?? clean(category.name);
                const offer = {
                    id: `kaufland-${id}`, productKey: `kaufland-${item.klNr}-${pack.quantity}${pack.unit}`,
                    retailer: 'Kaufland', productName, category: categoryFor(productName, sourceCategory), subcategory: '',
                    price: Math.round(item.price * 100) / 100, ...pack,
                    validFrom: clean(item.dateFrom), validTo: clean(item.dateTo),
                    soldByWeight: (pack.unit === 'g' || pack.unit === 'kg') && (item.serviceCounter === true || clean(item.unit).startsWith('cena za ') || (clean(category.name).startsWith('02_') && clean(item.unit) === '1 kg')),
                    source: 'kaufland', sourceUrl: store.url, storeName: store.storeName, description,
                };
                if (!(0, offerValidity_1.isOfferValid)(offer, offer.validFrom)) {
                    skipped++;
                    continue;
                }
                const image = clean(item.listImage);
                if (image.startsWith('https://kaufland.media.schwarz/is/image/schwarz/')) {
                    const rendition = object(item.listImageRenditions)['322'];
                    offer.imageUrl = image + (typeof rendition === 'string' && /^[a-zA-Z0-9=]+$/.test(rendition) ? `?${rendition}` : '');
                }
                // The reference price is taken from the source; it is never reconstructed from a rounded percentage.
                const oldPrice = Number(clean(item.formattedOldPrice).replace(/\s/g, '').replace(',', '.'));
                if (Number.isFinite(oldPrice) && oldPrice > offer.price)
                    offer.regularPrice = oldPrice;
                if (!offers.has(offer.id))
                    offers.set(offer.id, offer);
            }
        }
    }
    if (!offers.size)
        throw new Error('Nenalezeny žádné jednoznačné nabídky. Předchozí data zůstávají uložená.');
    return { version: 1, fetchedAt, storeId: store.storeId, offers: [...offers.values()], skipped };
}
function restoreCatalog(value) {
    const data = object(value);
    if (data.version !== 1 || typeof data.storeId !== 'string' || !/^CZ\d{4}$/.test(data.storeId) || typeof data.fetchedAt !== 'string' ||
        !Number.isFinite(Date.parse(data.fetchedAt)) || !Array.isArray(data.offers) || !data.offers.length || data.offers.length > 2000)
        return null;
    const valid = data.offers.every(raw => {
        const item = object(raw);
        return typeof item.id === 'string' && item.id.startsWith('kaufland-') && typeof item.productKey === 'string' &&
            typeof item.productName === 'string' && typeof item.category === 'string' && typeof item.subcategory === 'string' &&
            item.source === 'kaufland' && item.retailer === 'Kaufland' && typeof item.storeName === 'string' && item.storeName.startsWith('Kaufland') &&
            typeof item.id === 'string' && item.id.includes(`.${data.storeId}.`) && typeof item.sourceUrl === 'string' && /^https:\/\/prodejny\.kaufland\.cz\/nabidka\/prehled(?:\.storeName%3D|\.storeName=)?(?:CZ\d{4})?\.html$/.test(item.sourceUrl) &&
            typeof item.price === 'number' && Number.isFinite(item.price) && item.price > 0 && item.price <= 999999.99 &&
            (item.regularPrice === undefined || typeof item.regularPrice === 'number' && Number.isFinite(item.regularPrice) && item.regularPrice > item.price) &&
            (item.soldByWeight === undefined || typeof item.soldByWeight === 'boolean' && (!item.soldByWeight || item.unit === 'g' || item.unit === 'kg')) &&
            typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 10000 &&
            ['g', 'kg', 'ml', 'l', 'ks'].includes(String(item.unit)) &&
            typeof item.validFrom === 'string' && typeof item.validTo === 'string' && (0, offerValidity_1.isOfferValid)(raw, item.validFrom) &&
            (item.imageUrl === undefined || typeof item.imageUrl === 'string' && item.imageUrl.startsWith('https://kaufland.media.schwarz/is/image/schwarz/'));
    });
    return valid ? data : null;
}
