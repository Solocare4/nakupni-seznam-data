const assert=require('node:assert/strict');
const {collectSpecials}=require('./billa-specials.cjs');
(async()=>{
 const base='https://www.billa.cz/akcni-letaky/special-';
 const stores=[{id:'brno-one',city:'Brno',street:'Hlavní 1'},{id:'ostrava-one',city:'Ostrava',street:'Dlouhá 2'}];
 const result=await collectSpecials([base+'ostrava2',base+'brno',base+'ostrava'],stores,stores,async({pageUrl})=>{
  if(pageUrl.endsWith('ostrava2'))throw Error('Chybějící publikace');
  return {publicationText:'Brno, ulice Hlavní',offers:[{id:pageUrl,price:9.9}]};
 });
 assert.equal(result.offers.length,1,'A broken local link does not abort later verified publications');
 assert.deepEqual(result.offers[0].applicableBranchIds,['brno-one'],'Local offers never become national');
 assert.equal(result.issues.length,2,'Both missing publication and unverified scope remain visible in diagnostics');
 assert.equal(result.skipped,1,'Unknown missing-publication size is not invented');
 console.log('OK: BILLA local publication failures remain explicit without blocking verified offers');
})().catch(e=>{console.error(e);process.exitCode=1});
