"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatedOfferToOffer = generatedOfferToOffer;
exports.fetchPennyCatalog = fetchPennyCatalog;
const parse_1 = require("./parse");
const PENNY_GENERATED_CATALOG_URL = 'https://raw.githubusercontent.com/Solocare4/nakupni-seznam-data/main/data/pennyCatalog.json';
const TIMEOUT_MS = 25000;
function isDateString(value) {
    return (typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value));
}
function clean(value) {
    return typeof value === 'string'
        ? value
            .replace(/\s+/g, ' ')
            .trim()
        : '';
}
function generatedCatalogIsCurrent(catalog) {
    if (!isDateString(catalog.validFrom) ||
        !isDateString(catalog.validTo)) {
        return false;
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Prague',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    return (today >= catalog.validFrom &&
        today <= catalog.validTo);
}
function parsePackage(value) {
    const text = clean(value);
    /*
     * Běžné balení:
     * 500 g
     * 1 kg
     * 250 ml
     * 1,5 l
     * 20 ks
     */
    let match = text.match(/^(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|m|ks)$/i);
    if (match) {
        const quantity = Number(match[1].replace(',', '.'));
        if (Number.isFinite(quantity) &&
            quantity > 0 &&
            quantity <= 10000) {
            return {
                quantity,
                unit: match[2]
                    .toLowerCase(),
            };
        }
    }
    /*
     * Vícebalení:
     * 8x 85 g
     * 12x 50 ml
     *
     * Do aplikace uložíme celkové množství.
     */
    match =
        text.match(/^(\d+)\s*[x×]\s*(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|m|ks)$/i);
    if (match) {
        const multiplier = Number(match[1]);
        const singleQuantity = Number(match[2].replace(',', '.'));
        const quantity = multiplier *
            singleQuantity;
        if (Number.isFinite(quantity) &&
            quantity > 0 &&
            quantity <= 10000) {
            return {
                quantity,
                unit: match[3]
                    .toLowerCase(),
            };
        }
    }
    return null;
}
function generatedSourceUrl(value) {
    const text = clean(value);
    try {
        const url = new URL(text);
        if (url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            ['files.rewe.co.at', 'www.penny.cz'].includes(url.hostname)) {
            return url.toString();
        }
    }
    catch {
        // Neplatný odkaz nahradíme hlavní stránkou nabídek.
    }
    return parse_1.PENNY_URL;
}
function generatedOfferToOffer(raw) {
    if (!raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw)) {
        return null;
    }
    const generated = raw;
    const name = clean(generated.name);
    const price = generated.price;
    const validFrom = generated.validFrom;
    const validTo = generated.validTo;
    const parsedPackage = parsePackage(generated.packageText);
    if (!name ||
        typeof price !== 'number' ||
        !Number.isFinite(price) ||
        price <= 0 ||
        price > 999999.99 ||
        !isDateString(validFrom) ||
        !isDateString(validTo) ||
        !parsedPackage) {
        return null;
    }
    const rawId = clean(generated.id);
    const safeId = rawId.startsWith('penny-')
        ? rawId
        : `penny-generated-${Math.random()
            .toString(36)
            .slice(2)}`;
    const descriptionParts = [
        'Veřejná cena bez PENNY karty.',
        clean(generated.packageText)
            ? `Balení: ${clean(generated.packageText)}.`
            : '',
        clean(generated.unitPriceText)
            ? `Jednotková cena: ${clean(generated.unitPriceText)}.`
            : '',
        'Dostupnost se může lišit podle prodejny.',
    ].filter(Boolean);
    const offer = {
        id: safeId,
        productKey: safeId,
        retailer: 'Penny',
        productName: name,
        category: (0, parse_1.categoryFor)(name),
        subcategory: '',
        price: Math.round(price * 100) / 100,
        quantity: parsedPackage.quantity,
        unit: parsedPackage.unit,
        validFrom,
        validTo,
        source: 'penny',
        sourceUrl: generatedSourceUrl(generated.sourceUrl),
        storeName: 'PENNY • celostátní nabídka',
        description: descriptionParts.join(' '),
    };
    return offer;
}
async function fetchGeneratedCatalog() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(`${PENNY_GENERATED_CATALOG_URL}?v=${Date.now()}`, {
            signal: controller.signal,
            credentials: 'omit',
            headers: {
                Accept: 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`GitHub katalog PENNY odpověděl chybou ${response.status}.`);
        }
        const generated = (await response.json());
        if (generated.source !==
            'penny-generated' ||
            !Array.isArray(generated.offers)) {
            throw new Error('GitHub katalog PENNY má neplatný formát.');
        }
        if (!generatedCatalogIsCurrent(generated)) {
            throw new Error(`GitHub katalog PENNY není aktuální (${String(generated.validFrom ?? '?')} až ${String(generated.validTo ?? '?')}).`);
        }
        const offers = generated.offers
            .map(generatedOfferToOffer)
            .filter((offer) => offer !== null);
        if (!offers.length) {
            throw new Error('GitHub katalog PENNY neobsahuje žádné nabídky kompatibilní s aplikací.');
        }
        const catalog = {
            version: 1,
            source: 'penny',
            fetchedAt: typeof generated.generatedAt ===
                'string'
                ? generated.generatedAt
                : new Date().toISOString(),
            scope: 'CZ',
            offers,
            skipped: generated.offers.length -
                offers.length,
            length: offers.length,
        };
        ;
        if (catalog.skipped >
            0) {
            ;
        }
        return catalog;
    }
    finally {
        clearTimeout(timer);
    }
}
async function fetchFallbackCatalog() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(parse_1.PENNY_URL, {
            signal: controller.signal,
            credentials: 'omit',
        });
        if (!response.ok) {
            throw new Error(`Zdroj PENNY odpověděl chybou ${response.status}.`);
        }
        const html = await response.text();
        const catalog = (0, parse_1.parsePennyHtml)(html, new Date().toISOString());
        ;
        return catalog;
    }
    finally {
        clearTimeout(timer);
    }
}
async function fetchPennyCatalog() {
    try {
        return await fetchGeneratedCatalog();
    }
    catch (error) {
        ;
        return fetchFallbackCatalog();
    }
}
