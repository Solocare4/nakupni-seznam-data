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

function addressKey(value){return norm(value).replace(/\bnam\./g,'namesti').replace(/[^a-z0-9]/g,'');}
function streetKey(value){return addressKey(norm(value).replace(/\s+\d+[a-z]?(?:\/\d+[a-z]?)?$/,''));}
function sameStreet(street,rule){
 if(streetKey(street)===streetKey(rule))return true;
 const short=norm(rule).match(/^([a-z])\.\s*(.+)$/);
 const full=norm(street).replace(/\s+\d+[a-z]?(?:\/\d+[a-z]?)?$/,'').split(/\s+/);
 return Boolean(short&&full.length>1&&full[0].startsWith(short[1])&&addressKey(full.slice(1).join(' '))===addressKey(short[2]));
}
function billaExcludedStores(exceptions,stores){
 const excluded=new Set();
 for(const exception of exceptions.filter(s=>!s.startsWith('billa '))){
  const [city,...parts]=exception.split(':');
  const candidates=stores.filter(s=>{const c=norm(s.city);return c===city||c.startsWith(city+' ')||c.startsWith(city+'-');});
  if(!parts.length){candidates.forEach(s=>excluded.add(s.id));continue;}
  for(const location of parts.join(':').split(',').map(s=>s.trim()).filter(Boolean)){
   const components=location.split(/\s+[–—]\s+/);
   const matches=candidates.filter(s=>components.some(c=>sameStreet(s.street,c)||addressKey(s.name).includes(addressKey(c))) || (location==='letiste ruzyne' && norm(s.name).includes('letiste')));
   // Named shopping centres distinguish two shops on the same street.
   const named=components.length>1?matches.filter(s=>components.some(c=>addressKey(s.name).includes(addressKey(c)))):[];
   (named.length?named:matches).forEach(s=>excluded.add(s.id));
  }
 }
 return excluded;
}

function billaCoverage(offers,html,storeHtml,branches){
 const values=nuxtValues(html),rules=values.filter(v=>typeof v==='string'&&v.includes('Leták neplatí pro prodejny:'));
 if(rules.length!==1)throw Error('BILLA exceptions missing or ambiguous');
 const terms=norm(rules[0]).replace(/^.*letak neplati pro prodejny:\s*/,'');
 const exceptions=terms.split(';').map(s=>s.trim()).filter(Boolean);
 if(exceptions.length<3||!exceptions.some(s=>s.includes('billa viva'))||!exceptions.some(s=>s.includes('stop')))throw Error('BILLA exception format changed');
 const stores=nuxtValues(storeHtml);
 const regular=stores.filter(s=>s&&typeof s==='object'&&'storeId'in s&&norm(stores[s.brand])==='billa,').map(s=>({id:'billa-'+String(stores[s.storeId]).toLowerCase(),city:stores[s.city],street:stores[s.street],name:stores[s.displayName]}));
 if(!regular.length||regular.some(s=>typeof s.city!=='string'||typeof s.street!=='string'||!s.street.trim()))throw Error('BILLA regular store addresses missing');
 const excluded=billaExcludedStores(exceptions,regular);
 const ids=branches.filter(b=>b.retailer==='Billa'&&regular.some(s=>s.id===b.id)&&!excluded.has(b.id)).map(b=>b.id);
 const pdfs=values.filter(v=>typeof v==='string'&&/^https:\/\/view\.publitas\.com\/\d+\/\d+\/pdfs\//.test(v)).map(v=>v.split('?')[0]);
 return offers.map(o=>({...o,applicableBranchIds:pdfs.includes(o.flyerUrl?.split('#')[0])?ids:[],branchVerificationUrl:'https://www.billa.cz/letaky-billa/velky-letak-aktualni'}));
}

async function enrich(source,offers,branches){
 if(source!=='billa')return enrichAlbert(source,offers,branches);
 const pages=await Promise.all(['https://www.billa.cz/letaky-billa/velky-letak-aktualni','https://www.billa.cz/prodejny'].map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('BILLA coverage HTTP '+r.status);return r.text()}));
 return billaCoverage(offers,...pages,branches);
};
module.exports={enrich,albertCoverage,billaCoverage};

function plain(html){return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();}
function lidlCoverage(offers,overview,branches){
 if(overview?.success!==true || !Array.isArray(overview.categories))throw Error('Lidl coverage unavailable');
 const flyers=overview.categories.flatMap(c=>(c.subcategories||[]).flatMap(s=>s.flyers||[]));
 const ids=branches.filter(b=>b.retailer==='Lidl'&&!/outlet/i.test(b.name)).map(b=>b.id);
 return offers.map(o=>{const f=flyers.find(f=>f.pdfUrl===o.flyerUrl?.split('#')[0]);
 const national=f?.regions?.length===1&&f.regions[0].type==='national'&&String(f.regions[0].code)==='0';
 const valid=national&&/^\d{4}-\d{2}-\d{2}$/.test(f.offerStartDate)&&/^\d{4}-\d{2}-\d{2}$/.test(f.offerEndDate)&&o.validFrom>=f.offerStartDate&&o.validTo<=f.offerEndDate;
 return {...o,applicableBranchIds:valid?ids:[],branchVerificationUrl:'https://www.lidl.cz/c/akcni-letak/s10008647'};});
}
function pennyCoverage(offers,pages,branches,base){
 const texts=Object.fromEntries(Object.entries(pages).map(([n,h])=>[n,plain(h)]));
 const terms=Object.values(texts).map(t=>t.match(/PRO TYTO PRODEJNY JE NABÍDKA Z KAPACITNÍCH A JINÝCH LOGISTICKÝCH DŮVODŮ OMEZENA:\s*(.*?)\s*Chyby v tisku/i)?.[1]).filter(Boolean);
 if(terms.length!==1)throw Error('PENNY branch exceptions missing or ambiguous');
 const cities=terms[0].split(';').map(t=>norm(t.split(/[\uF6BB–—]/)[0]));
 if(cities.length<2||cities.some(c=>!c||c.includes(' ul.')))throw Error('PENNY exceptions changed');
 // A city-level exclusion is deliberately conservative if street matching is ambiguous.
 const allIds=branches.filter(b=>b.retailer==='Penny').map(b=>b.id);
 const ids=branches.filter(b=>b.retailer==='Penny'&&!cities.some(c=>norm(b.city)===c||norm(b.city).startsWith(c+' '))).map(b=>b.id);
 return offers.map(o=>{const suffix=o.sourceUrl?.startsWith(base)?o.sourceUrl.slice(base.length):'';const page=/^(\d+)\/$/.exec(suffix)?.[1];
 const restricted=page&&/nabidka z teto strany je pro vybrane prodejny omezena/.test(norm(texts[page]));
 return {...o,applicableBranchIds:page&&texts[page]?(restricted?ids:allIds):[],branchVerificationUrl:'https://www.penny.cz/nabidky/letaky'};});
}
const enrichExisting=enrich;
enrich=async function(source,offers,branches){
 const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(source+' coverage HTTP '+r.status);return r;};
 if(source==='lidl'){const r=await get('https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl%2Fcs-CZ&region_id=0&store_id=0');return lidlCoverage(offers,await r.json(),branches);}
 if(source==='penny'){
  const landing=await(await get('https://www.penny.cz/nabidky/letaky')).text();
  const bases=[...new Set(offers.map(o=>o.sourceUrl?.match(/^https:\/\/files\.rewe\.co\.at\/PennyIntLeaflet\/CZ\/\d{2}_\d{2}_\d{4}_zs\//)?.[0]).filter(Boolean))];
  let result=offers.map(o=>({...o,applicableBranchIds:[],branchVerificationUrl:'https://www.penny.cz/nabidky/letaky'}));
  for(const base of bases){if(!landing.replace(/\\u002F/g,'/').includes(base))continue;
   const root=await(await get(base)).text();const nums=[...root.matchAll(/href=["'](?:\.\/)?(\d+)\/["']/g)].map(m=>+m[1]);const max=Math.max(...nums);
   if(!Number.isInteger(max)||max<2||max>100)throw Error('PENNY page count unavailable');
   const pages={};for(let start=1;start<=max;start+=5)await Promise.all(Array.from({length:Math.min(5,max-start+1)},(_,n)=>start+n).map(async n=>{pages[n]=await(await get(base+n+'/')).text()}));
   const selected=result.filter(o=>o.sourceUrl?.startsWith(base));const verified=pennyCoverage(selected,pages,branches,base);const byId=new Map(verified.map(o=>[o.id,o]));result=result.map(o=>byId.get(o.id)||o);
  }return result;
 }
 return enrichExisting(source,offers,branches);
};
module.exports={enrich,albertCoverage,billaCoverage,lidlCoverage,pennyCoverage,billaExcludedStores};
