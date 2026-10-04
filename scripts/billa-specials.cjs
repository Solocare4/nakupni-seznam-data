const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');

// Local campaigns must not prevent the two independently verified regular
// publications from refreshing. Retain every failure as an explicit gap.
async function collectSpecials(links, stores, branches, fetchPublication) {
  const offers=[],issues=[];let skipped=0;
  for(const url of links){
    try{
      const special=await fetchPublication({pageUrl:url,returnOnly:true,minOffers:1,label:'BILLA · místní speciál'});
      const city=url.split('special-')[1],text=norm(special.publicationText);
      const matching=stores.filter(s=>norm(s.city)===norm(city)&&text.includes('ulice'+norm(s.street.replace(/\s+\d+[a-z]?(?:\/\d+[a-z]?)?$/,''))));
      if(matching.length!==1||!branches.some(b=>b.id===matching[0].id)){
        skipped+=special.offers.length;
        issues.push({url,reason:'Neověřená nebo nejednoznačná pobočka místního speciálu.',offerCount:special.offers.length});
        continue;
      }
      offers.push(...special.offers.map(o=>({...o,applicableBranchIds:[matching[0].id],branchVerificationUrl:'https://www.billa.cz/letaky-billa'})));
    }catch(error){issues.push({url,reason:error instanceof Error?error.message:String(error)});}
  }
  return {offers,issues,skipped};
}
module.exports={collectSpecials};
