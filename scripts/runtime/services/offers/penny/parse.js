"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PENNY_URL = void 0;
exports.categoryFor = categoryFor;
exports.parsePennyHtml = parsePennyHtml;
exports.restorePennyCatalog = restorePennyCatalog;
const offerValidity_1 = require("../../../utils/offerValidity");
exports.PENNY_URL = 'https://www.penny.cz/nabidky?tab=akcni-polozky';
const clean = (value) => typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600)
    : '';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
const normal = (value) => value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
const price = (value) => Number(value
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/Kč/i, ''));
const isoDate = (value) => {
    const match = value.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return match
        ? `${match[3]}-${match[2]}-${match[1]}`
        : '';
};
function categoryFor(name) {
    const value = normal(name);
    if (/\bmaslo\b/.test(value) &&
        !/arasid|orech|pomaz/.test(value)) {
        return 'maslo';
    }
    if (/\bmleko\b/.test(value) &&
        !/kock|kokos|mandl|oves/.test(value)) {
        return 'mleko';
    }
    if (/\bvejce\b/.test(value))
        return 'vejce';
    if (/\bmouka\b/.test(value))
        return 'mouka';
    if (/coca.cola|pepsi/.test(value)) {
        return 'cola';
    }
    if (/kureci/.test(value) && /prs|rizek|rizky/.test(value)) {
        return 'kureci_maso';
    }
    if (/jablk|hrozn|banan|meloun|citron|pomeranc|mandar|paprik|rajce|rajcat|okurk|brambor|cibul|ovoce|zelenin/.test(value)) {
        return 'produce';
    }
    if (/mleko|syr|jogurt|smetan|tvaroh|termix|kefir|vejce|flora/.test(value)) {
        return 'dairy';
    }
    if (/sunka|salam|klobas|parek|maso|kure|kruta|veprov|hovez/.test(value)) {
        return 'meat';
    }
    if (/napoj|voda|limonad|pivo|vino|dzus|cola/.test(value)) {
        return 'drinks';
    }
    if (/mrazen|pizza|zmrzlin/.test(value)) {
        return 'frozen';
    }
    if (/toalet|ubrousk|praci|cistic|sacek|droger|kapesnik|papir|hygien/.test(value)) {
        return 'home';
    }
    if (/mouka|chleb|peciv|rohlik|knedlik|testovin|ryze|olej|kava|caj|cokolad|tycink|konzerv/.test(value)) {
        return 'pantry';
    }
    return 'penny:ostatni';
}
function pack(value) {
    const text = clean(value);
    let match = text.match(/^(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|m|ks)$/i);
    if (!match) {
        match = text.match(/^(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|m|ks)\b/i);
    }
    if (!match)
        return null;
    const quantity = Number(match[1].replace(',', '.'));
    return quantity > 0 && quantity <= 10000
        ? {
            quantity,
            unit: match[2].toLowerCase(),
        }
        : null;
}
function nuxtImages(html) {
    const script = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? '';
    const images = new Map();
    if (!script)
        return images;
    const pattern = /"(https:\\u002F\\u002Fimages\.cdn\.europe-west1\.gcp\.commercetools\.com\\u002F[^"\\]+(?:\\[^"\\]*)*)"[\s\S]{0,3500}?"([a-z0-9]+(?:-[a-z0-9]+)+-\d{8})"/g;
    for (const match of script.matchAll(pattern)) {
        try {
            images.set(match[2], JSON.parse(`"${match[1]}"`));
        }
        catch {
            // Obrázek není pro nabídku povinný.
        }
    }
    return images;
}
function parsePennyHtml(html, fetchedAt) {
    if (html.length > 10_000_000) {
        throw new Error('Nabídka PENNY je příliš velká.');
    }
    const marker = /<li\b[^>]*data-test=["']product-tile["'][^>]*>/gi;
    const starts = [...html.matchAll(marker)];
    if (!starts.length) {
        throw new Error('PENNY změnilo podobu nabídky.');
    }
    const images = nuxtImages(html);
    const offers = new Map();
    const displayVariants = new Map();
    let skipped = 0;
    for (let index = 0; index < starts.length; index++) {
        const start = starts[index].index;
        const end = starts[index + 1]?.index ??
            Math.min(html.length, start + 30_000);
        const tileRegion = html.slice(start, end > start
            ? end
            : Math.min(html.length, start + 30_000));
        // Stop at this product's closing li, including nested description lists.
        // Footer text and neighbouring content must not qualify its price.
        let depth = 0;
        let tileEnd = 0;
        for (const tag of tileRegion.matchAll(/<\/?li\b[^>]*>/gi)) {
            depth += tag[0].startsWith('</') ? -1 : 1;
            if (depth === 0) {
                tileEnd = tag.index + tag[0].length;
                break;
            }
        }
        if (!tileEnd) {
            skipped++;
            continue;
        }
        const tile = tileRegion.slice(0, tileEnd);
        const opening = starts[index][0];
        const slug = clean(opening.match(/data-product-slug=["']([^"']+)/i)?.[1]);
        const name = clean(opening.match(/data-teaser-name=["']([^"']+)/i)?.[1]);
        const packValue = clean(tile.match(/data-test=["']product-information-piece-description["'][\s\S]*?<li[^>]*>([\s\S]*?)<\/li>/i)?.[1]);
        const parsedPack = pack(packValue);
        const dates = [
            ...tile.matchAll(/\d{2}\.\d{2}\.\d{4}/g),
        ]
            .slice(0, 2)
            .map((match) => isoDate(match[0]));
        // Without a proven association between labels and prices, skip card offers.
        const conditionText = normal(tile.replace(/<[^>]*>/g, ' '))
            .replace(/&nbsp;|&#160;/gi, ' ')
            .replace(/\s+/g, ' ');
        if (/\bpenny\s+kart|\bs\s+kartou\b|\bvernost|\bkupon/.test(conditionText)) {
            skipped++;
            continue;
        }
        const mainPriceTexts = [
            ...tile.matchAll(/product-price-value__main[^>]*>([^<]+)</gi),
        ].map((match) => clean(match[1]));
        const parsedPrices = mainPriceTexts
            .map(price)
            .filter((value) => Number.isFinite(value) &&
            value > 0 &&
            value <= 999999.99);
        // Different main prices are ambiguous; their magnitude does not prove scope.
        const current = parsedPrices.length === mainPriceTexts.length && new Set(parsedPrices).size === 1
            ? parsedPrices[0]
            : NaN;
        const oldText = clean(tile.match(/<s\b[^>]*>([^<]+)<\/s>/i)?.[1]);
        if (!slug ||
            !name ||
            !parsedPack ||
            dates.length !== 2 ||
            !(0, offerValidity_1.isOfferValid)({
                validFrom: dates[0],
                validTo: dates[1],
            }, dates[0]) ||
            !Number.isFinite(current) ||
            current <= 0 ||
            current > 999999.99) {
            skipped++;
            continue;
        }
        const offer = {
            id: `penny-${slug}`,
            productKey: `penny-${slug}`,
            retailer: 'Penny',
            productName: name,
            category: categoryFor(name),
            subcategory: '',
            price: Math.round(current * 100) / 100,
            ...parsedPack,
            validFrom: dates[0],
            validTo: dates[1],
            source: 'penny',
            sourceUrl: exports.PENNY_URL,
            storeName: 'PENNY · celostátní nabídka',
            description: 'Veřejná cena bez PENNY karty. Dostupnost se může lišit podle prodejny.',
        };
        const old = price(oldText);
        if (Number.isFinite(old) &&
            old > offer.price) {
            offer.regularPrice =
                Math.round(old * 100) / 100;
        }
        const image = images.get(slug);
        if (image?.startsWith('https://images.cdn.europe-west1.gcp.commercetools.com/')) {
            offer.imageUrl = image;
        }
        const displayKey = [
            normal(name),
            parsedPack.quantity,
            parsedPack.unit,
            offer.price,
            offer.validFrom,
            offer.validTo,
        ].join('|');
        const existing = displayVariants.get(displayKey);
        if (existing) {
            if (!existing.productName.endsWith(' · více variant')) {
                existing.productName +=
                    ' · více variant';
            }
            existing.description =
                'Více variant za stejnou veřejnou cenu. Dostupnost se může lišit podle prodejny.';
            continue;
        }
        displayVariants.set(displayKey, offer);
        if (!offers.has(offer.id)) {
            offers.set(offer.id, offer);
        }
    }
    if (!offers.size) {
        throw new Error('Nenalezeny žádné použitelné nabídky PENNY.');
    }
    return {
        version: 1,
        source: 'penny',
        fetchedAt,
        scope: 'CZ',
        offers: [...offers.values()],
        skipped,
        length: offers.size,
    };
}
function restorePennyCatalog(value) {
    const data = object(value);
    if (data.version !== 1 ||
        data.source !== 'penny' ||
        data.scope !== 'CZ' ||
        typeof data.fetchedAt !== 'string' ||
        !Number.isFinite(Date.parse(data.fetchedAt)) ||
        !Array.isArray(data.offers) ||
        !data.offers.length ||
        data.offers.length > 3000) {
        return null;
    }
    const valid = data.offers.every((raw) => {
        const item = object(raw);
        return (typeof item.id === 'string' &&
            item.id.startsWith('penny-') &&
            typeof item.productKey === 'string' &&
            item.productKey.startsWith('penny-') &&
            item.retailer === 'Penny' &&
            item.source === 'penny' &&
            typeof item.sourceUrl === 'string' &&
            (() => {
                try {
                    const url = new URL(item.sourceUrl);
                    return url.protocol === 'https:' && ['www.penny.cz', 'files.rewe.co.at'].includes(url.hostname);
                }
                catch {
                    return false;
                }
            })() &&
            typeof item.productName ===
                'string' &&
            typeof item.category === 'string' &&
            typeof item.subcategory ===
                'string' &&
            typeof item.price === 'number' &&
            Number.isFinite(item.price) &&
            item.price > 0 &&
            item.price <= 999999.99 &&
            (item.regularPrice === undefined ||
                (typeof item.regularPrice ===
                    'number' &&
                    Number.isFinite(item.regularPrice) &&
                    item.regularPrice >
                        item.price)) &&
            typeof item.quantity ===
                'number' &&
            Number.isFinite(item.quantity) &&
            item.quantity > 0 &&
            item.quantity <= 10000 &&
            ['g', 'kg', 'ml', 'l', 'm', 'ks'].includes(String(item.unit)) &&
            typeof item.validFrom ===
                'string' &&
            typeof item.validTo ===
                'string' &&
            (0, offerValidity_1.isOfferValid)(raw, item.validFrom) &&
            (item.imageUrl === undefined ||
                (typeof item.imageUrl ===
                    'string' &&
                    item.imageUrl.startsWith('https://images.cdn.europe-west1.gcp.commercetools.com/'))));
    });
    return valid
        ? data
        : null;
}
