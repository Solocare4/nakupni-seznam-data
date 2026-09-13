const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const BILLA_PAGE = 'https://www.billa.cz/letaky-billa/velky-letak-aktualni';
const BILLA_SOURCE_URL = BILLA_PAGE;
const PUBLITAS_GROUP = 'billa-cz';

const OUTPUT_FILE = path.join(
  process.cwd(),
  'data',
  'billaCatalog.json'
);

function clean(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normal(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function slugify(value) {
  return normal(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/');
}

function repairTitle(value) {
  let text = clean(value);

  /*
   * PDF občas rozdělí první písmeno:
   *
   * O ld Jersey -> Old Jersey
   * E nergy     -> Energy
   * K okosové   -> Kokosové
   */
  text = text.replace(
    /(^|[\s(])([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])\s+([a-záčďéěíňóřšťúůýž]{2,})/gu,
    '$1$2$3'
  );

  text = text
    .replace(/^[\s\-–—•·]+/, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  /*
   * PDF někdy přilepí k názvu starou cenu:
   *
   * Vepřová pečeně bez kosti 209,00 /
   * Hrozny ... 59,90 /
   *
   * Odstraňujeme pouze cenu na samém konci.
   */
  for (let i = 0; i < 3; i++) {
    const next = text
      .replace(/\s+\d{1,4}[,.]\d{2}\s*\/\s*$/u, '')
      .replace(/^\d{1,4}[,.]\d{2}\s*\/\s*$/u, '')
      .trim();

    if (next === text) {
      break;
    }

    text = next;
  }

  return text;
}

function plausibleTitle(value) {
  const title = repairTitle(value);
  const valueNormal = normal(title);

  if (
    !title ||
    title.length < 3 ||
    title.length > 140
  ) {
    return false;
  }

  /*
   * Název musí obsahovat alespoň jedno písmeno.
   * Tím vypadne např. "24,90 /".
   */
  if (!/[A-Za-zÁ-Žá-ž]/u.test(title)) {
    return false;
  }

  if (
    /^\d{1,4}[,.]\d{2}\s*\/?$/u.test(title)
  ) {
    return false;
  }

  /*
   * Zjevné útržky popisů.
   */
  if (
    /^(baleni|balení|obsahem|obsahuje|obsah|vice druhu|více druhů|vice variant|více variant|dle druhu|dle varianty|vybrane druhy|vybrané druhy|mix druhu|mix druhů)\b/i.test(
      title
    )
  ) {
    return false;
  }

  if (
    /^(g|kg|ml|l|ks|kus|kusy)\b/i.test(title)
  ) {
    return false;
  }

  if (
    /^\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks)\b/i.test(
      title
    )
  ) {
    return false;
  }

  if (
    /^cena\b|^běžná cena\b|^bez klubu\b|^s klubem\b/i.test(
      title
    )
  ) {
    return false;
  }

  /*
   * Běžný název produktu musí začínat
   * písmenem nebo číslem.
   */
  if (
    !/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9]/u.test(title)
  ) {
    return false;
  }

  if (
    valueNormal === 'baleni' ||
    valueNormal === 'obsahem semen'
  ) {
    return false;
  }

  return true;
}

function categoryFor(name) {
  const value = normal(name);

  if (
    /jablk|hrozn|banan|meloun|citron|pomeranc|mandar|paprik|rajce|rajcat|okurk|brambor|cibul|cesnek|mrkev|salat|avokad|ovoce|zelenin/.test(
      value
    )
  ) {
    return 'produce';
  }

  if (
    /mleko|syr|jogurt|smetan|tvaroh|maslo|vejce|kefir|mozzarell|eidam/.test(
      value
    )
  ) {
    return 'dairy';
  }

  if (
    /sunka|salam|klobas|parek|maso|kure|kruta|veprov|hovez|steak|mlete|rizky|ryba|losos/.test(
      value
    )
  ) {
    return 'meat';
  }

  if (
    /napoj|voda|limonad|pivo|vino|dzus|cola|sirup|sekt|energy|tonic|rum|vodka|whisk|liker/.test(
      value
    )
  ) {
    return 'drinks';
  }

  if (
    /mrazen|pizza|zmrzlin|nanuk/.test(value)
  ) {
    return 'frozen';
  }

  if (
    /toalet|ubrousk|praci|cistic|sacek|droger|kapsick.*kock|granule|deodorant|kapesnik|papir|plenk|sampon|sprch|jar|tablety.*myc/.test(
      value
    )
  ) {
    return 'home';
  }

  if (
    /chleb|rohlik|housk|baget|peciv|kolac|koblih|donut|croissant|toust|bochnik/.test(
      value
    )
  ) {
    return 'bakery';
  }

  if (
    /cokolad|bonbon|susenk|oplat|tycink|pralink|dort|dezert|piskot|pernik|zvykack|cukrov/.test(
      value
    )
  ) {
    return 'sweet';
  }

  if (
    /chips|bramburk|krupk|cracker|krek|popcorn|slane|pistaci|arasid|kesu|mandle|preclik/.test(
      value
    )
  ) {
    return 'salty';
  }

  return 'pantry';
}

async function fetchWithTimeout(
  url,
  options = {},
  timeout = 60000
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeout
  );

  try {
    return await fetch(url, {
      ...options,

      signal: controller.signal,

      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',

        ...(options.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(
      `${url} -> HTTP ${response.status}`
    );
  }

  return response.text();
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `${url} -> HTTP ${response.status}`
    );
  }

  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        accept: 'application/pdf',
      },
    },
    120000
  );

  if (!response.ok) {
    throw new Error(
      `${url} -> HTTP ${response.status}`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}

function fontSize(item) {
  const transform = item.transform ?? [];

  return Math.max(
    Math.abs(Number(transform[0]) || 0),
    Math.abs(Number(transform[3]) || 0)
  );
}

function convertItem(item) {
  const transform = item.transform ?? [];

  const x = Number(transform[4]) || 0;
  const y = Number(transform[5]) || 0;
  const width = Number(item.width) || 0;

  return {
    text: clean(item.str),
    x,
    y,
    width,
    centerX: x + width / 2,
    fontSize: fontSize(item),
  };
}

function isMainPrice(item) {
  return (
    /^\d{1,4}[,.]\d{1,2}$/.test(item.text) &&
    item.fontSize >= 26 &&
    item.fontSize <= 35
  );
}

function makeLines(items) {
  const sorted = [...items].sort(
    (a, b) => {
      if (Math.abs(a.y - b.y) > 1.8) {
        return b.y - a.y;
      }

      return a.x - b.x;
    }
  );

  const lines = [];

  for (const item of sorted) {
    let line = lines.find(
      (candidate) =>
        Math.abs(candidate.y - item.y) <= 1.8
    );

    if (!line) {
      line = {
        y: item.y,
        items: [],
      };

      lines.push(line);
    }

    line.items.push(item);
  }

  return lines
    .map((line) => {
      const row = [...line.items].sort(
        (a, b) => a.x - b.x
      );

      const minX = Math.min(
        ...row.map((item) => item.x)
      );

      const maxX = Math.max(
        ...row.map(
          (item) => item.x + item.width
        )
      );

      return {
        y: line.y,

        text: clean(
          row
            .map((item) => item.text)
            .join(' ')
        ),

        minX,
        maxX,

        centerX:
          (minX + maxX) / 2,

        minFont: Math.min(
          ...row.map(
            (item) => item.fontSize
          )
        ),

        maxFont: Math.max(
          ...row.map(
            (item) => item.fontSize
          )
        ),
      };
    })
    .sort((a, b) => b.y - a.y);
}

function assignItemsToAnchors(
  items,
  anchors
) {
  const groups = anchors.map(
    (anchor) => ({
      anchor,
      items: [],
    })
  );

  for (const item of items) {
    if (anchors.includes(item)) {
      continue;
    }

    let bestIndex = -1;
    let bestScore = Infinity;

    for (
      let index = 0;
      index < anchors.length;
      index++
    ) {
      const anchor = anchors[index];

      const dx =
        item.centerX -
        anchor.centerX;

      const dy =
        item.y -
        anchor.y;

      if (
        dx < -155 ||
        dx > 90 ||
        dy < -28 ||
        dy > 145
      ) {
        continue;
      }

      let score =
        Math.abs(dx) / 85 +
        Math.abs(dy) / 70;

      if (dx > 30) {
        score += 0.65;
      }

      if (dy < -12) {
        score += 0.55;
      }

      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (
      bestIndex >= 0 &&
      bestScore <= 2.7
    ) {
      groups[
        bestIndex
      ].items.push(item);
    }
  }

  return groups;
}

function safetyTextForAnchor(
  items,
  anchor
) {
  return clean(
    items
      .filter((item) => {
        if (item === anchor) {
          return false;
        }

        const dx =
          item.centerX -
          anchor.centerX;

        const dy =
          item.y -
          anchor.y;

        return (
          dx >= -165 &&
          dx <= 100 &&
          dy >= -45 &&
          dy <= 145
        );
      })
      .sort((a, b) => {
        if (
          Math.abs(a.y - b.y) > 2
        ) {
          return b.y - a.y;
        }

        return a.x - b.x;
      })
      .map((item) => item.text)
      .join(' ')
  );
}

function conditionalText(text) {
  const normalized = normal(text);

  return (
    /při\s+koupi/i.test(text) ||
    /pri\s+koupi/i.test(normalized) ||
    /při\s+nákupu/i.test(text) ||
    /od\s+\d+\s*(?:ks|kus)/i.test(text) ||
    /max\.?\s*\d+\s*(?:ks|kus)/i.test(text) ||
    /\d+\s*\+\s*\d+/i.test(text) ||
    /kupte\s+\d+/i.test(text) ||
    /zaplaťte\s+\d+/i.test(text) ||
    /cena\s+za\s+1\s+ks\s+při/i.test(text) ||
    /cena\s+za\s+1\s+ks\s+pri/i.test(normalized) ||
    /při\s+koupi\s+balení/i.test(text) ||
    /pri\s+koupi\s+baleni/i.test(normalized)
  );
}

function clubText(text) {
  return (
    /s\s+klubem/i.test(text) ||
    /klubem\s*\//i.test(text) ||
    /billa\s+klub/i.test(text)
  );
}

function parsePack(
  lines,
  anchor
) {
  const candidates = [];

  for (const line of lines) {
    const text = line.text;

    if (
      text.includes('=') ||
      /běžná cena/i.test(text) ||
      /cena za 1 ks/i.test(text) ||
      conditionalText(text) ||
      clubText(text)
    ) {
      continue;
    }

    const multi = text.match(
      /(\d+)\s*[x×]\s*(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)\b/i
    );

    if (multi) {
      const count = Number(
        multi[1]
      );

      const each = Number(
        multi[2].replace(',', '.')
      );

      const quantity =
        count * each;

      if (
        Number.isFinite(quantity) &&
        quantity > 0 &&
        quantity <= 10000
      ) {
        candidates.push({
          quantity,
          unit:
            multi[3].toLowerCase(),
          line,
          score:
            Math.abs(
              line.y -
              anchor.y
            ) - 12,
        });
      }

      continue;
    }

    const matches = [
      ...text.matchAll(
        /(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l|ks)\b/gi
      ),
    ];

    if (!matches.length) {
      continue;
    }

    const match = matches.at(-1);

    const quantity = Number(
      match[1].replace(',', '.')
    );

    const unit =
      match[2].toLowerCase();

    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 10000
    ) {
      continue;
    }

    let score =
      Math.abs(
        line.y -
        anchor.y
      );

    if (
      line.maxFont >= 6 &&
      line.maxFont <= 7
    ) {
      score -= 12;
    } else {
      score += 15;
    }

    if (
      Math.abs(
        line.y -
        anchor.y
      ) > 85
    ) {
      score += 50;
    }

    candidates.push({
      quantity,
      unit,
      line,
      score,
    });
  }

  const best = candidates
    .sort(
      (a, b) =>
        a.score -
        b.score
    )
    .at(0);

  if (best) {
    return best;
  }

  const joined = lines
    .map(
      (line) =>
        line.text
    )
    .join(' ');

  if (
    /(?:cena\s+za\s+)?1\s*kg/i.test(
      joined
    )
  ) {
    return {
      quantity: 1,
      unit: 'kg',
      line: null,
      score: 0,
    };
  }

  return null;
}

function isBadTitleLine(text) {
  const value = normal(text);

  if (
    !value ||
    value.length < 3
  ) {
    return true;
  }

  return (
    /bez klubu|klubem|bez aplikace|běžná cena|bezna cena|sleva|naše cena|nase cena|výhodně|vyhodne|platnost|vyprodání|od \d+ ks|při koupi|pri koupi|100 g|100 ml|1 kg|1 l|1 ks|cena za|kupte|zaplaťte|super pátek|super patek|slev uvnitř|slev uvnitr|^-?\d+\s*%$/i.test(
      value
    )
  );
}

function titleFromLines(
  lines,
  anchor,
  pack
) {
  const referenceY =
    pack?.line?.y ??
    anchor.y;

  const candidates = lines
    .filter(
      (line) => {
        if (
          line.maxFont < 7 ||
          line.maxFont > 8.4
        ) {
          return false;
        }

        if (
          isBadTitleLine(
            line.text
          )
        ) {
          return false;
        }

        if (
          line.centerX <
            anchor.centerX -
              145 ||
          line.centerX >
            anchor.centerX +
              25
        ) {
          return false;
        }

        const dy =
          line.y -
          referenceY;

        return (
          dy >= -4 &&
          dy <= 65
        );
      }
    )
    .sort(
      (a, b) =>
        a.y - b.y
    );

  if (!candidates.length) {
    return null;
  }

  const selected = [];

  let lastY =
    referenceY;

  for (const line of candidates) {
    const gap =
      line.y -
      lastY;

    if (gap < -4) {
      continue;
    }

    if (
      selected.length &&
      gap > 15
    ) {
      break;
    }

    selected.push(line);

    lastY =
      line.y;

    if (
      selected.length >= 4
    ) {
      break;
    }
  }

  if (!selected.length) {
    return null;
  }

  const rawTitle = clean(
    [...selected]
      .sort(
        (a, b) =>
          b.y - a.y
      )
      .map(
        (line) =>
          line.text
      )
      .join(' ')
  );

  const title =
    repairTitle(rawTitle);

  if (
    !plausibleTitle(title)
  ) {
    return null;
  }

  return title;
}

function regularPrice(
  lines,
  anchor
) {
  const candidates = [];

  for (const line of lines) {
    if (
      !/běžná cena/i.test(
        line.text
      )
    ) {
      continue;
    }

    const match =
      line.text.match(
        /(\d{1,4}[,.]\d{1,2})/
      );

    if (match) {
      candidates.push({
        value: Number(
          match[1].replace(
            ',',
            '.'
          )
        ),

        distance:
          Math.abs(
            line.y -
            anchor.y
          ),
      });

      continue;
    }

    const close = lines
      .filter(
        (other) =>
          Math.abs(
            other.y -
            line.y
          ) <= 3 &&
          other !== line
      )
      .map(
        (other) =>
          other.text
      )
      .join(' ');

    const nearby =
      close.match(
        /(\d{1,4}[,.]\d{1,2})/
      );

    if (nearby) {
      candidates.push({
        value: Number(
          nearby[1].replace(
            ',',
            '.'
          )
        ),

        distance:
          Math.abs(
            line.y -
            anchor.y
          ),
      });
    }
  }

  const best = candidates
    .filter(
      (candidate) =>
        Number.isFinite(
          candidate.value
        )
    )
    .sort(
      (a, b) =>
        a.distance -
        b.distance
    )
    .at(0);

  return (
    best?.value ??
    null
  );
}

function slugDates(slug) {
  const match = slug.match(
    /-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{4})$/
  );

  if (!match) {
    throw new Error(
      `BILLA: ze slugu "${slug}" nelze zjistit platnost letáku.`
    );
  }

  const [
    ,
    fromDay,
    fromMonth,
    toDay,
    toMonth,
    year,
  ] = match;

  const pad = (value) =>
    String(value).padStart(
      2,
      '0'
    );

  return {
    validFrom:
      `${year}-${pad(
        fromMonth
      )}-${pad(
        fromDay
      )}`,

    validTo:
      `${year}-${pad(
        toMonth
      )}-${pad(
        toDay
      )}`,
  };
}

function analyzePage(
  items,
  pageNumber
) {
  const anchors =
    items.filter(
      isMainPrice
    );

  const groups =
    assignItemsToAnchors(
      items,
      anchors
    );

  return groups.map(
    ({
      anchor,
      items: ownedItems,
    }) => {
      const lines =
        makeLines(
          ownedItems
        );

      return {
        page:
          pageNumber,

        anchor,

        lines,

        text:
          lines
            .map(
              (line) =>
                line.text
            )
            .join(' '),

        safetyText:
          safetyTextForAnchor(
            items,
            anchor
          ),

        price:
          Number(
            anchor.text.replace(
              ',',
              '.'
            )
          ),
      };
    }
  );
}

function createOffer(
  candidate,
  title,
  pack,
  dates,
  regular
) {
  const key =
    `${slugify(title)}-${pack.quantity}${pack.unit}`;

  const id =
    `billa-pdf-${dates.validFrom}-${candidate.page}-${Math.round(
      candidate.anchor.x
    )}-${Math.round(
      candidate.anchor.y
    )}-${key}`;

  const offer = {
    id,

    productKey:
      `billa-pdf-${key}`,

    retailer:
      'Billa',

    source:
      'billa',

    sourceUrl:
      BILLA_SOURCE_URL,

    flyerPage: candidate.page,
    productName:
      title,

    category:
      categoryFor(title),

    subcategory:
      '',

    price:
      Math.round(
        candidate.price *
          100
      ) / 100,

    quantity:
      pack.quantity,

    unit:
      pack.unit,

    validFrom:
      dates.validFrom,

    validTo:
      dates.validTo,

    storeName:
      'BILLA · celostátní velký leták',

    description:
      'Cena z aktuálního velkého letáku BILLA. Klubové a množstevně podmíněné ceny nejsou zahrnuty. Dostupnost se může lišit podle prodejny.',
  };

  if (
    regular !== null &&
    Number.isFinite(
      regular
    ) &&
    regular >
      candidate.price
  ) {
    offer.regularPrice =
      Math.round(
        regular *
          100
      ) / 100;
  }

  const joined =
    candidate.lines
      .map(
        (line) =>
          line.text
      )
      .join(' ');

  if (
    pack.unit === 'kg' &&
    pack.quantity === 1 &&
    /(?:cena\s+za\s+)?1\s*kg/i.test(
      joined
    )
  ) {
    offer.soldByWeight =
      true;
  }

  return offer;
}

function comparableCatalog(catalog) {
  if (!catalog) {
    return null;
  }

  return {
    version:
      catalog.version,

    source:
      catalog.source,

    storeId:
      catalog.storeId,

    offers:
      catalog.offers,

    skipped:
      catalog.skipped,

    partial:
      catalog.partial,
  };
}

async function main() {
  console.log(
    'BILLA: hledám aktuální velký leták...'
  );

  const html = decodeHtml(
    await fetchText(
      BILLA_PAGE
    )
  );

  const match = html.match(
    /https:\/\/view\.publitas\.com\/billa-cz\/([a-z0-9-]+)/i
  );

  if (!match) {
    throw new Error(
      'BILLA: na stránce nebyl nalezen aktuální Publitas leták.'
    );
  }

  const slug = match[1];

  const dates =
    slugDates(slug);

  console.log(
    `Publikace: ${slug}`
  );

  console.log(
    `Platnost: ${dates.validFrom} až ${dates.validTo}`
  );

  const publicationUrl =
    `https://api.publitas.com/v1/groups/${PUBLITAS_GROUP}/publications/${slug}.json`;

  const publication =
    await fetchJson(
      publicationUrl
    );

  const relativePdf =
    publication
      ?.config
      ?.downloadPdfUrl;

  if (
    typeof relativePdf !==
      'string' ||
    !relativePdf
  ) {
    throw new Error(
      'BILLA: Publitas neposkytl PDF.'
    );
  }

  const pdfUrl =
    relativePdf.startsWith(
      'http'
    )
      ? relativePdf
      : `https://view.publitas.com${relativePdf}`;

  console.log(
    'Stahuji PDF...'
  );

  const buffer =
    await fetchBuffer(
      pdfUrl
    );

  console.log(
    `PDF: ${(
      buffer.length /
      1024 /
      1024
    ).toFixed(2)} MB`
  );

  const loadingTask =
    pdfjsLib.getDocument({
      data:
        new Uint8Array(
          buffer
        ),

      disableWorker: true,
    });

  const pdf =
    await loadingTask.promise;

  console.log(
    `Počet stran: ${pdf.numPages}`
  );

  const candidates = [];

  for (
    let pageNumber = 1;
    pageNumber <=
    pdf.numPages;
    pageNumber++
  ) {
    const page =
      await pdf.getPage(
        pageNumber
      );

    const content =
      await page.getTextContent();

    const items =
      content.items
        .map(convertItem)
        .filter(
          (item) =>
            item.text
        );

    candidates.push(
      ...analyzePage(
        items,
        pageNumber
      )
    );
  }

  const offersMap =
    new Map();

  let clubSkipped = 0;
  let conditionalSkipped = 0;
  let invalidSkipped = 0;

  for (
    const candidate of
    candidates
  ) {
    const safetyText =
      candidate.safetyText;

    if (
      clubText(
        safetyText
      )
    ) {
      clubSkipped++;
      continue;
    }

    if (
      conditionalText(
        safetyText
      )
    ) {
      conditionalSkipped++;
      continue;
    }

    const pack =
      parsePack(
        candidate.lines,
        candidate.anchor
      );

    if (!pack) {
      invalidSkipped++;
      continue;
    }

    const title =
      titleFromLines(
        candidate.lines,
        candidate.anchor,
        pack
      );

    if (!title) {
      invalidSkipped++;
      continue;
    }

    const regular =
      regularPrice(
        candidate.lines,
        candidate.anchor
      );

    if (
      !Number.isFinite(
        candidate.price
      ) ||
      candidate.price <= 0 ||
      candidate.price >
        999999.99
    ) {
      invalidSkipped++;
      continue;
    }

    if (
      regular !== null &&
      (
        !Number.isFinite(
          regular
        ) ||
        regular <=
          candidate.price
      )
    ) {
      invalidSkipped++;
      continue;
    }

    const offer =
      createOffer(
        candidate,
        title,
        pack,
        dates,
        regular
      );

    const duplicateKey = [
      normal(
        offer.productName
      ),
      offer.quantity,
      offer.unit,
      offer.price,
      offer.validFrom,
      offer.validTo,
    ].join('|');

    if (
      !offersMap.has(
        duplicateKey
      )
    ) {
      offersMap.set(
        duplicateKey,
        offer
      );
    }
  }

  const offers =
    [...offersMap.values()].map(offer => ({...offer, flyerUrl: `${pdfUrl}#page=${offer.flyerPage}`}));

  /*
   * Ochrana proti zásadní změně PDF.
   */
  if (
    offers.length < 80 ||
    offers.length > 700
  ) {
    throw new Error(
      `BILLA: podezřelý počet bezpečných nabídek (${offers.length}). Katalog nebude přepsán.`
    );
  }

  const catalog = {
    version: 1,

    source: 'billa',

    fetchedAt:
      new Date().toISOString(),

    storeId: 'cz',

    offers,

    skipped:
      candidates.length -
      offers.length,

    partial: false,
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE
    ),
    {
      recursive: true,
    }
  );

  let previous = null;

  if (
    fs.existsSync(
      OUTPUT_FILE
    )
  ) {
    try {
      previous =
        JSON.parse(
          fs.readFileSync(
            OUTPUT_FILE,
            'utf8'
          )
        );
    } catch {
      previous = null;
    }
  }

  const changed =
    JSON.stringify(
      comparableCatalog(
        previous
      )
    ) !==
    JSON.stringify(
      comparableCatalog(
        catalog
      )
    );

  if (changed) {
    fs.writeFileSync(
      OUTPUT_FILE,

      `${JSON.stringify(
        catalog,
        null,
        2
      )}\n`,

      'utf8'
    );

    console.log(
      'BILLA katalog byl aktualizován.'
    );
  } else {
    console.log(
      'BILLA katalog se nezměnil.'
    );
  }

  console.log('');

  console.log(
    JSON.stringify({
      source:
        'billa-generated',

      publication:
        slug,

      pages:
        pdf.numPages,

      candidates:
        candidates.length,

      accepted:
        offers.length,

      clubSkipped,

      conditionalSkipped,

      invalidSkipped,

      changed,
    })
  );
}

if (require.main === module) main().catch(
  (error) => {
    console.error('');

    console.error(
      error instanceof Error
        ? error.stack ??
            error.message
        : String(error)
    );

    process.exitCode = 1;
  }
);
module.exports = { slugDates, repairTitle, plausibleTitle, conditionalText, clubText };
