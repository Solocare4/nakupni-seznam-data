const crypto=require('node:crypto');
const reviews=require('./lidl-reviewed-publications.json');
async function collectReviewedPublications(flyers,fetchBytes,today){
 const offers=[],issues=[];
 for(const review of reviews){
  if(today<review.validFrom||today>review.validTo)continue;
  const source=flyers.find(f=>f.id===review.id);
  if(!source||source.pdfUrl!==review.pdfUrl||source.offerStartDate!==review.validFrom||source.offerEndDate!==review.validTo){
   issues.push({id:review.id,reason:'review-source-changed'});continue;
  }
  try{
   const bytes=await fetchBytes(source.pdfUrl);
   if(crypto.createHash('sha256').update(bytes).digest('hex')!==review.sha256)throw Error('review-pdf-changed');
   offers.push(...review.offers);
  }catch{issues.push({id:review.id,reason:'review-pdf-unavailable-or-changed'});}
 }
 return {offers,issues};
}
module.exports={collectReviewedPublications};
