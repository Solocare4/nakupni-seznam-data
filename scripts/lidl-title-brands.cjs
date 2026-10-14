// These are single, multiword Lidl brands, not two neighbouring product cards.
// Preserve the remaining title so a genuinely mixed brand is still rejected.
function canonicalBrandTitle(value) {
 return String(value).replace(/^(MAX['’]S|MILA['’]S)\s+WORLD\b/i,'PETBRAND');
}
module.exports={canonicalBrandTitle};
