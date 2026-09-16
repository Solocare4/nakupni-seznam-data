const fs=require('fs');
const coverage=require('./branch-coverage.cjs');
const parser=require('./update-billa.cjs');
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const values=html=>JSON.parse(html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('BILLA '+r.status);return r.text();}
async function fetchCatalog(){
 const branches=require('./branches.json');
 const storesHtml=await get('https://www.billa.cz/prodejny');
 const largeUrl='https://www.billa.cz/letaky-billa?tab=letaky-billa/velky-letak';
 const largeHtml=await get(largeUrl);
 const smallUrl='https://www.billa.cz/letaky-billa?tab=letaky-billa/maly-letak';
 const smallHtml=await get(smallUrl);
 const large=await parser.fetchPublication({pageUrl:largeUrl,returnOnly:true});
 let offers=coverage.billaCoverage(large.offers,largeHtml,storesHtml,branches);
 const small=await parser.fetchPublication({pageUrl:smallUrl,returnOnly:true,minOffers:20,label:'BILLA · malý leták'});
 const rule=values(smallHtml).find(v=>typeof v==='string'&&v.includes('Leták platí pro prodejny:'));
 if(!rule)throw Error('BILLA small leaflet scope missing');
 const terms=rule.replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^.*letak plati pro prodejny:\s*/,'').trim().split(';').map(s=>s.trim().replace(/\.$/,''));
 const v=values(storesHtml);const stores=v.filter(x=>x&&typeof x==='object'&&'storeId'in x&&v[x.brand]==='BILLA,').map(x=>({id:'billa-'+v[x.storeId],city:v[x.city],street:v[x.street],name:v[x.displayName]}));
 const largeIds=new Set(offers.flatMap(o=>o.applicableBranchIds||[]));
 const smallIds=[...coverage.billaExcludedStores(terms,stores)].filter(id=>!largeIds.has(id)&&branches.some(b=>b.id===id));
 if(!smallIds.length)throw Error('BILLA small leaflet has no verified branches');
 offers.push(...small.offers.map(o=>({...o,applicableBranchIds:smallIds,branchVerificationUrl:'https://www.billa.cz/letaky-billa'})));
 const landing=await get('https://www.billa.cz/letaky-billa');
 const links=[...new Set([...landing.replace(/\\u002F/g,'/').matchAll(/(?:https:\/\/www.billa.cz)?(\/akcni-letaky\/special-[a-z0-9-]+)/g)].map(m=>'https://www.billa.cz'+m[1]))];
 for(const url of links){
  const special=await parser.fetchPublication({pageUrl:url,returnOnly:true,minOffers:1,label:'BILLA · místní speciál'});
  const city=url.split('special-')[1];const text=norm(special.publicationText);
  const matching=stores.filter(s=>norm(s.city)===norm(city)&&text.includes('ulice'+norm(s.street.replace(/\s+\d+[a-z]?(?:\/\d+[a-z]?)?$/,''))));
  if(matching.length!==1)throw Error('BILLA special branch ambiguous: '+url);
  if(!branches.some(b=>b.id===matching[0].id))throw Error('BILLA special branch missing in directory: '+matching[0].id);
  offers.push(...special.offers.map(o=>({...o,applicableBranchIds:[matching[0].id],branchVerificationUrl:'https://www.billa.cz/letaky-billa'})));
 }
 return {version:1,pipelineVersion:2,source:'billa',storeId:'cz',fetchedAt:new Date().toISOString(),offers,skipped:0,partial:false};
}
module.exports={fetchCatalog};

