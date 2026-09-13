"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreGlobusCatalog = exports.defaultGlobusStore = void 0;
exports.globusUrl = globusUrl;
exports.parseGlobusHtml = parseGlobusHtml;
const parse_1 = require("../penny/parse");
const publicCatalog_1 = require("../publicCatalog");
exports.defaultGlobusStore = {
    storeId: 'cerny-most',
    storeName: 'Globus Praha-Černý Most',
};
function globusUrl(store) {
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(store.storeId)) {
        throw new Error('Neplatná pobočka Globusu.');
    }
    return `https://www.globus.cz/${store.storeId}/hypermarket/akcni-nabidka`;
}
const restoreGlobusCatalog = (value) => (0, publicCatalog_1.restorePublicCatalog)(value, 'globus');
exports.restoreGlobusCatalog = restoreGlobusCatalog;
function parseGlobusHtml(html, fetchedAt, store = exports.defaultGlobusStore, expectedPage = 1) {
    const sourceUrl = globusUrl(store);
    const { data, decode } = (0, publicCatalog_1.nuxtData)(html);
    const paths = data.flatMap(item => {
        const entry = (0, publicCatalog_1.object)(item);
        if (typeof entry.path !== 'number')
            return [];
        const path = decode(entry.path);
        return typeof path === 'string' && path.startsWith('/') ? [path] : [];
    });
    const expectedPath = new URL(sourceUrl).pathname;
    if (!paths.some(path => path.split('?')[0] === expectedPath)) {
        throw new Error('Globus vrátil nabídku jiné nebo neověřené pobočky.');
    }
    const listing = data.find((item) => {
        const value = (0, publicCatalog_1.object)(item);
        return ('totalItems' in value &&
            'items' in value);
    });
    if (!listing) {
        throw new Error('Globus změnil formát nabídek.');
    }
    const rawListing = (0, publicCatalog_1.object)(listing);
    const page = decode(rawListing.page);
    if (!Number.isInteger(page) || page !== expectedPage) {
        throw new Error('Globus nevrátil požadovanou stránku.');
    }
    /*
     * DŮLEŽITÁ OPRAVA:
     *
     * Nuxt ukládá hodnoty jako odkazy do __NUXT_DATA__.
     * Místo dekódování celého listing objektu načteme
     * jednotlivé reference přímo.
     */
    const decodedItems = decode(rawListing.items);
    if (!Array.isArray(decodedItems)) {
        throw new Error('Globus: seznam produktů není čitelný.');
    }
    const totalItemsValue = decode(rawListing.totalItems);
    const totalPagesValue = 'totalPages' in rawListing
        ? decode(rawListing.totalPages)
        : null;
    const totalItems = Number(totalItemsValue);
    let totalPages = Number(totalPagesValue);
    /*
     * Pokud Globus přestane publikovat totalPages,
     * dokážeme počet stránek odvodit z počtu produktů.
     */
    if (!Number.isInteger(totalPages) ||
        totalPages < 1) {
        if (Number.isFinite(totalItems) &&
            totalItems > 0 &&
            decodedItems.length > 0) {
            totalPages = Math.max(1, Math.ceil(totalItems / decodedItems.length));
        }
        else {
            totalPages = 1;
        }
    }
    if (totalPages > 200) {
        throw new Error(`Globus: podezřelý počet stránek (${totalPages}).`);
    }
    const offers = [];
    let skipped = 0;
    for (const raw of decodedItems) {
        const product = (0, publicCatalog_1.object)(raw);
        const priceData = (0, publicCatalog_1.object)(product.productInHouse);
        const name = (0, publicCatalog_1.clean)(product.name);
        const id = (0, publicCatalog_1.clean)(product.vanr);
        const unit = (0, publicCatalog_1.clean)(product.unitId).toLowerCase();
        const price = priceData.actualPrice;
        const quantity = product.unitAmount;
        const validFrom = (0, publicCatalog_1.clean)(priceData.priceValidFrom).slice(0, 10);
        const validTo = (0, publicCatalog_1.clean)(priceData.priceValidTo).slice(0, 10);
        if (!/^\d+$/.test(id) ||
            !name ||
            !['g', 'kg', 'ml', 'l', 'ks'].includes(unit) ||
            typeof price !== 'number' ||
            !Number.isFinite(price) ||
            price <= 0 ||
            typeof quantity !== 'number' ||
            !Number.isFinite(quantity) ||
            quantity <= 0 ||
            product.baseVariantQuantity !== 1 ||
            priceData.isActive !== true ||
            priceData.priceType !== 'VKA0' ||
            /při (koupi|nákupu)|od\s*\d+\s*ks|\d+\s*\+\s*\d+/i.test(`${name} ${(0, publicCatalog_1.clean)(product.sellUnitSizeText)}`)) {
            skipped++;
            continue;
        }
        const categories = Array.isArray(product.productCategories)
            ? product.productCategories.join(' ')
            : '';
        const normalName = name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        const category = /drugstore|household|animal_world|cls_czr_car/.test(categories)
            ? 'home'
            : /drinks/.test(categories)
                ? 'drinks'
                : /ice_cream|frozen/.test(categories)
                    ? 'frozen'
                    : /meat_and_fish/.test(categories)
                        ? 'meat'
                        : /milk_dairy_products_and_eggs/.test(categories)
                            ? 'dairy'
                            : /fresh_fruit|fresh_vegetables|fruit_and_vegetables/.test(categories)
                                ? 'produce'
                                : (0, parse_1.categoryFor)(name);
        const offer = {
            id: `globus-${store.storeId}-${id}-${validFrom}`,
            productKey: `globus-${id}`,
            source: 'globus',
            retailer: 'Globus',
            productName: name,
            category,
            subcategory: '',
            price,
            quantity,
            unit,
            validFrom,
            validTo,
            sourceUrl,
            storeName: store.storeName,
            description: `Cena bez klubu Můj Globus. Platí pro ${store.storeName}.`,
            imageUrl: (0, publicCatalog_1.safeImage)(product.imgThumbnail, 'globus'),
        };
        if (unit === 'kg' &&
            quantity === 1 &&
            !product.sellUnitSizeText) {
            offer.soldByWeight = true;
        }
        if (typeof priceData.originalPrice === 'number' &&
            Number.isFinite(priceData.originalPrice) &&
            priceData.originalPrice > price) {
            offer.regularPrice = priceData.originalPrice;
        }
        const candidate = {
            version: 1,
            source: 'globus',
            fetchedAt,
            storeId: store.storeId,
            offers: [offer],
            skipped: 0,
            partial: true,
        };
        if ((0, exports.restoreGlobusCatalog)(candidate)) {
            offers.push(offer);
        }
        else {
            skipped++;
        }
    }
    return {
        catalog: {
            version: 1,
            source: 'globus',
            fetchedAt,
            storeId: store.storeId,
            offers,
            skipped,
            partial: expectedPage < totalPages,
        },
        page,
        totalPages,
    };
}
