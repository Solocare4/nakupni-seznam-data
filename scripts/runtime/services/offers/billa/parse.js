"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreBillaCatalog = exports.BILLA_URL = void 0;
exports.parseBillaHtml = parseBillaHtml;
const offerValidity_1 = require("../../../utils/offerValidity");
const parse_1 = require("../penny/parse");
const publicCatalog_1 = require("../publicCatalog");
exports.BILLA_URL = 'https://www.billa.cz/';
const restoreBillaCatalog = (value) => (0, publicCatalog_1.restorePublicCatalog)(value, 'billa', 'cz');
exports.restoreBillaCatalog = restoreBillaCatalog;
function parseBillaHtml(html, fetchedAt) {
    if (html.length > 10000000)
        throw new Error('Příliš velká nabídka BILLA.');
    const start = html.indexOf('Výběr z aktuálního letáku');
    const end = html.indexOf('<h2', start + 30);
    if (start < 0 || end < 0)
        throw new Error('BILLA změnila podobu výběru z letáku.');
    const section = html.slice(start, end);
    const dates = (0, publicCatalog_1.clean)(section.slice(0, 1200)).match(/Nabídka platí ve dnech\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(?:(\d{4})\s*)?[-–]\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
    if (!dates)
        throw new Error('BILLA: chybí jednoznačná platnost.');
    const iso = (day, month, year) => `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const validFrom = iso(dates[1], dates[2], dates[3] ?? String(Number(dates[6]) - (Number(dates[2]) > Number(dates[5]) ? 1 : 0)));
    const publicationEnd = iso(dates[4], dates[5], dates[6]);
    if (!(0, offerValidity_1.isOfferValid)({ validFrom, validTo: publicationEnd }, validFrom))
        throw new Error('BILLA: neplatné datum letáku.');
    if (!Number.isFinite(Date.parse(fetchedAt)))
        throw new Error('Neplatné datum načtení Billy.');
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(fetchedAt));
    const part = (type) => parts.find(p => p.type === type)?.value;
    const checkedDay = `${part('year')}-${part('month')}-${part('day')}`;
    // The homepage can contain one-day promotions within the weekly flyer.
    // A current observation must never extend that price to the whole week.
    const validTo = checkedDay < publicationEnd ? checkedDay : publicationEnd;
    const offers = [];
    let skipped = 0;
    // The homepage explicitly labels this section as a selection from the flyer.
    // Do not infer product/price associations from the unstructured PDF text.
    for (const match of section.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)) {
        const tile = match[0], text = (0, publicCatalog_1.clean)(tile);
        const slug = tile.match(/data-product-slug="([a-z0-9-]+)"/)?.[1];
        const name = (0, publicCatalog_1.clean)(tile.match(/data-teaser-name="([^"]+)"/)?.[1]);
        const packText = (0, publicCatalog_1.clean)(tile.match(/data-test="product-information-piece-description"[^>]*>([\s\S]*?)<\/ul>/)?.[1]);
        const weighed = /^1 kus\s+cca \d+(?:[,.]\d+)? kg$/.test(packText);
        const pack = (weighed ? '1 kg' : packText).match(/^(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)$/i);
        const priceTexts = weighed
            ? [...tile.matchAll(/data-test="product-price-type-label"[^>]*>\s*1 kg\s+([^<]+)</g)].map(m => m[1])
            : [...tile.matchAll(/class="ws-product-price-value__main"[^>]*>([^<]+)</g)].map(m => m[1]);
        const prices = priceTexts.map(value => Number((0, publicCatalog_1.clean)(value).replace(/\s|Kč/g, '').replace(',', '.')));
        if (!slug || !name || !pack || !prices.length || prices.length > 2 || prices.some(p => !Number.isFinite(p) || p <= 0) ||
            /klub|při (koupi|nákupu)|od\s*\d+\s*(ks|kus)|max\.?\s*\d+|\d+\s*\+\s*\d+|kupon|kupón|po odkapání/i.test(text) || (!weighed && /cca/i.test(text))) {
            skipped++;
            continue;
        }
        const price = prices.at(-1);
        const offer = { id: `billa-${slug}-${validFrom}`, productKey: `billa-${slug}`, retailer: 'Billa', source: 'billa', sourceUrl: exports.BILLA_URL,
            productName: name, category: (0, parse_1.categoryFor)(name), subcategory: '', price, quantity: Number(pack[1].replace(',', '.')), unit: pack[2].toLowerCase(),
            validFrom, validTo, storeName: 'BILLA · celostátní výběr z letáku', description: 'Výběr z oficiálního webu, cena bez klubu a množstevních podmínek. Dostupnost se může lišit podle prodejny.' };
        if (prices.length === 2 && prices[0] > price)
            offer.regularPrice = prices[0];
        if (weighed || offer.unit === 'kg' && /za 1 kg/.test(text))
            offer.soldByWeight = true;
        offers.push(offer);
    }
    try {
        const { data, decode } = (0, publicCatalog_1.nuxtData)(html);
        for (const item of data) {
            const entry = (0, publicCatalog_1.object)(item);
            if (typeof entry.slug !== 'number' || typeof entry.images !== 'number')
                continue;
            const slug = decode(entry.slug);
            const offer = offers.find(o => o.productKey === `billa-${slug}`);
            if (!offer)
                continue;
            const images = decode(entry.images);
            if (Array.isArray(images))
                offer.imageUrl = (0, publicCatalog_1.safeImage)(typeof images[0] === 'string' ? images[0] : (0, publicCatalog_1.object)(images[0]).url, 'billa');
        }
    }
    catch { /* Pictures are optional. */ }
    const catalog = { version: 1, source: 'billa', fetchedAt, storeId: 'cz', offers, skipped, partial: true };
    if (!(0, exports.restoreBillaCatalog)(catalog))
        throw new Error('BILLA: nenalezeny jednoznačné nabídky.');
    return catalog;
}
