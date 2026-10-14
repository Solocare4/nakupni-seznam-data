// Visually checked against both pages of this exact official PDF, 2026-10-14.
// Never carry these corrections into a replacement PDF or another publication.
const review={
 slug:'special-pstruzi-14-10-20-10-2026',
 sha256:'08fe9389a99901facde27171911d26a5ad9268936961a3514e7034b03680ff37',
 from:'2026-10-14',to:'2026-10-20',
 rows:[
  ['rajcata-cherry',1,'Rajčata cherry oválná',19.9,250,'g','produce'],
  ['zubr-gradus',1,'Zubr Gradus 12',14.9,0.5,'l','drinks','Cena bez zálohy za vratný obal.'],
  ['eidam',1,'Sýýýr Eidam 30 % plátky',12.9,100,'g','dairy'],
  ['kobliha',2,'Kobliha s lískooříškovou náplní',14.9,70,'g','bakery','Běžná cena bez BILLA klubu; klubová cena 9,90 Kč není použita.'],
  ['nescafe',2,'Nescafé Classic náhradní náplň',94.9,150,'g','drinks'],
  ['bozkov',2,'Božkov Vodka',119.9,0.5,'l','drinks'],
 ],
};
function applyReviewed(catalog){
 if(catalog.publicationSlug!==review.slug||catalog.pdfSha256!==review.sha256)return catalog;
 const template=catalog.offers[0];
 if(!template||template.validFrom!==review.from||template.validTo!==review.to)return catalog;
 const additions=review.rows.map(([key,page,productName,price,quantity,unit,category,note])=>({
  id:`billa-reviewed-${review.slug}-${key}`,productKey:`billa-reviewed-${key}`,
  retailer:'Billa',source:'billa',sourceUrl:template.sourceUrl,storeName:'BILLA · místní speciál',
  productName,price,quantity,unit,category,subcategory:'',validFrom:review.from,validTo:review.to,
  flyerPage:page,flyerUrl:template.flyerUrl.split('#')[0]+'#page='+page,
  description:note||'Ručně ověřená veřejná cena z místního letáku BILLA.',
 }));
 const identity=o=>[o.productName,o.price,o.quantity,o.unit].join('|');
 const existing=new Set(catalog.offers.map(identity));
 return {...catalog,offers:[...catalog.offers,...additions.filter(o=>!existing.has(identity(o)))]};
}
module.exports={applyReviewed};
