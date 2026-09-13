"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALBERT_URL = void 0;
exports.currentAlbertPublications = currentAlbertPublications;
exports.currentAlbertSlug = currentAlbertSlug;
exports.parseAlbertSpreads = parseAlbertSpreads;
exports.restoreAlbertCatalog = restoreAlbertCatalog;
const offerValidity_1 = require("../../../utils/offerValidity");
exports.ALBERT_URL = 'https://www.albert.cz/aktualni-letaky';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
const normal = (value) => value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
const slugify = (value) => normal(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
function categoryFor(name) {
    const value = normal(name);
    if (/jablk|hrozn|banan|meloun|citron|pomeranc|mandar|paprik|rajce|rajcat|okurk|brambor|cibul|cesnek|mrkev|salat|avokad|ovoce|zelenin/.test(value)) {
        return 'produce';
    }
    if (/mleko|syr|jogurt|smetan|tvaroh|maslo|vejce|kefir|mozzarell|eidam/.test(value)) {
        return 'dairy';
    }
    if (/sunka|salam|klobas|parek|maso|kure|kruta|veprov|hovez|steak|mlete|rizky/.test(value)) {
        return 'meat';
    }
    if (/napoj|voda|limonad|pivo|vino|dzus|cola|sirup|sekt|energy|tonic/.test(value)) {
        return 'drinks';
    }
    if (/mrazen|pizza|zmrzlin|nanuk/.test(value)) {
        return 'frozen';
    }
    if (/toalet|ubrousk|praci|cistic|sacek|droger|kapsick.*kock|granule|deodorant|kapesnik|papir|jar|tablety.*myc/.test(value)) {
        return 'home';
    }
    return 'pantry';
}
function currentAlbertPublications(html) {
    const publications = [
        ...new Set([...html.matchAll(/\b(\d{1,2}(?:sm|hm)_akcni_letak)\b/gi)].map((match) => match[1].toLowerCase())),
    ];
    if (!publications.length) {
        throw new Error('Albert změnil přehled aktuálních letáků.');
    }
    return publications;
}
function currentAlbertSlug(html) {
    const publications = currentAlbertPublications(html);
    return (publications.find((publication) => publication.includes('sm_akcni_letak')) ?? publications[0]);
}
function validity(text) {
    const match = text.match(/Od\s+(\d{1,2})\.\s*(\d{1,2})\.\s*do\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i);
    if (!match) {
        throw new Error('V letáku Albert chybí jednoznačná platnost.');
    }
    const endYear = Number(match[5]);
    const startYear = Number(match[2]) > Number(match[4])
        ? endYear - 1
        : endYear;
    const date = (year, month, day) => `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    return {
        validFrom: date(startYear, match[2], match[1]),
        validTo: date(endYear, match[4], match[3]),
    };
}
function simplePack(text) {
    const cleaned = text
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const multi = cleaned.match(/(\d+)\s*[x×]\s*(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)(?=\s|,|;|•|$)/i);
    if (multi) {
        const count = Number(multi[1]);
        const each = Number(multi[2].replace(',', '.'));
        const quantity = count * each;
        if (Number.isFinite(quantity) &&
            quantity > 0 &&
            quantity <= 10000) {
            return {
                quantity,
                unit: multi[3].toLowerCase(),
            };
        }
    }
    const priceUnit = cleaned.match(/cena\s+za\s+(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)(?=\s|,|;|•|$)/i);
    if (priceUnit) {
        const quantity = Number(priceUnit[1].replace(',', '.'));
        if (Number.isFinite(quantity) &&
            quantity > 0 &&
            quantity <= 10000) {
            return {
                quantity,
                unit: priceUnit[2].toLowerCase(),
            };
        }
    }
    const bullet = cleaned.match(/•\s*(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)(?=\s|,|;|•|$)/i);
    if (bullet) {
        const quantity = Number(bullet[1].replace(',', '.'));
        if (Number.isFinite(quantity) &&
            quantity > 0 &&
            quantity <= 10000) {
            return {
                quantity,
                unit: bullet[2].toLowerCase(),
            };
        }
    }
    const ordinary = cleaned.match(/(?:^|\s)(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)(?=\s|,|;|•|$)/i);
    if (!ordinary)
        return null;
    const quantity = Number(ordinary[1].replace(',', '.'));
    if (!Number.isFinite(quantity) ||
        quantity <= 0 ||
        quantity > 10000) {
        return null;
    }
    return {
        quantity,
        unit: ordinary[2].toLowerCase(),
    };
}
/*
 * DŮLEŽITÁ OPRAVA:
 *
 * Nepoužíváme \b za "Kč".
 * JavaScript nepovažuje české "č" za běžný \w znak,
 * takže předchozí regex prakticky nenašel žádnou cenu.
 */
function money(value) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1_000_000
        ? parsed
        : null;
}
function productPrice(paragraph) {
    /*
     * Albert v textové vrstvě PDF často zapisuje hlavní cenu bez „Kč“:
     *   94,90/
     * nebo ji přilepí před název:
     *   379,Somat Excellence...
     *
     * Jednotkovou cenu typu „1 ks = 0,27 Kč“ naopak NESMÍME
     * zaměnit za cenu celého balení.
     */
    const slash = paragraph.match(/(?:^|\n)\s*(\d{1,5}(?:[,.]\d{1,2})?)\s*\/\s*(?:\n|$)/m);
    if (slash) {
        const value = money(slash[1]);
        if (value !== null)
            return value;
    }
    const glued = paragraph.match(/^\s*(\d{1,5}),(?=[A-ZÁ-Ž])/u);
    if (glued) {
        const value = money(glued[1]);
        if (value !== null)
            return value;
    }
    const standalone = [
        ...paragraph.matchAll(/(?:^|\n|•)\s*(\d{1,5}(?:[,.]\d{1,2})?)\s*Kč\s*(?=$|\n|•)/gim),
    ]
        .map((match) => money(match[1]))
        .filter((value) => value !== null);
    return standalone.at(-1) ?? null;
}
function productTitle(paragraph, bullet) {
    return paragraph
        .slice(0, bullet)
        .replace(/^\s*\d{1,5},(?=[A-ZÁ-Ž])/u, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line &&
        !/^\d{1,5}(?:[,.]\d{1,2})?\/?$/.test(line) &&
        !/^\d+[,.]?\d*$/.test(line) &&
        !/^(BĚŽNÁ CENA|BEZ APLIKACE|S APLIKACÍ|NEPORAZITELNÉ|SUPER CENA)$/i.test(line))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}
function paragraphValidity(paragraph, fallback) {
    const full = paragraph.match(/plat[ií]\s+(?:pouze\s+)?od\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s+do\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i);
    if (full) {
        const iso = (year, month, day) => `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        return {
            validFrom: iso(full[3], full[2], full[1]),
            validTo: iso(full[6], full[5], full[4]),
        };
    }
    const to = paragraph.match(/plat[ií]\s+do\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i);
    if (to) {
        return {
            validFrom: fallback.validFrom,
            validTo: `${to[3]}-${to[2].padStart(2, '0')}-${to[1].padStart(2, '0')}`,
        };
    }
    return fallback;
}
function parseAlbertSpreads(value, fetchedAt, publication) {
    if (!Array.isArray(value) ||
        value.length > 150 ||
        !/^\d{1,2}(?:sm|hm)_akcni_letak$/.test(publication) ||
        !Number.isFinite(Date.parse(fetchedAt))) {
        throw new Error('Neplatná data letáku Albert.');
    }
    const pages = value
        .flatMap((spread) => Array.isArray(spread.pages) ? spread.pages : [])
        .filter((page) => typeof page.text === 'string');
    if (!pages.length) {
        throw new Error('Leták Albert neobsahuje čitelný text.');
    }
    const dates = validity(pages
        .map((page) => page.text)
        .join('\n')
        .slice(0, 30_000));
    const offers = new Map();
    let skipped = 0;
    const hypermarket = publication.includes('hm_akcni_letak');
    for (const page of pages) {
        const number = page.pageNumber ?? page.number ?? 0;
        for (const rawParagraph of page.text.split(/\n\s*\n/)) {
            const paragraph = rawParagraph
                .replace(/\u00a0/g, ' ')
                .trim();
            if (!paragraph || paragraph.length > 2000) {
                continue;
            }
            if (/PŘI\s+KOUPI|BOD(?:Y)?\s+NAVÍC|\d+\s*\+\s*\d+\s*(?:ZDARMA|NAVÍC)?/i.test(paragraph)) {
                if (/Kč/i.test(paragraph))
                    skipped++;
                continue;
            }
            const bullet = paragraph.indexOf('•');
            if (bullet < 2) {
                if (/Kč/i.test(paragraph))
                    skipped++;
                continue;
            }
            const title = productTitle(paragraph, bullet);
            const parsedPack = simplePack(paragraph.slice(bullet)) ??
                simplePack(paragraph);
            const price = productPrice(paragraph);
            const offerDates = paragraphValidity(paragraph, dates);
            if (!title ||
                title.length < 3 ||
                !parsedPack ||
                price === null) {
                if (/Kč/i.test(paragraph))
                    skipped++;
                continue;
            }
            const key = `${slugify(title)}-${parsedPack.quantity}${parsedPack.unit}`;
            const offer = {
                id: `albert-${publication}-${key}`,
                productKey: `albert-${key}`,
                retailer: 'Albert',
                productName: title,
                category: categoryFor(title),
                subcategory: '',
                price: Math.round(price * 100) / 100,
                ...parsedPack,
                ...offerDates,
                source: 'albert',
                sourceUrl: `https://letaky.albert.cz/${publication}/page/${number}`,
                storeName: hypermarket
                    ? 'Albert hypermarket · celostátní leták'
                    : 'Albert supermarket · celostátní leták',
                description: hypermarket
                    ? 'Cena z aktuálního letáku Albert Hypermarket. Dostupnost se může lišit podle prodejny.'
                    : 'Cena z aktuálního letáku Albert Supermarket. Dostupnost se může lišit podle prodejny.',
            };
            if (!(0, offerValidity_1.isOfferValid)(offer, offer.validFrom)) {
                skipped++;
                continue;
            }
            if (!offers.has(offer.id)) {
                offers.set(offer.id, offer);
            }
        }
    }
    if (!offers.size) {
        throw new Error(`Nenalezeny žádné použitelné nabídky Albert ${hypermarket ? 'Hypermarket' : 'Supermarket'}.`);
    }
    return {
        version: 1,
        source: 'albert',
        fetchedAt,
        scope: 'CZ-SM',
        publication,
        offers: [...offers.values()],
        skipped,
    };
}
function restoreAlbertCatalog(value) {
    const data = object(value);
    if (data.version !== 1 ||
        data.source !== 'albert' ||
        !['CZ-SM', 'CZ-ALL'].includes(String(data.scope)) ||
        typeof data.publication !== 'string' ||
        !/^\d{1,2}(?:sm|hm)_akcni_letak$/.test(data.publication) ||
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
            item.id.startsWith('albert-') &&
            typeof item.productKey === 'string' &&
            item.productKey.startsWith('albert-') &&
            item.retailer === 'Albert' &&
            item.source === 'albert' &&
            typeof item.sourceUrl === 'string' &&
            item.sourceUrl.startsWith('https://letaky.albert.cz/') &&
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
            ['g', 'kg', 'ml', 'l', 'ks'].includes(String(item.unit)) &&
            typeof item.validFrom === 'string' &&
            typeof item.validTo === 'string' &&
            (0, offerValidity_1.isOfferValid)(raw, item.validFrom));
    });
    return valid
        ? data
        : null;
}
