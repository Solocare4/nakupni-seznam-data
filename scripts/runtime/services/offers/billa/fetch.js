"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BILLA_DATA_URL = void 0;
exports.fetchBillaCatalog = fetchBillaCatalog;
const parse_1 = require("./parse");
exports.BILLA_DATA_URL = 'https://raw.githubusercontent.com/Solocare4/nakupni-seznam-data/main/data/billaCatalog.json';
function object(value) {
    return value &&
        typeof value === 'object' &&
        !Array.isArray(value)
        ? value
        : {};
}
async function fetchWithTimeout(url, timeoutMs, accept) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, timeoutMs);
    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: accept,
            },
        });
    }
    finally {
        clearTimeout(timer);
    }
}
function czechToday() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Prague',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return `${value('year')}-${value('month')}-${value('day')}`;
}
async function fetchGeneratedCatalog() {
    /*
     * Cache-busting je důležitý, protože soubor na GitHubu
     * se pravidelně přepisuje novým letákem.
     */
    const url = `${exports.BILLA_DATA_URL}?t=${Date.now()}`;
    const response = await fetchWithTimeout(url, 20000, 'application/json');
    if (!response.ok) {
        throw new Error(`BILLA datový katalog vrátil HTTP ${response.status}.`);
    }
    const raw = await response.json();
    const catalog = (0, parse_1.restoreBillaCatalog)(raw);
    if (!catalog) {
        const rawObject = object(raw);
        const rawOffers = Array.isArray(rawObject.offers)
            ? rawObject.offers.length
            : 0;
        throw new Error(`BILLA datový katalog neprošel validací. Raw nabídek: ${rawOffers}.`);
    }
    const today = czechToday();
    const currentOffers = catalog.offers.filter((offer) => offer.validFrom <= today &&
        offer.validTo >= today);
    if (!currentOffers.length) {
        throw new Error(`BILLA datový katalog nemá nabídky platné pro ${today}.`);
    }
    ;
    return catalog;
}
async function fetchHomepageFallback() {
    ;
    const response = await fetchWithTimeout(parse_1.BILLA_URL, 30000, 'text/html,application/xhtml+xml');
    if (!response.ok) {
        throw new Error(`BILLA web vrátil HTTP ${response.status}.`);
    }
    const html = await response.text();
    const catalog = (0, parse_1.parseBillaHtml)(html, new Date().toISOString());
    ;
    return catalog;
}
async function fetchBillaCatalog() {
    try {
        return await fetchGeneratedCatalog();
    }
    catch (error) {
        ;
        return fetchHomepageFallback();
    }
}
