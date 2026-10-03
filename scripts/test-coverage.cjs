const assert=require('node:assert/strict');
const {parseGlobalValidity}=require('./update-penny.cjs');
const {enrich}=require('./branch-coverage.cjs');
for(const suffix of ['','_cz','_zs'])assert.equal(parseGlobalValidity(`https://files.rewe.co.at/PennyIntLeaflet/CZ/30_09_2026${suffix}/`).validTo,'2026-10-06');
assert.throws(()=>parseGlobalValidity('https://files.rewe.co.at/PennyIntLeaflet/CZ/31_02_2026/'));
(async()=>{
const original=global.fetch;
try{for(const suffix of ['','_cz','_zs']){
const base=`https://files.rewe.co.at/PennyIntLeaflet/CZ/30_09_2026${suffix}/`;
global.fetch=async url=>({ok:true,text:async()=>url==='https://www.penny.cz/nabidky/letaky'?base:url===base?'<a href="2/">2</a>':url===base+'2/'?'PRO TYTO PRODEJNY JE NABÍDKA Z KAPACITNÍCH A JINÝCH LOGISTICKÝCH DŮVODŮ OMEZENA: PRAHA – UL. DĚLNICKÁ; BEROUN – TŘÍDA MÍRU. Chyby v tisku vyhrazeny.':'Běžná nabídka'});
const offers=await enrich('penny',[{id:'bodie',sourceUrl:base+'1/'}],[{retailer:'Penny',id:'penny-test',city:'Brno'}]);
assert.deepEqual(offers[0].applicableBranchIds,['penny-test']);
}}finally{global.fetch=original;}
const {extractPage}=require('./albert-layout.cjs');
const page=require('./fixtures/albert-weekly-footer.json');
const dates={validFrom:'2026-09-23',validTo:'2026-09-29'};
assert.ok(extractPage(page,dates,'39hm_akcni_letak').some(o=>o.quantity===10&&o.productName==='Loved By Pets Granule pro psy'&&o.price===219));
assert.equal(extractPage(page,{...dates,validTo:'2026-09-30'},'39hm_akcni_letak').length,0);
console.log('OK: current and historic Penny URL formats retain branch coverage; Albert weekly footer retains dog food without extending validity');
})().catch(e=>{console.error(e);process.exitCode=1});

const {locateTitles,productBlocks}=require('./update-penny.cjs');
const sourceText='SUŠENKY* 200 g 100 g 9,95 Kč JOGURT* 150 g 100 g 6,60 Kč';
assert.deepEqual(productBlocks(sourceText,locateTitles(sourceText,[{text:'SUŠENKY'},{text:'JOGURT'}])).map(b=>b.text),['SUŠENKY* 200 g 100 g 9,95 Kč','JOGURT* 150 g 100 g 6,60 Kč']);
