const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|amp);/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
function date(s){const m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);return m?`${m[3]}-${m[2]}-${m[1]}`:'';}
function albertCoverage(offers, data, branches) {
 if(!data?.hypermarket?.leaflets || !data?.supermarket?.leaflets) throw Error('Albert branch coverage unavailable');
 const names=new Map();for(const b of branches.filter(b=>b.retailer==='Albert')){const n=norm(b.name.replace(/^Albert\s+/,''));names.set(n,[...(names.get(n)||[]),b.id]);}
 const leaflets=[...data.hypermarket.leaflets,...data.supermarket.leaflets];
 return offers.map(o=>{const matches=leaflets.filter(l=>typeof l.viewUrl==='string'&&l.viewUrl.startsWith('https://letaky.albert.cz/')&&o.sourceUrl?.startsWith(l.viewUrl.endsWith('/')?l.viewUrl:l.viewUrl+'/')&&date(l.validityStartDateFormatted)&&date(l.validityEndDateFormatted)&&date(l.validityStartDateFormatted)<=o.validFrom&&date(l.validityEndDateFormatted)>=o.validTo);
 const ids=new Set(matches.flatMap(l=>(l.stores||[]).flatMap(s=>{const a=names.get(norm(s.localizedName));return a?.length===1?a:[]})));
 return {...o,applicableBranchIds:[...ids],branchVerificationUrl:'https://www.albert.cz/aktualni-letaky'};
 });
}
async function enrichAlbert(source,offers,branches){
 if(source!=='albert')return offers;
 const query='query {hypermarket:getLeaflets(locationType:"HYPERMARKET" onlyDefault:false){leaflets{viewUrl validityStartDateFormatted validityEndDateFormatted stores{localizedName}}}supermarket:getLeaflets(locationType:"SUPERMARKET" onlyDefault:false){leaflets{viewUrl validityStartDateFormatted validityEndDateFormatted stores{localizedName}}}}';
 const url=new URL('https://www.albert.cz/api/v1/');url.searchParams.set('query',query);
 const response=await fetch(url,{headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Albert coverage HTTP '+response.status);
 const body=await response.json();if(body.errors)throw Error('Albert coverage query failed');return albertCoverage(offers,body.data,branches);
}

function nuxtValues(html){const m=html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);if(!m)throw Error('Missing public page data');return JSON.parse(m[1]);}
function billaCoverage(offers,html,storeHtml,branches){
 const values=nuxtValues(html),rules=values.filter(v=>typeof v==='string'&&v.includes('Leták neplatí pro prodejny:'));
 if(rules.length!==1)throw Error('BILLA exceptions missing or ambiguous');
 const terms=norm(rules[0]).replace(/^.*letak neplati pro prodejny:\s*/,'');
 const exceptions=terms.split(';').map(s=>s.trim()).filter(Boolean);
 if(exceptions.length<3||!exceptions.some(s=>s.includes('billa viva'))||!exceptions.some(s=>s.includes('stop')))throw Error('BILLA exception format changed');
 // Exclude the entire named town when street identity cannot be proven. This
 // intentionally loses some coverage instead of admitting a listed exception.
 const excludedCities=exceptions.filter(s=>!s.startsWith('billa ')).map(s=>s.split(':')[0].trim());
 const stores=nuxtValues(storeHtml),regularIds=new Set(stores.filter(s=>s&&typeof s==='object'&&'storeId'in s&&norm(stores[s.brand])==='billa,').map(s=>'billa-'+String(stores[s.storeId]).toLowerCase()));
 if(!regularIds.size)throw Error('BILLA regular stores missing');
 const ids=branches.filter(b=>b.retailer==='Billa'&&regularIds.has(b.id)&&!excludedCities.some(c=>norm(b.city)===c||norm(b.city).startsWith(c+' '))).map(b=>b.id);
 const pdfs=values.filter(v=>typeof v==='string'&&/^https:\/\/view\.publitas\.com\/\d+\/\d+\/pdfs\//.test(v)).map(v=>v.split('?')[0]);
 return offers.map(o=>({...o,applicableBranchIds:pdfs.includes(o.flyerUrl?.split('#')[0])?ids:[],branchVerificationUrl:'https://www.billa.cz/letaky-billa/velky-letak-aktualni'}));
}

async function enrich(source,offers,branches){
 if(source!=='billa')return enrichAlbert(source,offers,branches);
 const pages=await Promise.all(['https://www.billa.cz/letaky-billa/velky-letak-aktualni','https://www.billa.cz/prodejny'].map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('BILLA coverage HTTP '+r.status);return r.text()}));
 return billaCoverage(offers,...pages,branches);
};
module.exports={enrich,albertCoverage,billaCoverage};

