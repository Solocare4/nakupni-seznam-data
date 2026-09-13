"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATALOG_BASE_URL = void 0;
exports.fetchCatalogManifest = fetchCatalogManifest;
exports.fetchPublishedCatalog = fetchPublishedCatalog;
const catalogPolicy_1 = require("./catalogPolicy");
exports.CATALOG_BASE_URL = 'https://raw.githubusercontent.com/Solocare4/nakupni-seznam-data/main/public/';
async function json(url) {
    let failure;
    for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
            const response = await fetch(url, { signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/json' } });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            return await response.json();
        }
        catch (error) {
            failure = error;
        }
        finally {
            clearTimeout(timer);
        }
    }
    throw failure;
}
async function fetchCatalogManifest() {
    const value = await json(`${exports.CATALOG_BASE_URL}manifest.json?check=${Math.floor(Date.now() / 60000)}`);
    if (value?.version !== 1 || !value.catalogs || typeof value.catalogs !== 'object')
        throw new Error('Neplatný přehled katalogů');
    return value;
}
async function fetchPublishedCatalog(manifest, key, current, restore) {
    const entry = manifest.catalogs[key];
    if (!entry || !/^[a-zA-Z0-9/-]+\.json$/.test(entry.path) || entry.path.includes('..') || !/^[a-f0-9]{64}$/.test(entry.catalogVersion))
        throw new Error('Katalog pro vybranou prodejnu není dostupný');
    const today = (0, catalogPolicy_1.catalogDay)();
    if (typeof entry.validTo !== 'string' || entry.validTo < today)
        throw new Error('Nový leták zatím není dostupný');
    if (current && current.catalogVersion === entry.catalogVersion)
        return current;
    const raw = await json(`${exports.CATALOG_BASE_URL}${entry.path}?v=${entry.catalogVersion}`);
    const catalog = restore(raw);
    if (!catalog || catalog.offers.length !== entry.count || raw.catalogVersion !== entry.catalogVersion)
        throw new Error('Katalog neprošel kontrolou');
    if (!catalog.offers.some(o => { const offer = o; return offer.validFrom <= today && offer.validTo >= today; }))
        throw new Error('Katalog neobsahuje dnešní nabídky');
    if (key.includes('/') && raw.storeId !== key.split('/')[1])
        throw new Error('Katalog jiné prodejny');
    return catalog;
}
