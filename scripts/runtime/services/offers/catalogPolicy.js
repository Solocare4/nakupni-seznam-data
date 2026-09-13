"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.offerIdentity = void 0;
exports.catalogDay = catalogDay;
exports.mergeCatalog = mergeCatalog;
exports.refreshDue = refreshDue;
function catalogDay(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}
const offerIdentity = (o) => [o.retailer, o.productName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(), o.quantity, o.unit, o.price, o.validFrom, o.validTo, o.loyaltyOnly ? o.loyaltyProgram : ''].join('|');
exports.offerIdentity = offerIdentity;
function resolveSourceRevisions(offers) {
    const revisions = new Map();
    for (const offer of offers) {
        // Albert's HTML and PDF refer to the same publication row, sometimes with
        // conflicting prices. Keep the geometrically verified PDF in that case.
        const key = offer.source === 'albert'
            ? [offer.source, offer.id, offer.quantity, offer.unit, offer.validFrom, offer.validTo, offer.storeName, offer.loyaltyOnly, offer.loyaltyProgram].join('|')
            : (0, exports.offerIdentity)(offer);
        const previous = revisions.get(key);
        const verified = (o) => o.verification === 'pdf-layout-v1';
        if (previous && verified(previous) && !verified(offer))
            continue;
        revisions.set(key, offer);
    }
    return [...new Map([...revisions.values()].map(o => [(0, exports.offerIdentity)(o), o])).values()];
}
/** Retain overlapping publications; never extend any individual offer's dates. */
function mergeCatalog(current, incoming) {
    if (!incoming.offers.length)
        throw new Error('Prázdný katalog');
    if (!current)
        return { ...incoming, offers: resolveSourceRevisions(incoming.offers) };
    const oldRevision = current.pipelineVersion ?? 0;
    const newRevision = incoming.pipelineVersion ?? 0;
    if (newRevision > oldRevision && incoming.offers[0]?.source === 'lidl')
        return mergeCatalog(null, incoming);
    const day = catalogDay(new Date(incoming.fetchedAt));
    const retained = current.offers.filter(o => o.validTo >= day);
    const overlap = retained.some(a => incoming.offers.some(b => a.validFrom <= b.validTo && b.validFrom <= a.validTo));
    if (!overlap)
        return mergeCatalog(null, incoming);
    const pdfCount = retained.filter(o => o.id.startsWith('lidl-pdf-')).length;
    if (pdfCount >= 50 && !incoming.offers.some(o => o.id.startsWith('lidl-pdf-')) && incoming.offers.length < pdfCount)
        return current;
    const offers = new Map(retained.map(o => [(0, exports.offerIdentity)(o), o]));
    for (const next of incoming.offers) {
        const old = offers.get((0, exports.offerIdentity)(next));
        offers.set((0, exports.offerIdentity)(next), { ...old, ...next, imageUrl: next.imageUrl ?? old?.imageUrl });
    }
    return { ...incoming, offers: resolveSourceRevisions([...offers.values()]) };
}
function refreshDue(offers, checkedAt, now = Date.now()) {
    const day = catalogDay(new Date(now));
    return !checkedAt || now < checkedAt || now - checkedAt >= 6 * 60 * 60 * 1000 ||
        (catalogDay(new Date(checkedAt)) !== day && offers.some(o => o.validFrom === day || o.validTo < day && o.validTo >= catalogDay(new Date(checkedAt)))) ||
        !offers.some(o => o.validFrom <= day && o.validTo >= day);
}
