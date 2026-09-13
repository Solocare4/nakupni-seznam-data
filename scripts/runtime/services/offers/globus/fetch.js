"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGlobusCatalog = fetchGlobusCatalog;
const parse_1 = require("./parse");
async function fetchGlobusCatalog(store = parse_1.defaultGlobusStore) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const fetchedAt = new Date().toISOString();
    const url = (0, parse_1.globusUrl)(store);
    const read = async (page) => {
        const pageUrl = page === 1
            ? url
            : `${url}?page=${page}`;
        const response = await fetch(pageUrl, {
            signal: controller.signal,
            credentials: 'omit',
        });
        if (!response.ok) {
            throw new Error(`Globus: stránka ${page} odpověděla chybou ${response.status}.`);
        }
        /*
         * Číslo stránky předáváme
         * parseru přímo.
         */
        return (0, parse_1.parseGlobusHtml)(await response.text(), fetchedAt, store, page);
    };
    try {
        const first = await read(1);
        const totalPages = first.totalPages;
        const catalogs = [
            first.catalog,
        ];
        /*
         * Stahujeme po čtyřech
         * stránkách.
         */
        const concurrency = 4;
        for (let start = 2; start <=
            totalPages; start +=
            concurrency) {
            const end = Math.min(totalPages, start +
                concurrency -
                1);
            const pages = Array.from({
                length: end -
                    start +
                    1,
            }, (_, index) => start +
                index);
            const results = await Promise.allSettled(pages.map((page) => read(page)));
            catalogs.push(...results.flatMap((result) => result.status === 'fulfilled' ? [result.value.catalog] : []));
        }
        const offers = [
            ...new Map(catalogs
                .flatMap((catalog) => catalog.offers)
                .map((offer) => [
                offer.id,
                offer,
            ])).values(),
        ];
        const skipped = catalogs.reduce((sum, catalog) => sum +
            catalog.skipped, 0);
        const catalog = {
            ...first.catalog,
            offers,
            skipped,
            partial: catalogs.length < totalPages,
        };
        if (!(0, parse_1.restoreGlobusCatalog)(catalog)) {
            throw new Error('Globus: kompletní katalog neprošel kontrolou.');
        }
        return catalog;
    }
    finally {
        clearTimeout(timer);
    }
}
