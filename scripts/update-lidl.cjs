const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
let pdfjsLib = null;
function getPdfjsLib() {
  if (!pdfjsLib) pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  return pdfjsLib;
}

const OVERVIEW_URL = 'https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl%2Fcs-CZ&region_id=0&store_id=0';
const DETAIL_URL = (id) => `https://endpoints.leaflets.schwarz/v4/flyer?flyer_identifier=${encodeURIComponent(id)}&region_id=0&region_code=0`;
const OUTPUT_FILE = path.resolve(process.cwd(), 'data', 'lidlCatalog.json');
const DEBUG_FILE = path.resolve(process.cwd(), 'data', 'lidl-debug.json');
const LIDL_HOME = 'https://www.lidl.cz/';
const LIDL_FLYERS = 'https://www.lidl.cz/c/akcni-letak/s10008644';
const LIDL_WEEKLY_HUB = 'https://www.lidl.cz/c/posouvat-limity-to-se-vyplati/a10102510';
const LIDL_STEADY = 'https://www.lidl.cz/c/srovnani-ceny-v-klidu/a10091553';
const APP_ROOT = path.resolve(process.cwd(), '..', 'nakupni-seznam');
const APP_LIDL_IMAGE_DIR = path.join(APP_ROOT, 'assets', 'lidl-products');
const APP_LIDL_IMAGE_MAP = path.join(APP_ROOT, 'data', 'lidlImageMap.ts');

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
function normal(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function todayPrague() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function isoDate(value) {
  return typeof value === 'string' ? value.slice(0, 10) : '';
}
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 Lidl catalog updater' } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadBufferHttps(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: 'application/pdf,*/*',
        'User-Agent': 'Mozilla/5.0 Lidl catalog updater',
        Connection: 'close',
      },
      timeout: 120000,
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects while downloading ${url}`));
        const nextUrl = new URL(response.headers.location, url).href;
        return downloadBufferHttps(nextUrl, redirectsLeft - 1).then(resolve, reject);
      }
      if (status < 200 || status >= 300) {
        response.resume();
        return reject(new Error(`${url} -> HTTP ${status}`));
      }

      const chunks = [];
      let received = 0;
      const expected = Number(response.headers['content-length'] || 0);
      response.on('data', (chunk) => {
        chunks.push(chunk);
        received += chunk.length;
      });
      response.on('aborted', () => reject(new Error(`Download aborted after ${received} bytes`)));
      response.on('error', reject);
      response.on('end', () => {
        if (!response.complete) return reject(new Error(`Download incomplete after ${received} bytes`));
        if (expected > 0 && received !== expected) {
          return reject(new Error(`Download size mismatch: expected ${expected}, got ${received}`));
        }
        resolve(new Uint8Array(Buffer.concat(chunks)));
      });
    });
    request.on('timeout', () => request.destroy(new Error('PDF download timeout after 120 s')));
    request.on('error', reject);
  });
}

async function fetchBuffer(url) {
  const maxAttempts = 5;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) console.log(`[LIDL-DATA] pdfRetry attempt=${attempt}/${maxAttempts}`);
      const bytes = await downloadBufferHttps(url);
      if (bytes.length < 1024 * 1024) throw new Error(`Downloaded PDF is suspiciously small (${bytes.length} bytes)`);
      return bytes;
    } catch (error) {
      lastError = error;
      console.warn(`[LIDL-DATA] pdfDownload failed attempt=${attempt}/${maxAttempts}: ${error?.message || error}`);
      if (attempt < maxAttempts) await sleep(1500 * attempt);
    }
  }
  throw new Error(`Lidl PDF se nepodařilo stáhnout ani po ${maxAttempts} pokusech: ${lastError?.message || lastError}`);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: 'text/html,application/xhtml+xml', 'Cache-Control': 'no-cache', 'User-Agent': 'Mozilla/5.0 Lidl catalog updater' } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}
function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
function cleanHtmlText(value) {
  return clean(decodeHtml(value).replace(/<[^>]*>/g, ' '));
}
function discoverLidlUrls(html) {
  const urls = new Set();
  const include = /pondelni|ctvrtecni|vikendov|hity.?tydne|akcni.?letak|ovoce|zelenin|cerstve.?maso|maso|cerstve.?pecivo|pecivo|ryby|potrav|napoj|znackov|slev|usetrete|chut|gril|snidan|svacin|sladk|mlec|syry|uzenin/i;
  const exclude = /online|parkside|naradi|diln|moda|oblec|obuv|koupeln|loznic|pracovna|kancelar|nabytek|zahrad|sport|elektr|spotrebic|hrack|detske.?oblec|wellness/i;
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[1]);
    const label = normal(cleanHtmlText(match[2]));
    let url;
    try { url = new URL(href, LIDL_HOME); } catch { continue; }
    if (url.origin !== 'https://www.lidl.cz' || url.username || url.password) continue;
    if (!/^\/c\/.+\/a\d+\/?$/.test(url.pathname)) continue;
    let pathText = '';
    try { pathText = normal(decodeURIComponent(url.pathname)); } catch { pathText = normal(url.pathname); }
    const searchable = `${pathText} ${label}`;
    if (!include.test(searchable)) continue;
    if (exclude.test(searchable) && !/ovoce|zelenin|maso|pecivo|ryby|potrav|napoj|sladk|mlec|syry|uzenin/.test(searchable)) continue;
    url.search = ''; url.hash = '';
    urls.add(url.href);
  }
  return [...urls].slice(0, 36);
}
function parseHtmlPack(text) {
  const raw = cleanHtmlText(text).replace(/\bkus(?:y|ů)?\b/gi, 'ks').replace(/\brola\b|\brole\b/gi, 'ks');
  const m = raw.match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)\b/i);
  if (!m) return null;
  const q = (m[1] ? Number(m[1]) : 1) * Number(m[2].replace(',', '.'));
  if (!Number.isFinite(q) || q <= 0 || q > 10000) return null;
  return { quantity: q, unit: m[3].toLowerCase() };
}
function findRetcatImageUrl(value, depth = 0) {
  if (depth > 4 || value == null) return '';
  if (typeof value === 'string') {
    const decoded = decodeHtml(value);
    const m = decoded.match(/https:\/\/imgproxy-retcat\.assets\.schwarz\/[^"'\\\s<]+/i);
    return m ? m[0].replace(/&amp;/g, '&') : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) { const found = findRetcatImageUrl(item, depth + 1); if (found) return found; }
    return '';
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (/image|picture|media|src|url/i.test(key)) { const found = findRetcatImageUrl(child, depth + 1); if (found) return found; }
    }
    for (const child of Object.values(value)) { const found = findRetcatImageUrl(child, depth + 1); if (found) return found; }
  }
  return '';
}

function parseHtmlEnrichment(html) {
  const out = [];
  for (const tile of html.matchAll(/data-grid-data="([\s\S]*?)"\s+data-country=/gi)) {
    let data;
    try { data = object(JSON.parse(decodeHtml(tile[1]))); } catch { continue; }
    const name = typeof data.fullTitle === 'string' ? cleanHtmlText(data.fullTitle).slice(0,180) : '';
    const priceData = object(data.price);
    const current = priceData.price;
    if (!name || typeof current !== 'number' || !Number.isFinite(current) || current <= 0 || data.store !== true) continue;
    const imageUrl = findRetcatImageUrl(data);
    const canonicalUrl = typeof data.canonicalUrl === 'string' && data.canonicalUrl.startsWith('/p/') ? `https://www.lidl.cz${data.canonicalUrl}` : '';
    const basePrice = object(priceData.basePrice).text;
    const packaging = object(priceData.packaging).text;
    const packInfo = parseHtmlPack(typeof basePrice === 'string' ? basePrice : typeof packaging === 'string' ? packaging : '');
    out.push({ name, price: Math.round(current*100)/100, imageUrl, canonicalUrl, pack: packInfo });
  }
  return out;
}
function nameTokens(value) {
  const stop = new Set(['a','s','se','v','ve','na','do','od','pro','the','of','různé','druhy','ruzne','druh']);
  return normal(value).replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter((t)=>t.length>=3 && !stop.has(t));
}
function tokenSimilarity(a,b) {
  const aa = new Set(nameTokens(a)); const bb = new Set(nameTokens(b));
  if (!aa.size || !bb.size) return 0;
  let inter=0; for (const t of aa) if (bb.has(t)) inter++;
  return inter / Math.max(aa.size, bb.size);
}
function packClose(a,b) {
  if (!a || !b || a.unit !== b.unit) return false;
  const scale = Math.max(1, Math.abs(a.quantity), Math.abs(b.quantity));
  return Math.abs(a.quantity-b.quantity)/scale <= 0.08;
}
async function collectHtmlEnrichment() {
  const baseUrls = [LIDL_HOME, LIDL_FLYERS, LIDL_WEEKLY_HUB, LIDL_STEADY];
  const cache = new Map(); const urls = new Set();
  for (const url of baseUrls) {
    try {
      const html = await fetchText(url); cache.set(url, html);
      if (url !== LIDL_HOME) urls.add(url);
      for (const nested of discoverLidlUrls(html)) urls.add(nested);
    } catch { /* enrichment is optional */ }
  }
  const first = [...urls].slice(0, 26);
  for (let i=0;i<first.length;i+=4) {
    const batch = await Promise.allSettled(first.slice(i,i+4).map(async (url)=>({url,html:cache.get(url)??await fetchText(url)})));
    for (const result of batch) {
      if (result.status !== 'fulfilled') continue;
      cache.set(result.value.url,result.value.html);
      try { for (const nested of discoverLidlUrls(result.value.html)) urls.add(nested); } catch {}
    }
  }
  const all = [...urls].slice(0,40);
  for (let i=0;i<all.length;i+=4) {
    const batch = await Promise.allSettled(all.slice(i,i+4).map(async (url)=>({url,html:cache.get(url)??await fetchText(url)})));
    for (const result of batch) if (result.status === 'fulfilled') cache.set(result.value.url,result.value.html);
  }
  const products=[]; const seen=new Set();
  for (const html of cache.values()) for (const item of parseHtmlEnrichment(html)) {
    const key=`${normal(item.name)}|${item.price}|${item.pack?.quantity??''}|${item.pack?.unit??''}`;
    if (seen.has(key)) continue; seen.add(key); products.push(item);
  }
  console.log(`[LIDL-DATA] htmlEnrichment products=${products.length} pages=${cache.size}`);
  return products;
}
function walkFlyers(value, out = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) walkFlyers(item, out, seen);
    return out;
  }
  const item = object(value);
  const id = typeof item.id === 'string' ? item.id : '';
  const name = typeof item.name === 'string' ? item.name : '';
  const title = typeof item.title === 'string' ? item.title : '';
  if (id && (name || title) && !seen.has(id)) {
    seen.add(id); out.push(item);
  }
  for (const child of Object.values(item)) walkFlyers(child, out, seen);
  return out;
}
function dateValue(item, start) {
  const primary = start ? item.offerStartDate : item.offerEndDate;
  const fallback = start ? item.startDate : item.endDate;
  return isoDate(typeof primary === 'string' ? primary : fallback);
}
function chooseWeekly(flyers) {
  const today = todayPrague();
  return flyers
    .filter((item) => {
      const start = dateValue(item, true); const end = dateValue(item, false);
      const text = normal(`${item.name ?? ''} ${item.title ?? ''}`);
      return /akcni letak/.test(text) && !/spotrebni|brozur|hity tydne/.test(text) && (!start || start <= today) && (!end || end >= today);
    })
    .sort((a, b) => dateValue(b, true).localeCompare(dateValue(a, true)))[0] || null;
}
function categoryFor(name) {
  const v = normal(name);
  if (/jablk|hrozn|banan|meloun|citron|pomeranc|mandar|paprik|rajce|rajcat|okurk|brambor|cibul|cesnek|mrkev|salat|avokad|ovoce|zelenin/.test(v)) return 'produce';
  if (/mleko|syr|jogurt|smetan|tvaroh|maslo|vejce|kefir|mozzarell|mascarpone/.test(v)) return 'dairy';
  if (/sunka|salam|klobas|parek|maso|kure|kruta|veprov|hovez|steak|mlete|rizky|prsni|losos/.test(v)) return 'meat';
  if (/napoj|voda|limonad|pivo|vino|dzus|cola|kofola|sirup|energy|kava|caj/.test(v)) return 'drinks';
  if (/mrazen|pizza|zmrzlin|nanuk/.test(v)) return 'frozen';
  if (/toalet|ubrousk|praci|cistic|sacek|droger|granule|papir|kapesnik|tablety/.test(v)) return 'home';
  return 'pantry';
}
function isNumericOrPriceText(value) {
  const t = clean(value);
  if (!t) return true;
  if (!/\p{L}/u.test(t)) return true;
  if (/\b\d{1,4}\s*[.,]\s*\d{2}\b/.test(t)) return true;
  if (/\b\d{1,4}\s*[.,]-\b/.test(t)) return true;
  if (/^-?\s*\d+(?:[,.]\d+)?\s*Kč(?:\s*\*)?$/i.test(t)) return true;
  if (/\b\d+(?:[,.]\d+)?\s*Kč\b/i.test(t)) return true;
  if (/\b\d+(?:[,.]\d+)?\s*%\b/.test(t)) return true;
  if (/\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks)\s*=\s*\d/i.test(t)) return true;
  return false;
}
function isPromoOrLegalText(value) {
  const v = normal(value);
  return /(?:^|\b)(?:nabidka|usetrete|super cena|cenovy trumf|aktivuj kupon|sleva|nova bezna cena|standardni cena|bezna cena|ceny v klidu|doporucena|maloobchodni|vyrobce|max\.|max |vice na|chyby v tisku|vyhrazuje|odber mozny|region cz|plat[iy] od|plat[iy] do|ceny plati|lidl plus|nakup|baleni na nakup|v libovolne kombinaci|libovolna kombinace|kombinujte|mixujte|usetri|uspora)(?:\b|$)/.test(v);
}
function isMeasurementOnlyText(value) {
  const raw = clean(value);
  const v = normal(raw);
  if (!raw) return false;
  if (/[ø⌀↑↓↕]/.test(raw) && /\b(?:mm|cm|m)\b/i.test(raw)) return true;
  if (/^(?:[ø⌀↑↓↕x×\s,:;.\-+]*\d+(?:[,.]\d+)?\s*(?:mm|cm|m)(?:\s*[,;/x×]\s*[ø⌀↑↓↕]*\s*\d+(?:[,.]\d+)?\s*(?:mm|cm|m))*[.,;]?)$/i.test(raw)) return true;
  if (/\b(?:prumer|vyska|sirka|delka)\b/.test(v) && /\d/.test(raw) && /\b(?:mm|cm|m)\b/.test(v)) return true;
  return false;
}
function isTechnicalOrCampaignTitle(value) {
  const raw = clean(value);
  const v = normal(raw);
  if (!raw) return true;
  // Price-only / discount callouts that occasionally sit closest to the price.
  if (/^(?:[-–—]?\s*\d+(?:[,.]\d+)?\s*(?:kc|kč|%)(?:\s*\*)?|ceny?\s+v\s+klidu|standardni\s+cena|nova\s+bezna\s+cena)$/i.test(v)) return true;
  if (/^(?:[-–—]?\s*\d+(?:[,.]\d+)?\s*(?:kc|kč))\s+\d{1,4}(?:[.,]\d{2}|[.,]-)?\s*\*?$/i.test(raw)) return true;
  // Technical specifications / non-grocery fragments are never useful names in a shopping-list app.
  if (/\b(?:vykon|motoru?|airwatt|li[- ]?ion|mah|ah|volt|watt|kw|otacek|otacky|rpm|prikon|napeti|akumulator|baterie|nabijecka|vrtacka|bruska|pila|sekacka|vysavac|kompresor|cerpadlo|generator|parkside|silvercrest|esmara|livergy|crivit)\b/.test(v)) return true;
  if (/\b\d+(?:[,.]\d+)?\s*(?:v|w|kw|ah|mah|airwatt|rpm)\b/i.test(raw)) return true;
  return false;
}
function uppercaseBrandTokenCount(value) {
  return clean(value).split(/\s+/).filter((word) => {
    const letters = word.replace(/[^A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '');
    if (letters.length < 3) return false;
    const upper = letters.replace(/[^A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '').length;
    return upper / letters.length >= 0.85;
  }).length;
}
function finalCatalogTitle(value) {
  const raw = clean(value);
  const v = normal(raw);
  if (!relevantName(raw) || isTechnicalOrCampaignTitle(raw) || /^[A-Z]:/.test(raw) || /upevnovaci lano/.test(v)) return false;
  if (isMeasurementOnlyText(raw) || isPromoOrLegalText(raw) || isNumericOrPriceText(raw)) return false;
  // Obvious garbage produced by OCR/layout boundaries.
  if (/^(?:kc\.?\s*)?(?:standardni|bezna|nova)\s+cena$/i.test(v)) return false;
  if (/^(?:ceny?\s+v\s+klidu|sleva|usetrete|super cena|cenovy trumf)$/i.test(v)) return false;
  // Two separate all-caps brands in one PDF title are almost always neighbouring cards accidentally merged.
  if (uppercaseBrandTokenCount(raw) >= 2 && raw.split(/\s+/).length >= 4) return false;
  // Pure brand names are not useful; HTML enrichment may replace them before this final gate.
  if (isBrandOnlyTitle(raw)) return false;
  if (isWeakPackagedTitle(raw)) return false;
  return true;
}

function firstWordLooksDescriptive(value) {
  const first = normal(clean(value).split(/\s+/)[0] || '');
  if (!first) return true;
  return /(?:ovy|ova|ove|ni|ny|na|ne|sky|ska|ske|ly|la|le|ici|ovy)$/i.test(first) ||
    /^(?:kokosova|cokoladova|ovocna|mlecna|svetly|tmavy|bily|bila|bile|jemny|jemna|jemne|kremovy|kremova|cerstvy|cerstva|trvanlive|toaletni|syrovy|jablecna|hroznova|jahodova|vanilkova|prilohove)$/.test(first);
}
function hasBrandSignal(value) {
  const raw = clean(value);
  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  if (words.some((word) => {
    const letters = word.replace(/[^A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '');
    if (letters.length < 3) return false;
    const upper = letters.replace(/[^A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '').length;
    return upper / letters.length >= 0.8;
  })) return true;
  const first = words[0].replace(/^[^\p{L}]+|[^\p{L}'-]+$/gu, '');
  if (/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž'-]{2,}$/.test(first) && !firstWordLooksDescriptive(first)) return true;
  return false;
}
function isProduceOrBakeryTitle(value) {
  const v = normal(value);
  return /jablk|hrozn|banan|meloun|citron|pomeranc|mandar|paprik|rajce|rajcat|okurk|brambor|cibul|cesnek|mrkev|salat|avokad|ovoce|zelenin|preclik|kapsa|rohlik|chleb|baget|pecivo/.test(v);
}
function isWeakPackagedTitle(value) {
  const raw = clean(value);
  const v = normal(raw);
  if (!raw || hasBrandSignal(raw) || isProduceOrBakeryTitle(raw)) return false;
  if (/^[a-záčďéěíňóřšťúůýž]/.test(raw)) return true;
  if (/\b(?:tycinka|oplatk|jogurt|lezak|pivo|sunka|salam|parek|napoj|limonad|voda|kava|caj|cukr|tablety|toaletni papir|smetana|zmrzlina|susen|cokolad|sirup|dzus|mleko|syr)\b/.test(v)) return true;
  return false;
}
function isBrandOnlyTitle(value) {
  const raw = clean(value);
  const words = raw.split(/\s+/).filter(Boolean);
  if (!raw || !words.length || words.length > 2 || !hasBrandSignal(raw)) return false;
  const upperish = (word) => {
    const letters = word.replace(/[^A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '');
    if (letters.length < 3) return false;
    const upper = letters.replace(/[^A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '').length;
    return upper / letters.length >= 0.8;
  };
  // Jedna samotná značka (LAY'S, MATTONI) nebo dvouslovná značka složená
  // jen z velkých brandových tokenů (např. SVIJANSKÝ MÁZ) není dostatečný název.
  if (words.length === 1) return raw.replace(/[^\p{L}0-9]/gu,'').length >= 3;
  return words.every(upperish);
}
function relevantName(name) {
  const v = normal(name);
  const raw = clean(name);
  if (raw.length < 3 || raw.length > 120) return false;
  if (!/\p{L}{2,}/u.test(raw)) return false;
  if (isNumericOrPriceText(raw) || isPromoOrLegalText(raw) || isMeasurementOnlyText(raw)) return false;
  if (/parkside|esmara|livergy|crivit|silvercrest|aku|bater|nabije|vrtak|naradi|mikina|tricko|kalhot|obuv|ponoz|hrack|svitid|kabel|regal|skrin/.test(v)) return false;
  return true;
}
function titleQuality(name) {
  const raw = clean(name);
  const v = normal(raw);
  if (!relevantName(raw)) return 0;
  if (/^(?:v libovolne kombinaci|libovolna kombinace|mix|akce|novinka|sleva)$/i.test(v)) return 0;
  // Samotné obecné označení bez značky/druhu je pro katalog málo užitečné.
  if (/^(?:tycinka|jogurt|syr|sunka|salám|salam|parek|parky|napoj|limonada|voda|pivo|vino|kava|caj|susenk[ay]|cokolada|zmrzlina|maso|pecivo|chleb|rohlik|bageta|pizza|testoviny|ryze|olej|mouka|cukr|mléko|mleko)$/i.test(v)) return 1;
  const words = raw.split(/\s+/).filter(Boolean);
  let score = Math.min(5, words.length);
  if (/[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]{3,}/.test(raw)) score += 2;
  if (raw.length >= 12) score += 1;
  if (/(\b\w+\b)(?:.*\b\1\b){2,}/i.test(v)) score -= 3;
  if (raw.length > 90) score -= 2;
  return score;
}
function parsePack(text) {
  const raw = clean(text);
  if (/\b(?:Kč|Kc)\b/i.test(raw) && /=/.test(raw)) return null;
  if (/\bmax\.?\s*\d+/i.test(raw)) return null;
  const t = raw.replace(/\bkus(?:y|u|ů)?\b/gi, 'ks').replace(/\brole?\b/gi, 'ks');
  let m = t.match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)\b/i);
  if (!m) return null;
  const mult = m[1] ? Number(m[1]) : 1;
  const q = Number(m[2].replace(',', '.')) * mult;
  const unit = m[3].toLowerCase();
  if (!Number.isFinite(q) || q <= 0 || q > 10000) return null;
  return { quantity: q, unit };
}
function toItem(raw) {
  if (!raw || typeof raw.str !== 'string' || !Array.isArray(raw.transform)) return null;
  const str = clean(raw.str);
  if (!str) return null;
  const x = Number(raw.transform[4]);
  const y = Number(raw.transform[5]);
  const h = Math.abs(Number(raw.transform[3])) || Math.abs(Number(raw.height)) || 0;
  const w = Number(raw.width) || 0;
  if (![x, y, h, w].every(Number.isFinite)) return null;
  return { str, x, y, h, w, x2: x + w };
}
function groupLines(items) {
  const sorted = [...items].sort((a,b) => b.y - a.y || a.x - b.x);

  // 1) Nejdřív seskup text podle stejné výšky Y. PDF leták má často několik
  // produktů vedle sebe na téměř stejné souřadnici Y. Dřívější implementace
  // je všechny spojila do jednoho řádku přes celou stránku, což vytvářelo
  // názvy typu "KUBÍK RAUCH ..." nebo "BOŽKOV ... RADEGAST ...".
  const yBuckets = [];
  for (const item of sorted) {
    let bucket = yBuckets.find((l) => Math.abs(l.y - item.y) <= Math.max(2.2, Math.min(5, item.h * 0.35)));
    if (!bucket) { bucket = { y: item.y, items: [] }; yBuckets.push(bucket); }
    bucket.items.push(item);
  }

  // 2) Každý horizontální řádek rozděl ještě na samostatné segmenty podle
  // mezery v ose X. Běžná mezera mezi slovy je malá; mezera mezi dvěma
  // produktovými kartami je výrazně větší.
  const lines = [];
  for (const bucket of yBuckets) {
    const row = [...bucket.items].sort((a,b)=>a.x-b.x);
    let segment = [];
    const flush = () => {
      if (!segment.length) return;
      const seg = segment;
      segment = [];
      lines.push({
        y: seg.reduce((sum, i) => sum + i.y, 0) / seg.length,
        items: seg,
        text: clean(seg.map(i=>i.str).join(' ')),
        x1: Math.min(...seg.map(i=>i.x)),
        x2: Math.max(...seg.map(i=>i.x2)),
        h: Math.max(...seg.map(i=>i.h)),
      });
    };

    for (const item of row) {
      if (!segment.length) { segment.push(item); continue; }
      const prev = segment[segment.length - 1];
      const gap = item.x - prev.x2;
      // Pro běžný 10–13bodový text vychází hranice cca 22–30 bodů.
      // U velkých cen ji zastropujeme, aby nespojila sousední sloupce.
      const gapLimit = Math.max(16, Math.min(34, Math.max(prev.h, item.h) * 2.15));
      if (gap > gapLimit) flush();
      segment.push(item);
    }
    flush();
  }

  return lines.sort((a,b)=>b.y-a.y || a.x1-b.x1);
}
function priceCandidates(lines, items) {
  const out = [];
  const push = (price, line, confidence, parts = []) => {
    if (!Number.isFinite(price) || price <= 0 || price >= 10000 || !line) return;
    const dupe = out.some((p) => Math.abs((p.line?.y ?? 0) - (line?.y ?? 0)) < 1 && Math.abs((p.line?.x1 ?? 0) - (line?.x1 ?? 0)) < 2 && Math.abs(p.price - price) < 0.001);
    if (!dupe) out.push({ price, line, confidence, parts });
  };

  // Hlavní prodejní cena je v Lidl PDF velký textový objekt (typicky výška ~64),
  // zatímco původní/přeškrtnuté a měrné ceny jsou výrazně menší.
  for (const item of items) {
    if (item.h < 24) continue;
    const t = item.str.trim();
    let price = null;
    if (/^\d{1,4}[.,]\d{2}$/.test(t)) price = Number(t.replace(',', '.'));
    else if (/^\d{1,4}\.\-$/.test(t) || /^\d{1,4},-$/.test(t)) price = Number(t.replace(/[.,]-$/, ''));
    if (!Number.isFinite(price)) continue;
    const anchor = { y: item.y, x1: item.x, x2: item.x2, h: item.h, text: t };
    push(price, anchor, 'large-price-token', [t]);
  }

  // Fallback pro jiné varianty PDF; tyto kandidáty používáme jen pokud nejsou duplikát velké ceny.
  for (const line of lines) {
    const t = line.text.replace(/\s+/g, ' ');
    let m;
    const exact = /(\d{1,4})\s*[,\.]\s*(\d{2})\s*Kč\b|\b(\d{1,4})\s+(\d{2})\s*Kč\b/gi;
    while ((m = exact.exec(t))) {
      // Jednotkové ceny typu "1 kg = 57,67 Kč" nejsou prodejní cenou balení.
      const before = t.slice(Math.max(0, m.index - 14), m.index);
      if (/=\s*$/.test(before)) continue;
      const whole = Number(m[1] ?? m[3]); const cents = Number(m[2] ?? m[4]);
      push(whole + cents / 100, line, 'line-decimal', [m[0]]);
    }
  }
  return out;
}
function overlap(a1,a2,b1,b2) {
  return Math.max(0, Math.min(a2,b2)-Math.max(a1,b1));
}
function inPriceColumn(priceLine, line) {
  // Většina názvů/balení začíná na stejné X jako velká cena. U některých
  // layoutů (např. pivo na 1. straně) je text hned napravo od ceny. Záměrně
  // nepoužíváme široký překryv, aby se neslepily dva sousední produkty.
  if (Math.abs(line.x1 - priceLine.x1) <= 85) return true;
  if (line.x1 >= priceLine.x2 - 12 && line.x1 <= priceLine.x2 + 55) return true;
  return false;
}
function inPackColumn(packLine, line) {
  if (!packLine) return false;
  // Název a balení jsou v Lidl letáku téměř vždy zarovnané na stejnou levou hranu.
  // Dřívější tolerance 70 bodů dovolovala přisát text sousední karty.
  if (Math.abs(line.x1 - packLine.x1) <= 38) return true;
  const pc = (packLine.x1 + packLine.x2) / 2;
  const lc = (line.x1 + line.x2) / 2;
  return Math.abs(pc - lc) <= 42 && overlap(packLine.x1, packLine.x2, line.x1, line.x2) > 0;
}
function choosePackInfo(priceLine, lines) {
  const candidates = lines
    .filter((line) => {
      const dy = line.y - priceLine.y;
      return dy >= 5 && dy <= 145 && inPriceColumn(priceLine, line) && !/\b(?:Kč|Kc)\b/i.test(line.text) && !/=/.test(line.text);
    })
    .map((line) => ({ line, pack: parsePack(line.text) }))
    .filter((x) => x.pack)
    .sort((a,b) => {
      const da = Math.abs(a.line.y - priceLine.y);
      const db = Math.abs(b.line.y - priceLine.y);
      return da - db;
    });
  return candidates[0] || null;
}
function cleanTitleLine(text) {
  let t = clean(text);
  t = t.replace(/\b\d{1,4}[.,]\d{2}\b/g, ' ')
       .replace(/\b\d{1,4}[.,]-\b/g, ' ')
       .replace(/-?\d+(?:[,.]\d+)?\s*%/g, ' ')
       .replace(/\s+/g, ' ')
       .trim();
  return t;
}
function normalizeCandidateTitle(value) {
  let t = clean(value);
  if (!t) return '';
  // PDF někdy zopakuje stejné slovo na hraně dvou textových objektů.
  const words = t.split(/\s+/);
  const deduped = [];
  for (const word of words) {
    if (deduped.length && normal(deduped[deduped.length - 1]) === normal(word)) continue;
    deduped.push(word);
  }
  t = clean(deduped.join(' '));
  // Sjednoť lomítka variant, ale nevyráběj je uměle z nejasných bloků.
  t = t.replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
  return t;
}

function brandLikeTitleLine(text) {
  const raw = clean(text);
  const letters = raw.replace(/[^A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '').length;
  return upper / letters.length >= 0.8 && raw.split(/\s+/).length <= 3;
}

function standaloneProductLine(text) {
  const raw = clean(text);
  if (!relevantName(raw) || brandLikeTitleLine(raw)) return false;
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length < 2 || raw.length < 8) return false;
  return /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(raw) && titleQuality(raw) >= 2;
}

function composeTitleLines(lines) {
  if (!lines.length) return '';
  const ordered = [...lines].sort((a,b) => b.y-a.y).map((l) => normalizeCandidateTitle(l.titleText)).filter(Boolean);
  if (!ordered.length) return '';
  let out = ordered[0];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    let separator = ' ';

    // Dva plnohodnotné názvy na samostatných řádcích za jednu cenu jsou
    // typicky dva výrobky/varianty, nikoli jedna věta. Nelep je mezerou.
    if (standaloneProductLine(prev) && standaloneProductLine(cur)) separator = ' / ';
    // Samostatná značka + popis produktu na dalším řádku patří k sobě.
    if (brandLikeTitleLine(prev)) separator = ' ';
    // Řádek začínající malým písmenem bývá pokračování předchozího názvu.
    if (/^[a-záčďéěíňóřšťúůýž]/.test(cur)) separator = ' ';

    out += separator + cur;
  }
  return normalizeCandidateTitle(out);
}

function ambiguousCandidateTitle(value) {
  const v = normal(value);
  // Známka prohozeného pořadí dvou pekárenských názvů z různých bloků.
  if (/\b(?:s|se)\s+[a-z]+ou\s+(?:kapsa|rolka|preclik|bageta|pizza)\b/.test(v)) return true;
  // Dvě nebo více zcela obecných jednoslovných kategorií bez značky jsou příliš nejisté.
  if (/^(?:tycinka|jogurt|syr|sunka|napoj|pecivo)(?:\s*\/\s*(?:tycinka|jogurt|syr|sunka|napoj|pecivo))+$/i.test(v)) return true;
  return false;
}

function chooseNameBlock(priceLine, packInfo, lines, allPrices = []) {
  const baseY = packInfo?.line?.y ?? priceLine.y;
  const upperPrice = allPrices
    .map((p) => p.line)
    .filter((line) => line && line.y > priceLine.y + 25 && Math.abs(line.x1 - priceLine.x1) <= 80)
    .sort((a,b) => a.y - b.y)[0] || null;

  const minY = packInfo ? baseY + 2 : priceLine.y + 30;
  const maxYByCard = upperPrice ? upperPrice.y - 16 : priceLine.y + 175;
  const maxY = Math.min(maxYByCard, packInfo ? baseY + 105 : priceLine.y + 175);

  const eligible = lines
    .filter((line) => line.y >= minY && line.y <= maxY && (packInfo ? inPackColumn(packInfo.line, line) : inPriceColumn(priceLine, line)))
    .map((line) => ({ ...line, titleText: cleanTitleLine(line.text) }))
    .filter((line) => relevantName(line.titleText) && !parsePack(line.titleText))
    .sort((a,b) => a.y - b.y); // nejbližší k balení/ceně jako první

  if (!eligible.length) return null;

  // Sestavujeme pouze jeden kompaktní textový blok. Běžné řádky názvu jsou v PDF
  // cca 12–18 bodů od sebe; mezera přes ~24 bodů už typicky znamená jiný produkt.
  const chain = [eligible[0]];
  let last = eligible[0];
  for (const line of eligible.slice(1)) {
    const gap = line.y - last.y;
    if (gap < 0) break;
    if (gap > 24) {
      // U značky nad krátkým/generickým názvem dovol o něco větší mezeru.
      // Tím vrátíme např. SVIJANSKÝ MÁZ + „světlý ležák…“, ale jen pokud
      // je značka ve stejném úzkém sloupci. Běžné vzdálené texty dál nepřipojujeme.
      const currentTitle = composeTitleLines(chain.slice().sort((a,b)=>b.y-a.y));
      const sameNarrowColumn = Math.abs(line.x1 - last.x1) <= 24;
      if (!(gap <= 50 && sameNarrowColumn && brandLikeTitleLine(line.titleText) && isWeakPackagedTitle(currentTitle))) break;
    }
    const xShift = Math.abs(line.x1 - last.x1);
    const centerA = (line.x1 + line.x2) / 2;
    const centerB = (last.x1 + last.x2) / 2;
    if (xShift > 42 && Math.abs(centerA - centerB) > 48) break;
    chain.push(line);
    last = line;
    if (chain.length >= 4) break;
  }

  const brandLike = (text) => {
    const letters = text.replace(/[^A-Za-zÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '');
    if (letters.length < 3) return false;
    const upper = letters.replace(/[^A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g, '').length;
    return upper / letters.length >= 0.8;
  };

  let best = null;
  for (let count = 1; count <= chain.length; count++) {
    const subset = chain.slice(0, count).sort((a,b) => b.y-a.y);
    const title = composeTitleLines(subset);
    const quality = titleQuality(title);
    if (quality < 2 || !relevantName(title) || ambiguousCandidateTitle(title)) continue;

    let score = quality * 10 - (count - 1) * 5;
    if (title.length > 70) score -= (title.length - 70) * 0.25;

    // Dvě různé výrazné značky + běžný popis v jednom bloku bývají slepené sousední
    // produkty (např. KUBÍK + RAUCH, PILOS + LACRUM, BOŽKOV + RADEGAST).
    const brandLines = subset.filter((l) => brandLike(l.titleText)).length;
    const hasLowercaseDescription = subset.some((l) => /[a-záčďéěíňóřšťúůýž]{3,}/.test(l.titleText));
    if (brandLines >= 2 && hasLowercaseDescription && subset.length >= 3) score -= 28;

    // Preferuj kratší dostatečně kvalitní blok před přidáváním vzdálených slov.
    if (!best || score > best.score || (score === best.score && count < best.lines.length)) {
      best = { title, lines: subset, quality, score };
    }
  }

  if (!best) return null;
  return best;
}

function findOldPrice(priceLine, currentPrice, lines) {
  const nearby = lines
    .filter((line) => {
      const dy = line.y - priceLine.y;
      return dy >= 20 && dy <= 90 && inPriceColumn(priceLine, line) && line.h < 22 && !/=|Kč|\b(?:kg|ml|ks)\b/i.test(line.text);
    })
    .flatMap((line) => {
      const vals = [];
      for (const m of line.text.matchAll(/\b(\d{1,4})[.,](\d{2})\b/g)) {
        const value = Number(`${m[1]}.${m[2]}`);
        if (Number.isFinite(value) && value > currentPrice) vals.push(value);
      }
      return vals;
    })
    .sort((a,b) => a-b);
  return nearby[0] ?? null;
}
function findUnitPrice(priceLine, lines) {
  const candidates = lines.filter((line) => Math.abs(line.y - priceLine.y) <= 125 && inPriceColumn(priceLine, line));
  for (const line of candidates) {
    const m = line.text.match(/\b1\s*(kg|l|ks)\s*=\s*(\d{1,4})[,.](\d{2})\s*Kč\b/i);
    if (m) return { basis: `1 ${m[1].toLowerCase()}`, price: Number(`${m[2]}.${m[3]}`) };
  }
  return null;
}

function pageValidity(header, period) {
  const text=normal(header);
  const match=text.match(/od\s+(?:[a-z]+\s+)?(\d{1,2})\.\s*(\d{1,2})\.\s*(?:do|[-–])\s*(\d{1,2})\.\s*(\d{1,2})\./);
  if(!match)return period;
  const year=period.validFrom.slice(0,4);
  const from=year+'-'+match[2].padStart(2,'0')+'-'+match[1].padStart(2,'0');
  const to=year+'-'+match[4].padStart(2,'0')+'-'+match[3].padStart(2,'0');
  if(from>to||from<period.validFrom||to>period.validTo)return null;
  return {validFrom:from,validTo:to};
}

async function extractPdfOffers(pdfBytes, flyer, sourceUrl) {
  const task = getPdfjsLib().getDocument({ data: pdfBytes, disableFontFace: true, useSystemFonts: false });
  const pdf = await task.promise;
  const debug = [];
  const offers = [];
  const seen = new Set();
  const period = {validFrom: dateValue(flyer, true), validTo: dateValue(flyer, false)};

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.map(toItem).filter(Boolean);

    // Raw PDF token dump removed after parser calibration.

    const lines = groupLines(items);
    const pagePeriod = pageValidity(lines.filter(l=>l.y>viewport.height*0.85).map(l=>l.text).join(' '),period);
    if (!pagePeriod) continue;
    const {validFrom,validTo} = pagePeriod;
    const prices = priceCandidates(lines, items);
    let pageAccepted = 0;
    const pageSamples = [];

    for (const candidate of prices) {
      const packInfo = choosePackInfo(candidate.line, lines);
      const nameBlock = chooseNameBlock(candidate.line, packInfo, lines, prices);
      if (!nameBlock) continue;
      const name = clean(nameBlock.title).slice(0, 140);
      if (!relevantName(name) || titleQuality(name) < 2) continue;
      if (/\bv libovolne kombinaci\b/i.test(normal(name))) continue;
      // U balených výrobků musí být název dostatečně identifikovatelný. Samotné
      // „Kokosová tyčinka“ nebo „světlý ležák, retro edice“ bez značky raději
      // vynecháme; ovoce/zelenina a pečivo mohou být přirozeně neznačkové.
      // Slabý/brand-only název zatím ponecháme jako kandidáta: HTML enrichment
      // ho může bezpečně nahradit přesným názvem a obrázkem. Neobohacené slabé
      // názvy se odfiltrují až před zápisem finálního katalogu.
      if (!packInfo) continue; // Missing pack is uncertainty, not one piece.
      const near = lines.filter(l => Math.abs(l.y - candidate.line.y) < 125 && inPriceColumn(candidate.line, l)).map(l => l.text).join(' ');
      if (/lidl plus|kupon|pri nakupu|pri koupi|max\.?\s*\d+|\d+\s*\+\s*\d+/i.test(normal(near))) continue;
      const pkg = packInfo.pack;
      const oldPrice = findOldPrice(candidate.line, candidate.price, lines);
      const unitPrice = findUnitPrice(candidate.line, lines);
      const keyBase = `${normal(name)}|${candidate.price.toFixed(2)}|${pkg.quantity}|${pkg.unit}`;
      if (seen.has(keyBase)) continue;
      seen.add(keyBase);

      const hash = crypto.createHash('sha1').update(keyBase).digest('hex').slice(0, 14);
      const descriptionParts = [`Cena z aktuálního PDF letáku Lidlu, strana ${pageNo}.`];
      if (oldPrice) descriptionParts.push(`Původní cena ${oldPrice.toFixed(2)} Kč.`);
      if (unitPrice) descriptionParts.push(`${unitPrice.basis} = ${unitPrice.price.toFixed(2)} Kč.`);
      const cropLines = [...nameBlock.lines, ...(packInfo ? [packInfo.line] : [])];
      const x1 = Math.max(0, Math.min(candidate.line.x1, ...cropLines.map((l)=>l.x1)) - 55);
      const x2 = Math.min(viewport.width, Math.max(candidate.line.x2, ...cropLines.map((l)=>l.x2)) + 105);
      const textTop = Math.max(candidate.line.y + candidate.line.h, ...cropLines.map((l)=>l.y + l.h));
      const y1 = Math.max(0, candidate.line.y - 28);
      const y2 = Math.min(viewport.height, textTop + 145);
      offers.push({
        id: `lidl-pdf-${hash}-${validFrom}`,
        productKey: `lidl-pdf-${crypto.createHash('sha1').update(normal(name)).digest('hex').slice(0, 14)}`,
        retailer: 'Lidl',
        productName: name,
        category: categoryFor(name),
        subcategory: '',
        price: Math.round(candidate.price * 100) / 100,
        quantity: pkg.quantity,
        unit: pkg.unit,
        validFrom,
        validTo,
        source: 'lidl',
        sourceUrl,
        flyerUrl: `${sourceUrl}#page=${pageNo}`,
        flyerPage: pageNo,
        ...(oldPrice ? { regularPrice: oldPrice } : {}),
        storeName: 'Lidl · akční leták',
        description: descriptionParts.join(' '),
        __pageNo: pageNo,
        __pdfWidth: viewport.width,
        __pdfHeight: viewport.height,
        __crop: { x1, y1, x2, y2 },
      });
      pageAccepted++;
      if (pageSamples.length < 6) pageSamples.push({ name, price: candidate.price, pack: pkg, oldPrice, unitPrice, confidence: candidate.confidence });
    }
    debug.push({ page: pageNo, textItems: items.length, lines: lines.length, priceCandidates: prices.length, accepted: pageAccepted, samples: pageSamples });
    console.log(`[LIDL-DATA] page=${pageNo}/${pdf.numPages} items=${items.length} prices=${prices.length} accepted=${pageAccepted}`);
    if (pageNo <= 5 && pageSamples.length) console.log(`[LIDL-DATA] acceptedSamples page=${pageNo} ${pageSamples.map((s)=>`${s.name} => ${s.price.toFixed(2)} Kč / ${s.pack.quantity} ${s.pack.unit}`).join(' ; ')}`);
    if (pageNo <= 3 && prices.length) console.log(`[LIDL-DATA] priceSamples page=${pageNo} ${prices.slice(0,8).map(p=>`${p.price.toFixed(2)}:${p.confidence}:${p.parts.join('|')}`).join(' ; ')}`);
  }
  return { offers, debug, pages: pdf.numPages };
}

function enrichOffersFromHtml(offers, htmlProducts) {
  let matched=0, images=0, renamed=0;
  for (const offer of offers) {
    if (/(?:kubik.*rauch|bozkov.*radegast|pilos.*lacrum)/.test(normal(offer.productName))) continue;
    const samePrice = htmlProducts.filter((p)=>Math.abs(p.price-offer.price)<=0.021);
    if (!samePrice.length) continue;
    const exactPack = samePrice.filter((p)=>packClose({quantity:offer.quantity,unit:offer.unit},p.pack));
    const pool = exactPack.length ? exactPack : samePrice;
    const scored = pool.map((p)=>{
      const packScore = packClose({quantity:offer.quantity,unit:offer.unit},p.pack) ? 0.72 : (p.pack ? -0.25 : 0);
      const nameScore = tokenSimilarity(offer.productName,p.name);
      const usefulTitle = finalCatalogTitle(p.name) ? 0.18 : 0;
      return { p, score: nameScore + packScore + usefulTitle, nameScore, packScore };
    }).sort((a,b)=>b.score-a.score);
    const best=scored[0]; const second=scored[1];
    const weakSourceTitle = isBrandOnlyTitle(offer.productName) || isWeakPackagedTitle(offer.productName) || !finalCatalogTitle(offer.productName);
    const confident = best.nameScore >= 0.65 && best.packScore > 0 && best.score - (second?.score ?? -1) >= 0.18;
    if (!confident || !finalCatalogTitle(best.p.name)) continue;

    if (best.p.name && (weakSourceTitle || titleQuality(best.p.name)>=titleQuality(offer.productName))) {
      if (normal(best.p.name)!==normal(offer.productName)) renamed++;
      offer.productName=best.p.name; offer.category=categoryFor(best.p.name);
      offer.productKey=`lidl-${crypto.createHash('sha1').update(normal(best.p.name)).digest('hex').slice(0,14)}`;
    }
    if (best.p.imageUrl) { offer.imageUrl=best.p.imageUrl; images++; }
    if (best.p.canonicalUrl) offer.sourceUrl=best.p.canonicalUrl;
    matched++;
  }
  console.log(`[LIDL-DATA] htmlEnrichment matched=${matched} renamed=${renamed} productImages=${images}`);
  return matched;
}

function writeLidlImageMap(assetRows) {
  fs.mkdirSync(path.dirname(APP_LIDL_IMAGE_MAP), { recursive: true });
  const existingRows = assetRows
    .filter((row) => {
      const filePath = path.join(APP_LIDL_IMAGE_DIR, row.fileName);
      try {
        const stat = fs.statSync(filePath);
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const mapLines = existingRows
    .map((row) => `  ${JSON.stringify(row.id)}: require('../assets/lidl-products/${row.fileName}'),`)
    .join('\n');
  const mapSource = `// AUTO-GENERATED by nakupni-seznam-data/scripts/update-lidl.cjs\n` +
    `// Do not edit manually. Only files that physically exist are referenced here.\n` +
    `// Missing ids intentionally fall back to remote image/basket icon.\n` +
    `const images: Record<string, number> = {\n${mapLines}\n};\n\n` +
    `export function lidlImageSource(offerId?: string) {\n  return offerId ? images[offerId] : undefined;\n}\n`;

  // Write the map atomically so Metro never sees a half-written require list.
  const tmpMap = `${APP_LIDL_IMAGE_MAP}.tmp-${process.pid}`;
  fs.writeFileSync(tmpMap, mapSource);
  fs.rmSync(APP_LIDL_IMAGE_MAP, { force: true });
  fs.renameSync(tmpMap, APP_LIDL_IMAGE_MAP);
  return existingRows.length;
}

async function attachFlyerCropImages(offers, flyerPages) {
  // Flyer screenshots look like tiny adverts (price boxes/text) rather than clean product photos.
  // For a polished UI we only keep genuine Lidl product images obtained from HTML enrichment.
  // Unmatched products intentionally fall back to the basket icon instead of a bad crop.
  if (fs.existsSync(APP_ROOT)) {
    // Old assets are not referenced. Keep filesystem cleanup separate from data generation.
    fs.mkdirSync(APP_LIDL_IMAGE_DIR, { recursive: true });
    writeLidlImageMap([]);
  }
  const remoteImages = offers.filter((offer)=>typeof offer.imageUrl==='string' && offer.imageUrl.startsWith('https://imgproxy-retcat.assets.schwarz/')).length;
  console.log(`[LIDL-DATA] productImages=${remoteImages} flyerCrops=0 (quality-first fallback icon for unmatched products)`);
  return remoteImages;
}

function stripInternalOfferFields(offer) {
  const { __pageNo, __pdfWidth, __pdfHeight, __crop, ...publicOffer } = offer;
  return publicOffer;
}
async function main() {
  const overview = await fetchJson(OVERVIEW_URL);
  const flyers = walkFlyers(overview);
  const weekly = chooseWeekly(flyers);
  if (!weekly) throw new Error('Lidl: aktivní potravinový leták nebyl nalezen.');
  const id = clean(weekly.id);
  console.log(`[LIDL-DATA] selected id=${id} name=${clean(weekly.name)} title=${clean(weekly.title)} start=${dateValue(weekly,true)} end=${dateValue(weekly,false)}`);

  const detail = await fetchJson(DETAIL_URL(id));
  const flyer = object(detail.flyer || detail);
  const pdfUrl = clean(flyer.pdfUrl || flyer.hiResPdfUrl);
  if (!/^https:\/\/assets\.leaflets\.schwarz\//.test(pdfUrl)) throw new Error('Lidl: detail neobsahuje bezpečný PDF odkaz.');
  console.log(`[LIDL-DATA] pdf=${pdfUrl}`);
  const bytes = await fetchBuffer(pdfUrl);
  console.log(`[LIDL-DATA] pdfBytes=${bytes.length}`);

  const sourceUrl = 'https://www.lidl.cz/c/akcni-letak/s10008644';
  const extracted = await extractPdfOffers(bytes, weekly, sourceUrl);
  let htmlProducts=[];
  try { htmlProducts=await collectHtmlEnrichment(); enrichOffersFromHtml(extracted.offers,htmlProducts); } catch (error) { console.log(`[LIDL-DATA] htmlEnrichment error=${error instanceof Error?error.message:String(error)}`); }
  await attachFlyerCropImages(extracted.offers, Array.isArray(flyer.pages)?flyer.pages:[]);
  for (const offer of extracted.offers) offer.flyerUrl = `${pdfUrl}#page=${offer.__pageNo}`;
  const cleanedOffers = extracted.offers
    .filter((offer)=>finalCatalogTitle(offer.productName))
    .map(stripInternalOfferFields);
  const catalog = {
    version: 1,
    pipelineVersion: 5,
    source: 'lidl',
    fetchedAt: new Date().toISOString(),
    scope: 'CZ',
    offers: cleanedOffers,
    skipped: extracted.offers.length-cleanedOffers.length,
  };
  if (catalog.offers.length < 15) throw new Error(`Lidl: z PDF bylo bezpečně vytěženo jen ${catalog.offers.length} nabídek; katalog nepřepisuji.`);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(catalog, null, 2) + '\n');
  fs.writeFileSync(DEBUG_FILE, JSON.stringify({ selected: { id, name: weekly.name, title: weekly.title, validFrom: dateValue(weekly,true), validTo: dateValue(weekly,false), pdfUrl }, pages: extracted.pages, offers: catalog.offers.length, diagnostics: extracted.debug }, null, 2) + '\n');

  // Při lokálním vývoji máme datový projekt a mobilní aplikaci jako sourozence.
  // Po úspěšném vygenerování proto čerstvý Lidl katalog rovnou synchronizujeme
  // i do aplikace. V GitHub Actions mobilní složka obvykle vedle není, takže
  // se tento krok jednoduše přeskočí.
  const appCatalogFile = path.resolve(process.cwd(), '..', 'nakupni-seznam', 'data', 'lidlCatalog.json');
  const appDataDir = path.dirname(appCatalogFile);
  if (fs.existsSync(path.resolve(process.cwd(), '..', 'nakupni-seznam'))) {
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.copyFileSync(OUTPUT_FILE, appCatalogFile);
    console.log(`[LIDL-DATA] syncedApp=${appCatalogFile}`);
  } else {
    console.log('[LIDL-DATA] syncedApp=skipped (nakupni-seznam sibling not found)');
  }

  console.log(`[LIDL-DATA] HOTOVO offers=${catalog.offers.length} pages=${extracted.pages}`);
  console.log(`[LIDL-DATA] output=${OUTPUT_FILE}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[LIDL-DATA] ERROR', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { pageValidity,
  clean, normal, groupLines, chooseNameBlock, normalizeCandidateTitle, composeTitleLines, ambiguousCandidateTitle,
  parsePack, priceCandidates, relevantName, titleQuality,
  isPromoOrLegalText, isMeasurementOnlyText, isTechnicalOrCampaignTitle, finalCatalogTitle, hasBrandSignal, isWeakPackagedTitle, isBrandOnlyTitle,
  parseHtmlEnrichment, enrichOffersFromHtml, tokenSimilarity, packClose,
};
