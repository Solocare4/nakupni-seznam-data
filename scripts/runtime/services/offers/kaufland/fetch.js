"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchKauflandCatalog = fetchKauflandCatalog;
const parse_1 = require("./parse");
async function fetchKauflandCatalog(store = parse_1.defaultKauflandStore) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        const response = await fetch(store.url, { signal: controller.signal, credentials: 'omit' });
        if (!response.ok)
            throw new Error(`Zdroj nabídek odpověděl chybou ${response.status}.`);
        const html = await response.text();
        return (0, parse_1.parseKauflandHtml)(html, new Date().toISOString(), store);
    }
    finally {
        clearTimeout(timer);
    }
}
