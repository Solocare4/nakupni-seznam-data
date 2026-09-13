"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIDL_DATA_URL = void 0;
exports.fetchLidlCatalog = fetchLidlCatalog;
const parse_1 = require("./parse");
async function fetchLidlHtmlCatalog(storePageUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
        const read = async (url) => {
            const response = await fetch(url, {
                signal: controller.signal,
                credentials: 'omit',
                headers: {
                    Accept: 'text/html,application/xhtml+xml',
                    'Cache-Control': 'no-cache',
                },
            });
            if (!response.ok) {
                throw new Error(`Zdroj Lidlu ${url} odpověděl chybou ${response.status}.`);
            }
            return response.text();
        };
        const fetchedAt = new Date().toISOString();
        const htmlCache = new Map();
        const urls = new Set();
        // Homepage běžně obsahuje hlavní pondělní/čtvrteční/víkendovou nabídku.
        const home = await read(parse_1.LIDL_HOME);
        htmlCache.set(parse_1.LIDL_HOME, home);
        for (const url of (0, parse_1.currentLidlUrls)(home))
            urls.add(url);
        // Lidl má samostatnou veřejnou stránku „Dalších 130 cen v klidu“.
        // Není vždy prolinkovaná přes akční kampaně, takže ji stahujeme explicitně.
        // Jde o potraviny/drogerii s veřejnou cenou, ne pouze Lidl Plus kupony.
        try {
            const steadyPrices = await read(parse_1.LIDL_URL);
            htmlCache.set(parse_1.LIDL_URL, steadyPrices);
            urls.add(parse_1.LIDL_URL);
            try {
                for (const url of (0, parse_1.currentLidlUrls)(steadyPrices))
                    urls.add(url);
            }
            catch {
                // Stránka může obsahovat přímo produktové karty bez dalších odkazů.
            }
        }
        catch {
            // Doplňkový zdroj nesmí shodit hlavní týdenní nabídku.
        }
        // Přehled aktuálních letáků obsahuje kampaně, které homepage nemusí odkazovat.
        try {
            const flyers = await read(parse_1.LIDL_FLYERS);
            htmlCache.set(parse_1.LIDL_FLYERS, flyers);
            urls.add(parse_1.LIDL_FLYERS);
            try {
                for (const url of (0, parse_1.currentLidlUrls)(flyers))
                    urls.add(url);
            }
            catch {
                // I samotná stránka letáků může obsahovat produktové karty.
            }
        }
        catch {
            // Rozšiřující zdroj není povinný.
        }
        // Stránka uživatelem vybrané prodejny umí zveřejnit další lokálně dostupné
        // letáky (např. Hity týdne), které na celostátní homepage nemusí být.
        if (storePageUrl?.startsWith('https://www.lidl.cz/s/')) {
            try {
                const storeHtml = await read(storePageUrl);
                htmlCache.set(storePageUrl, storeHtml);
                try {
                    for (const url of (0, parse_1.currentLidlUrls)(storeHtml))
                        urls.add(url);
                }
                catch {
                    // Některé prodejny odkazují pouze na obecnou stránku letáků.
                }
            }
            catch {
                // Nabídka je celostátní; výpadek stránky prodejny nesmí zablokovat refresh.
            }
        }
        // Týdenní hub obsahuje další potravinové sekce, které homepage nemusí odkazovat
        // přímo (ovoce a zelenina, maso, pečivo, značkové slevy atd.).
        // Pokud Lidl hub dočasně změní, homepage stále funguje jako bezpečný základ.
        try {
            const hub = await read(parse_1.LIDL_WEEKLY_HUB);
            htmlCache.set(parse_1.LIDL_WEEKLY_HUB, hub);
            urls.add(parse_1.LIDL_WEEKLY_HUB);
            try {
                for (const url of (0, parse_1.currentLidlUrls)(hub))
                    urls.add(url);
            }
            catch {
                // Hub může obsahovat produkty i bez dalších kategorií.
            }
        }
        catch {
            // Nepovinný rozšiřující zdroj.
        }
        // Z první vrstvy projdeme ještě odkazy na podsekce. Obsah stránky si zároveň
        // uložíme, aby se následně nestahoval podruhé při parsování.
        const firstLayer = [...urls].slice(0, 20);
        const discoveryConcurrency = 4;
        for (let start = 0; start < firstLayer.length; start += discoveryConcurrency) {
            const batchUrls = firstLayer.slice(start, start + discoveryConcurrency);
            const batch = await Promise.allSettled(batchUrls.map(async (url) => {
                const html = htmlCache.get(url) ?? await read(url);
                htmlCache.set(url, html);
                return { url, html };
            }));
            for (const result of batch) {
                if (result.status !== 'fulfilled')
                    continue;
                try {
                    for (const nested of (0, parse_1.currentLidlUrls)(result.value.html))
                        urls.add(nested);
                }
                catch {
                    // Produktová stránka bez dalších odkazů je normální.
                }
            }
        }
        const allUrls = [...urls].slice(0, 40);
        ;
        for (const url of allUrls)
            ;
        const catalogs = [];
        const concurrency = 4;
        for (let start = 0; start < allUrls.length; start += concurrency) {
            const batchUrls = allUrls.slice(start, start + concurrency);
            const batch = await Promise.allSettled(batchUrls.map(async (url) => {
                const html = htmlCache.get(url) ?? await read(url);
                htmlCache.set(url, html);
                const catalog = (0, parse_1.parseLidlHtml)(html, fetchedAt, url !== parse_1.LIDL_URL);
                ;
                return catalog;
            }));
            for (const result of batch) {
                if (result.status === 'fulfilled')
                    catalogs.push(result.value);
            }
        }
        const byProduct = new Map();
        for (const offer of catalogs.flatMap((catalog) => catalog.offers)) {
            const previous = byProduct.get(offer.productKey);
            const preferCurrent = !previous ||
                offer.price < previous.price ||
                (offer.price === previous.price &&
                    offer.storeName === 'Lidl · akční nabídka' &&
                    previous.storeName !== 'Lidl · akční nabídka');
            if (preferCurrent)
                byProduct.set(offer.productKey, offer);
        }
        const offers = [...byProduct.values()];
        ;
        if (!offers.length) {
            throw new Error('Nenalezeny žádné aktuální nabídky Lidlu.');
        }
        return {
            version: 1,
            source: 'lidl',
            fetchedAt,
            scope: 'CZ',
            offers,
            skipped: catalogs.reduce((sum, catalog) => sum + catalog.skipped, 0),
        };
    }
    finally {
        clearTimeout(timeout);
    }
}
exports.LIDL_DATA_URL = 'https://raw.githubusercontent.com/Solocare4/nakupni-seznam-data/main/data/lidlCatalog.json';
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
async function fetchGeneratedLidlCatalog() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(`${exports.LIDL_DATA_URL}?t=${Date.now()}`, {
            signal: controller.signal,
            credentials: 'omit',
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
            },
        });
        if (!response.ok) {
            throw new Error(`Lidl datový katalog vrátil HTTP ${response.status}.`);
        }
        if (typeof response.json !== 'function') {
            throw new Error('Lidl datový katalog nevrátil JSON odpověď.');
        }
        const raw = await response.json();
        const rawObject = raw && typeof raw === 'object' && !Array.isArray(raw)
            ? raw
            : {};
        if (typeof rawObject.pipelineVersion !== 'number' || rawObject.pipelineVersion < 3) {
            throw new Error('Lidl datový katalog je ze starší pipeline; ponecháme kvalitnější lokální PDF katalog.');
        }
        const catalog = (0, parse_1.restoreLidlCatalog)(raw);
        if (!catalog) {
            throw new Error('Lidl datový katalog neprošel validací.');
        }
        const today = czechToday();
        const active = catalog.offers.filter((offer) => offer.validFrom <= today && offer.validTo >= today);
        if (!active.length) {
            throw new Error(`Lidl datový katalog nemá nabídky platné pro ${today}.`);
        }
        ;
        return {
            ...catalog,
            offers: active,
        };
    }
    finally {
        clearTimeout(timer);
    }
}
async function fetchLidlCatalog(storePageUrl) {
    try {
        return await fetchGeneratedLidlCatalog();
    }
    catch (error) {
        ;
        return fetchLidlHtmlCatalog(storePageUrl);
    }
}
