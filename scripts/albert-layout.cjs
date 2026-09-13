const normal = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const clean = s => s.replace(/\s+/g, ' ').trim();
const number = s => Number(s.replace(',', '.'));
const factor = u => ['g', 'ml'].includes(u) ? 0.001 : 1;
const dimension = u => ['g', 'kg'].includes(u) ? 'kg' : ['l', 'ml'].includes(u) ? 'l' : 'ks';

function packageInfo(text) {
  const parts = text.split('•').map(clean);
  const packs = parts.flatMap(p => {
    const m = p.match(/^(cena za )?(?:(\d+)\s*[x×]\s*)?(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|ks)$/i);
    if (!m) return [];
    const quantity = (m[2] ? number(m[2]) : 1) * number(m[3]);
    return quantity > 0 && quantity <= 10000 ? [{quantity, unit:m[4].toLowerCase(), soldByWeight:Boolean(m[1]) && ['g','kg'].includes(m[4])}] : [];
  });
  return packs.length === 1 ? packs[0] : null;
}

function priceLabels(items) {
  const labels = [];
  for (const item of items) {
    if (item.h < 14) continue;
    if (/^\d{1,5},-$/.test(item.t) && item.h >= 24) {
      labels.push({...item,price:Number(item.t.slice(0,-2))});
      continue;
    }
    if (!/^\d{1,5}$/.test(item.t)) continue;
    const cents = items.filter(c => /^\d{2}$/.test(c.t) && c.f === item.f &&
      Math.abs(c.x - item.x - item.w) < 2 && c.y < item.y &&
      item.y - c.y < item.h * 0.4 && c.h > item.h * 0.45 && c.h < item.h * 0.75);
    if (cents.length === 1) labels.push({...item,w:item.w+cents[0].w,price:Number(item.t)+Number(cents[0].t)/100});
  }
  return labels;
}

function productBlocks(items, pageHeight) {
  const titleItems = items.filter(t => t.h >= 10 && t.h <= 18 && /[a-zá-ž]/i.test(t.t) && !/[•=]|Kč/.test(t.t));
  const used = new Set();
  const blocks = [];
  for (const start of [...titleItems].sort((a,b)=>a.y-b.y)) {
    if (used.has(start)) continue;
    const title = [start];
    let last = start;
    while (true) {
      const next = titleItems.find(t => !used.has(t) && t.f === start.f && Math.abs(t.x-start.x)<2 && t.y>last.y+2 && t.y-last.y<=start.h*1.4);
      if (!next) break;
      title.push(next); used.add(next); last=next;
    }
    const body=[];
    let baseline=last.y;
    for (let n=0;n<15;n++) {
      const first=items.filter(t=>t.h>=6 && t.h<10 && Math.abs(t.x-start.x)<2 && t.y>baseline+2 && t.y-baseline<15 && t.y<pageHeight*0.965).sort((a,b)=>a.y-b.y)[0];
      if (!first) break;
      const row=items.filter(t=>t.h>=6&&t.h<10&&Math.abs(t.y-first.y)<1.3&&t.x>=first.x-1).sort((a,b)=>a.x-b.x);
      let right=first.x;
      const line=[];
      for (const token of row) { if(token.x-right>9)break;line.push(token.t);right=Math.max(right,token.x+token.w); }
      body.push(clean(line.join(' ')));baseline=first.y;
    }
    const text=body.join(' ');
    if (!text.startsWith('•')) continue;
    const name=clean(title.map(t=>t.t).join(' '));
    if (name.length<3 || /neporazitelne|nejnizsi|kvalita cena|super cena|vice akci|aplikac|plat[ií] pouze/i.test(normal(name))) continue;
    blocks.push({name,text,x:start.x,y:start.y,end:baseline,w:Math.max(...title.map(t=>t.w))});
  }
  return blocks;
}

function extractPage(page, dates, publication) {
  const text=clean(page.items.map(t=>t.t).join(' '));
  // A page with a shorter promotion needs explicit product-region dates. Do not apply the weekly dates.
  if (/plati\s+pouze|pouze\s+od|jen\s+od/.test(normal(text))) return [];
  const prices=priceLabels(page.items);
  const blocks=productBlocks(page.items,page.height);
  const offers=[];
  for(const block of blocks) {
    const condition=normal(block.text);
    if(/pri\s+(koupi|nakupu)|kupon|\d+\s*\+\s*\d+|body navic|od\s+\d+\s*(ks|kus)|plati do/.test(condition))continue;
    const pack=packageInfo(block.text);
    if(!pack)continue;
    const rates=[...block.text.matchAll(/(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|ks)\s*=\s*(\d+(?:[,.]\d+)?)\s*Kč(?:\s*(bez Aplikace))?/gi)];
    const publicRate = rates.find(r=>r[4]) ?? (!/aplikac/i.test(block.text) && rates.length===1 ? rates[0] : null);
    const explicit=[...block.text.matchAll(/(?:^|•)\s*(\d+(?:[,.]\d+)?)\s*Kč(?=\s*(?:•|$))/gi)].map(m=>number(m[1]));
    if(!publicRate && (explicit.length!==1 || /aplikac/i.test(block.text)))continue;
    if(publicRate && dimension(pack.unit)!==dimension(publicRate[2].toLowerCase()))continue;
    const nearby=prices.filter(p=>p.x>=block.x-60 && p.x<=block.x+Math.max(block.w,110)+30 && p.y>=block.y-100 && p.y<=block.end+125);
    const matching=nearby.filter(p=>{
      if(!publicRate)return Math.abs(p.price-explicit[0])<0.001;
      const actual=p.price * number(publicRate[1])*factor(publicRate[2].toLowerCase())/(pack.quantity*factor(pack.unit));
      const printed=number(publicRate[3]);
      // Unit rates in these flyers round up. Validate a displayed total; never manufacture a total from a rate.
      return actual<=printed+0.0051 && actual>=printed-0.0101;
    });
    const values=[...new Set(matching.map(p=>p.price))];
    if(values.length!==1)continue;
    const slug=normal(block.name).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100);
    const key=`${slug}-${pack.quantity}${pack.unit}`;
    offers.push({id:`albert-${publication}-${key}`,productKey:`albert-${key}`,retailer:'Albert',productName:block.name,
      category:'pantry',subcategory:'',price:values[0],...pack,...dates,source:'albert',
      sourceUrl:`https://letaky.albert.cz/${publication}/page/${page.number}`,
      storeName:publication.includes('hm_')?'Albert hypermarket · celostátní leták':'Albert supermarket · celostátní leták',
      description:'Cena bez aplikace ověřená podle polohy v PDF a uvedeného balení. Nabídka platí pro uvedený formát prodejny.',
      verification:'pdf-layout-v1'});
  }
  return offers;
}

module.exports={extractPage,packageInfo,priceLabels,productBlocks};
