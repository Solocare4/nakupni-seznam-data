"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIDL_FLYERS = exports.LIDL_WEEKLY_HUB = exports.LIDL_HOME = exports.LIDL_URL = void 0;
exports.currentLidlUrls = currentLidlUrls;
exports.parseLidlHtml = parseLidlHtml;
exports.restoreLidlCatalog = restoreLidlCatalog;
const offerValidity_1 = require("../../../utils/offerValidity");
exports.LIDL_URL = 'https://www.lidl.cz/c/srovnani-ceny-v-klidu/a10091553';
exports.LIDL_HOME = 'https://www.lidl.cz/';
exports.LIDL_WEEKLY_HUB = 'https://www.lidl.cz/c/posouvat-limity-to-se-vyplati/a10102510';
exports.LIDL_FLYERS = 'https://www.lidl.cz/c/akcni-letak/s10008644';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
const decode = (value) => value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const cleanText = (value) => decode(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const normal = (value) => value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
/**
 * Z homepage Lidlu vybere aktuální stránky s nabídkami zboží
 * v kamenných prodejnách.
 *
 * Původně jsme brali pouze:
 * - pondělní nabídku
 * - čtvrteční nabídku
 * - víkendovou nabídku
 *
 * Tím ale chybělo ovoce/zelenina, maso, pečivo, ryby,
 * značkové slevy a další potravinové akce.
 */
function currentLidlUrls(html) {
    const urls = new Set();
    const include = /pondelni|ctvrtecni|vikendov|hity.?tydne|akcni.?letak|ovoce|zelenin|cerstve.?maso|maso|cerstve.?pecivo|pecivo|ryby|potrav|napoj|znackov|slev|usetrete|chut|gril|snidan|svacin|sladk|mlec|syry|uzenin/i;
    const exclude = /online|parkside|naradi|diln|moda|oblec|obuv|koupeln|loznic|pracovna|kancelar|nabytek|zahrad|sport|elektr|spotrebic|hrack|detske.?oblec|wellness/i;
    const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(anchorPattern)) {
        const href = decode(match[1]);
        const label = normal(cleanText(match[2]));
        let url;
        try {
            url = new URL(href, exports.LIDL_HOME);
        }
        catch {
            continue;
        }
        if (url.origin !== 'https://www.lidl.cz' || url.username || url.password)
            continue;
        if (!/^\/c\/.+\/a\d+\/?$/.test(url.pathname))
            continue;
        let path = '';
        try {
            path = normal(decodeURIComponent(url.pathname));
        }
        catch {
            path = normal(url.pathname);
        }
        const searchable = `${path} ${label}`;
        if (!include.test(searchable))
            continue;
        /*
         * Nechceme čistě online nepotravinové kampaně.
         * Pokud ale URL jasně patří potravinám, ponecháme ji.
         */
        if (exclude.test(searchable) &&
            !/ovoce|zelenin|maso|pecivo|ryby|potrav|napoj|sladk|mlec|syry|uzenin/.test(searchable)) {
            continue;
        }
        url.search = '';
        url.hash = '';
        urls.add(url.href);
    }
    const result = [...urls];
    if (!result.length) {
        throw new Error('Lidl: nenalezen přehled aktuálních nabídek.');
    }
    /*
     * Bezpečnostní limit, kdyby Lidl někdy na homepage
     * publikoval stovky odkazů.
     */
    return result.slice(0, 30);
}
function czechDay(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        return '';
    }
    const date = new Date(seconds * 1000);
    if (!Number.isFinite(date.getTime())) {
        return '';
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Prague',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const part = (type) => parts.find((p) => p.type === type)?.value ?? '';
    const year = part('year');
    const month = part('month');
    const day = part('day');
    if (!year || !month || !day)
        return '';
    return `${year}-${month}-${day}`;
}
function rollingValidity(fetchedAt, days = 7) {
    const start = new Date(fetchedAt);
    if (!Number.isFinite(start.getTime()))
        return { validFrom: '', validTo: '' };
    const validFrom = czechDay(start.getTime() / 1000);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + days);
    const validTo = czechDay(end.getTime() / 1000);
    return { validFrom, validTo };
}
function normalizePackText(value) {
    return cleanText(value)
        .replace(/\bkus(?:y|ů)?\b/gi, 'ks')
        .replace(/\brola\b|\brole\b|\brolí\b/gi, 'ks')
        .replace(/\s+/g, ' ')
        .trim();
}
function priceFromLidlPlus(data) {
    const variants = Array.isArray(data.lidlPlus) ? data.lidlPlus : [];
    if (variants.length !== 1)
        return null;
    const variant = object(variants[0]);
    const price = object(variant.price);
    const current = price.price;
    if (typeof current !== 'number' || !Number.isFinite(current) || current <= 0) {
        return null;
    }
    return { price, current };
}
function packFromUnitPrice(value, currentPrice) {
    if (typeof currentPrice !== 'number' ||
        !Number.isFinite(currentPrice) ||
        currentPrice <= 0) {
        return null;
    }
    const text = normalizePackText(value);
    // 1 kg = 99,90 Kč / 1 l = 12,90 Kč
    const metric = text.match(/(?:^|,\s*)1\s*(kg|l)\s*=\s*(\d+(?:[,.]\d+)?)\s*Kč(?:$|,)/i);
    if (metric) {
        const unitPrice = Number(metric[2].replace(',', '.'));
        if (Number.isFinite(unitPrice) && unitPrice > 0) {
            const quantity = Math.round((currentPrice / unitPrice) * 1000) / 1000;
            if (Number.isFinite(quantity) && quantity > 0 && quantity <= 10000) {
                return { quantity, unit: metric[1].toLowerCase() };
            }
        }
    }
    // 1 role = 5,54 Kč / 1 ks = 9,90 Kč. Umožní např. dopočítat
    // počet rolí toaletního papíru, když Lidl počet balení explicitně nepošle.
    const pieces = text.match(/(?:^|,\s*)1\s*ks\s*=\s*(\d+(?:[,.]\d+)?)\s*Kč(?:$|,)/i);
    if (pieces) {
        const unitPrice = Number(pieces[1].replace(',', '.'));
        if (Number.isFinite(unitPrice) && unitPrice > 0) {
            const quantity = Math.round((currentPrice / unitPrice) * 100) / 100;
            const rounded = Math.round(quantity);
            if (Math.abs(quantity - rounded) <= 0.05 && rounded > 0 && rounded <= 1000) {
                return { quantity: rounded, unit: 'ks' };
            }
        }
    }
    return null;
}
function isShoppingRelevant(data, name) {
    const keyfacts = object(data.keyfacts);
    const analytics = normal([
        typeof keyfacts.analyticsCategory === 'string' ? keyfacts.analyticsCategory : '',
        typeof keyfacts.wonCategoryPrimary === 'string' ? keyfacts.wonCategoryPrimary : '',
        typeof data.category === 'string' ? data.category : '',
    ].join(' '));
    if (/\bfood\b|potrav|napoj|droger|domacnost|hygien|zvirat|\bpet\b/.test(analytics)) {
        return true;
    }
    const product = normal(name);
    if (/mleko|syr|jogurt|maslo|vejce|maso|sunka|salam|parek|kure|veprov|hovez|ryb|peciv|chleb|rohlik|ovoce|zelenin|jablk|banan|rajcat|okurk|paprik|brambor|napoj|voda|pivo|vino|dzus|cola|kava|caj|cokolad|susenk|testovin|ryze|mouka|cukr|olej|toalet|ubrousk|kapesnik|praci|cistic|jar|granule|kapsick/.test(product)) {
        return true;
    }
    // Pokud Lidl kategorii vůbec neposlal, necháme rozhodnout další validaci.
    // Pokud ale kategorii poslal a jasně není nákupní/potravinová, zahodíme ji.
    return !analytics.trim();
}
function categoryFor(name) {
    const value = normal(name);
    if (/jablk|hrozn|banan|meloun|citron|pomeranc|mandar|paprik|rajce|rajcat|okurk|brambor|cibul|cesnek|mrkev|salat|avokad|ovoce|zelenin/.test(value)) {
        return 'produce';
    }
    if (/mleko|syr|jogurt|smetan|tvaroh|maslo|vejce|kefir|mozarell|mozzarell/.test(value)) {
        return 'dairy';
    }
    if (/sunka|salam|klobas|parek|maso|kure|kruta|veprov|hovez|steak|mlete|rizky|prsni/.test(value)) {
        return 'meat';
    }
    if (/napoj|voda|limonad|pivo|vino|dzus|cola|sirup|energy|dzin|tonic/.test(value)) {
        return 'drinks';
    }
    if (/mrazen|pizza|zmrzlin|nanuk/.test(value)) {
        return 'frozen';
    }
    if (/toalet|ubrousk|praci|cistic|sacek|droger|kapsick.*kock|granule|papir|kapesnik|jar|tablety.*myc/.test(value)) {
        return 'home';
    }
    return 'pantry';
}
/**
 * Podporuje například:
 * 500 g
 * 1 kg
 * 750 ml
 * 2 ks
 * 2 x 125 g
 * 4 × 100 g
 * cena za 1 kg
 * 500 g, 1 kg = 99,80 Kč
 */
function pack(value) {
    // Consume the entire description, allowing only an explicit unit-price suffix.
    // Never select one quantity from a range or genuinely different package sizes.
    const text = normalizePackText(value);
    if (!text)
        return null;
    if (/^(cena za\s+)?1\s*ks$/i.test(text)) {
        return { quantity: 1, unit: 'ks' };
    }
    const match = text.match(/^(cena za\s+)?(?:(\d+)\s*[x×]\s*)?(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)(?:\s*-\s*balení)?(?:\s*,\s*(?:100\s*(?:g|ml)|1\s*(?:kg|l|ks))\s*=\s*\d+(?:[,.]\d+)?\s*Kč)?$/i);
    if (!match || (match[1] && match[2]))
        return null;
    const count = match[2] ? Number(match[2]) : 1;
    const quantity = count * Number(match[3].replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) {
        return null;
    }
    return {
        quantity,
        unit: match[4].toLowerCase(),
    };
}
function parseLidlHtml(html, fetchedAt, weekly = false) {
    if (html.length > 10_000_000) {
        throw new Error('Nabídka Lidlu je příliš velká.');
    }
    if (!Number.isFinite(Date.parse(fetchedAt))) {
        throw new Error('Neplatné datum načtení Lidlu.');
    }
    const rawTiles = [
        ...html.matchAll(/data-grid-data="([\s\S]*?)"\s+data-country=/gi),
    ];
    if (!rawTiles.length) {
        throw new Error('Lidl změnil podobu nabídky.');
    }
    const offers = new Map();
    let skipped = 0;
    const skipReasons = {};
    const bump = (reason) => {
        skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
        skipped++;
    };
    for (const tile of rawTiles) {
        let data;
        try {
            data = object(JSON.parse(decode(tile[1])));
        }
        catch {
            bump('invalid-json');
            continue;
        }
        const publicPriceData = object(data.price);
        const publicCurrent = publicPriceData.price;
        const loyalty = priceFromLidlPlus(data);
        // Prefer a normal public shelf price. If Lidl only exposes a single Lidl Plus
        // price variant, keep it as an explicitly labelled loyalty offer instead of
        // discarding the product completely.
        const useLidlPlus = !(typeof publicCurrent === 'number' && Number.isFinite(publicCurrent)) &&
            loyalty != null;
        const priceData = useLidlPlus ? loyalty.price : publicPriceData;
        const current = useLidlPlus ? loyalty.current : publicCurrent;
        const basePrice = object(priceData.basePrice).text;
        const packagingPrice = object(priceData.packaging).text;
        const packaging = weekly
            ? basePrice ?? packagingPrice
            : packagingPrice ?? basePrice;
        const packText = typeof packaging === 'string'
            ? packaging.replace(/\u00a0/g, ' ').trim()
            : '';
        const weighed = /^cena za\s+\d+(?:[,.]\d+)?\s*(g|kg)$/i.test(cleanText(packText));
        const parsedPack = pack(packText) ?? packFromUnitPrice(packText, current);
        const id = typeof data.productId === 'number' ||
            typeof data.productId === 'string'
            ? String(data.productId)
            : '';
        const name = typeof data.fullTitle === 'string'
            ? cleanText(data.fullTitle).slice(0, 180)
            : '';
        // Podmíněné ceny přijímáme jen tehdy, když jde o jednu přesně určenou
        // Lidl Plus variantu, kterou jsme výše explicitně vybrali. Ostatní typy
        // typu 2+1, od N kusů nebo neurčité ceny dál odmítáme.
        const conditionalText = normal(cleanText(JSON.stringify(priceData)));
        const conditional = data.multipack === true ||
            priceData.variantsHaveDifferentPrices === true ||
            object(priceData.discount).showFrom === true ||
            object(priceData.discount).showUpTo === true ||
            /pri\s+(koupi|nakupu)|od\s*\d+\s*ks|\d+\s*\+\s*\d+|kupon|s\s+lidl\s+plus/i.test(conditionalText);
        const explicitValidFrom = czechDay(data.storeStartDate);
        const explicitValidTo = czechDay(data.storeEndDate);
        const rolling = !weekly ? rollingValidity(fetchedAt) : { validFrom: '', validTo: '' };
        const validFrom = explicitValidFrom || rolling.validFrom;
        const validTo = explicitValidTo || rolling.validTo;
        let skipReason = '';
        if (!id)
            skipReason = 'missing-id';
        else if (!name)
            skipReason = 'missing-name';
        else if (!isShoppingRelevant(data, name))
            skipReason = 'non-grocery';
        else if (!parsedPack)
            skipReason = 'pack';
        else if (conditional) {
            if (data.multipack === true)
                skipReason = 'multipack';
            else if (priceData.variantsHaveDifferentPrices === true)
                skipReason = 'variant-prices';
            else if (object(priceData.discount).showFrom === true)
                skipReason = 'price-from';
            else if (object(priceData.discount).showUpTo === true)
                skipReason = 'price-up-to';
            else
                skipReason = 'conditional-text';
        }
        else if (data.store !== true)
            skipReason = 'not-store';
        else if (priceData.currencyCode != null && priceData.currencyCode !== 'CZK')
            skipReason = 'currency';
        else if (typeof current !== 'number' || !Number.isFinite(current))
            skipReason = 'missing-price';
        else if (current <= 0 || current > 999999.99)
            skipReason = 'bad-price';
        else if (weekly && (typeof data.storeStartDate !== 'number' || typeof data.storeEndDate !== 'number'))
            skipReason = 'missing-dates';
        else if (weekly && Number(data.storeStartDate) > Number(data.storeEndDate))
            skipReason = 'bad-dates';
        else if (!validFrom || !validTo)
            skipReason = 'invalid-validity';
        if (skipReason || !parsedPack || typeof current !== 'number') {
            bump(skipReason);
            continue;
        }
        const canonical = typeof data.canonicalUrl === 'string' &&
            data.canonicalUrl.startsWith('/p/')
            ? `https://www.lidl.cz${data.canonicalUrl}`
            : exports.LIDL_URL;
        const offer = {
            id: weekly
                ? `lidl-${id}-${validFrom}`
                : `lidl-${id}`,
            productKey: `lidl-${id}`,
            retailer: 'Lidl',
            productName: name,
            category: categoryFor(name),
            subcategory: '',
            price: Math.round(current * 100) / 100,
            ...parsedPack,
            validFrom,
            validTo,
            loyaltyOnly: useLidlPlus,
            ...(useLidlPlus ? { loyaltyProgram: 'Lidl Plus' } : {}),
            source: 'lidl',
            sourceUrl: canonical,
            ...(weighed ? { soldByWeight: true } : {}),
            storeName: weekly
                ? 'Lidl · akční nabídka'
                : 'Lidl · Ceny v klidu',
            description: useLidlPlus
                ? 'Cena s Lidl Plus. Pro její využití je potřeba Lidl Plus; dostupnost se může lišit podle prodejny.'
                : weekly
                    ? 'Cena z aktuální veřejné nabídky Lidlu. Dostupnost se může lišit podle prodejny.'
                    : 'Dlouhodobě snížená cena. Dostupnost se může lišit podle prodejny.',
        };
        if (!(0, offerValidity_1.isOfferValid)(offer, offer.validFrom)) {
            bump('offer-validity');
            continue;
        }
        const old = priceData.oldPrice;
        if (typeof old === 'number' &&
            Number.isFinite(old) &&
            old > current) {
            offer.regularPrice =
                Math.round(old * 100) / 100;
        }
        const image = typeof data.image === 'string'
            ? data.image
            : '';
        if (image.startsWith('https://imgproxy-retcat.assets.schwarz/')) {
            offer.imageUrl = image;
        }
        offers.set(offer.id, offer);
    }
    /*
     * Jedna vedlejší akční stránka může vrátit 0 položek.
     * Proto u weekly režimu nevyhazujeme chybu.
     */
    if (!offers.size && !weekly) {
        throw new Error('Nenalezeny žádné použitelné ceny Lidlu.');
    }
    return {
        version: 1,
        source: 'lidl',
        fetchedAt,
        scope: 'CZ',
        offers: [...offers.values()],
        skipped,
        skipReasons,
    };
}
function restoreLidlCatalog(value) {
    const data = object(value);
    if (data.version !== 1 ||
        data.source !== 'lidl' ||
        data.scope !== 'CZ' ||
        typeof data.fetchedAt !== 'string' ||
        !Number.isFinite(Date.parse(data.fetchedAt)) ||
        !Array.isArray(data.offers) ||
        !data.offers.length ||
        data.offers.length > 5000) {
        return null;
    }
    const valid = data.offers.every((raw) => {
        const item = object(raw);
        return (typeof item.id === 'string' &&
            item.id.startsWith('lidl-') &&
            typeof item.productKey === 'string' &&
            item.productKey.startsWith('lidl-') &&
            item.retailer === 'Lidl' &&
            item.source === 'lidl' &&
            typeof item.sourceUrl === 'string' &&
            item.sourceUrl.startsWith('https://www.lidl.cz/') &&
            typeof item.productName === 'string' &&
            typeof item.category === 'string' &&
            typeof item.subcategory === 'string' &&
            typeof item.price === 'number' &&
            Number.isFinite(item.price) &&
            item.price > 0 &&
            typeof item.quantity === 'number' &&
            Number.isFinite(item.quantity) &&
            item.quantity > 0 &&
            item.quantity <= 10000 &&
            ['g', 'kg', 'ml', 'l', 'm', 'ks'].includes(String(item.unit)) &&
            typeof item.validFrom === 'string' &&
            typeof item.validTo === 'string' &&
            (0, offerValidity_1.isOfferValid)(raw, item.validFrom) &&
            (item.imageUrl === undefined ||
                (typeof item.imageUrl === 'string' &&
                    item.imageUrl.startsWith('https://imgproxy-retcat.assets.schwarz/'))));
    });
    return valid
        ? data
        : null;
}
