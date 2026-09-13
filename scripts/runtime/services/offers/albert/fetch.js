"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAlbertCatalog = fetchAlbertCatalog;
const parse_1 = require("./parse");
async function fetchAlbertCatalog() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
        const overview = await fetch(parse_1.ALBERT_URL, {
            signal: controller.signal,
            credentials: 'omit',
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'Cache-Control': 'no-cache',
            },
        });
        if (!overview.ok) {
            throw new Error(`Přehled Alberta odpověděl chybou ${overview.status}.`);
        }
        const html = await overview.text();
        /*
         * Na stránce mohou být zároveň supermarketové, hypermarketové,
         * tematické i připravované letáky. Načteme všechny nalezené
         * akční SM/HM publikace a až poté jejich nabídky sloučíme.
         * Tím nejsme závislí na pořadí odkazů v HTML.
         */
        const publications = (0, parse_1.currentAlbertPublications)(html)
            .filter((publication) => /(?:sm|hm)_akcni_letak$/.test(publication))
            .slice(0, 8);
        if (!publications.length) {
            throw new Error('Albert: na stránce nebyl nalezen supermarketový ani hypermarketový akční leták.');
        }
        const fetchedAt = new Date().toISOString();
        const results = await Promise.allSettled(publications.map(async (publication) => {
            const url = `https://letaky.albert.cz/${publication}/spreads.json`;
            const response = await fetch(url, {
                signal: controller.signal,
                credentials: 'omit',
                headers: {
                    Accept: 'application/json',
                    'Cache-Control': 'no-cache',
                },
            });
            if (!response.ok) {
                throw new Error(`${publication}: HTTP ${response.status}`);
            }
            return (0, parse_1.parseAlbertSpreads)(await response.json(), fetchedAt, publication);
        }));
        const catalogs = results.flatMap((result) => result.status ===
            'fulfilled'
            ? [result.value]
            : []);
        /*
         * Když oba selžou, zobrazíme skutečný důvod.
         */
        if (!catalogs.length) {
            const errors = results.map((result, index) => {
                if (result.status ===
                    'fulfilled') {
                    return '';
                }
                const reason = result.reason;
                return `${publications[index]}: ${reason instanceof Error
                    ? reason.message
                    : String(reason)}`;
            })
                .filter(Boolean)
                .join(' | ');
            throw new Error(`Albert: nepodařilo se načíst letáky. ${errors}`);
        }
        /*
         * Sloučení supermarket + hypermarket.
         */
        const merged = new Map();
        for (const catalog of catalogs) {
            for (const offer of catalog.offers) {
                const normalizedName = offer.productName
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                const key = [
                    normalizedName,
                    offer.quantity,
                    offer.unit,
                    offer.price,
                    offer.validFrom,
                    offer.validTo,
                ].join('|');
                const existing = merged.get(key);
                if (!existing) {
                    merged.set(key, { ...offer });
                    continue;
                }
                existing.storeName =
                    'Albert · supermarket i hypermarket';
                existing.description =
                    'Cena je uvedena v aktuálním supermarketovém i hypermarketovém letáku Albert. Dostupnost se může lišit podle prodejny.';
            }
        }
        const offers = [...merged.values()];
        if (!offers.length) {
            throw new Error('Albert: letáky neobsahují žádné použitelné nabídky.');
        }
        const primary = catalogs.find((catalog) => catalog.publication.includes('sm_')) ??
            catalogs[0];
        return {
            version: 1,
            source: 'albert',
            fetchedAt,
            scope: 'CZ-ALL',
            publication: primary.publication,
            offers,
            skipped: catalogs.reduce((sum, catalog) => sum +
                catalog.skipped, 0),
        };
    }
    finally {
        clearTimeout(timeout);
    }
}
