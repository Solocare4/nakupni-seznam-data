// Publication dates must come from the retailer's exact edition, not from the
// first product/campaign date mentioned anywhere in the PDF text.
function albertPublications(data) {
  if (!data?.hypermarket?.leaflets || !data?.supermarket?.leaflets) throw Error('Albert publication overview unavailable');
  const iso = value => {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value || '');
    if (!m) throw Error('Invalid Albert publication date');
    const result = `${m[3]}-${m[2]}-${m[1]}`;
    if (new Date(`${result}T12:00:00Z`).toISOString().slice(0,10) !== result) throw Error('Invalid Albert publication date');
    return result;
  };
  const editions = new Map();
  for (const leaflet of [...data.hypermarket.leaflets,...data.supermarket.leaflets]) {
    const match = /^https:\/\/letaky\.albert\.cz\/(\d{1,2}(?:sm|hm)_akcni_letak)\/?$/.exec(leaflet.viewUrl || '');
    if (!match) continue;
    const dates = { validFrom: iso(leaflet.validityStartDateFormatted), validTo: iso(leaflet.validityEndDateFormatted) };
    if (dates.validTo < dates.validFrom) throw Error('Reversed Albert publication dates');
    const previous = editions.get(match[1]);
    if (previous && JSON.stringify(previous) !== JSON.stringify(dates)) throw Error('Conflicting Albert publication dates');
    editions.set(match[1],dates);
  }
  if (!editions.size) throw Error('No regular Albert publications');
  return [...editions].map(([publication,dates])=>({publication,...dates}));
}
async function fetchAlbertOverview() {
  const query='query {hypermarket:getLeaflets(locationType:"HYPERMARKET" onlyDefault:false){leaflets{viewUrl validityStartDateFormatted validityEndDateFormatted stores{localizedName}}}supermarket:getLeaflets(locationType:"SUPERMARKET" onlyDefault:false){leaflets{viewUrl validityStartDateFormatted validityEndDateFormatted stores{localizedName}}}}';
  const url=new URL('https://www.albert.cz/api/v1/');url.searchParams.set('query',query);
  const response=await fetch(url,{headers:{'Content-Type':'application/json','apollo-require-preflight':'true'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Albert overview HTTP '+response.status);
  const body=await response.json();if(body.errors)throw Error('Albert overview query failed');
  return body.data;
}
module.exports={albertPublications,fetchAlbertOverview};
