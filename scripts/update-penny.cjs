const fs =
  require('fs');

const path =
  require('path');

const crypto =
  require('crypto');

const pdfjsLib =
  require('pdfjs-dist/legacy/build/pdf.js');

const PENNY_LEAFLETS_URL =
  'https://www.penny.cz/nabidky/letaky';

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    'data',
    'pennyCatalog.json'
  );

const FIRST_PAGE = 1;
const LAST_PAGE = 100;

function clean(value) {
  return String(
    value ?? ''
  )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function decodeHtml(value) {
  return String(
    value ?? ''
  )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, hex) =>
        String.fromCodePoint(
          parseInt(
            hex,
            16
          )
        )
    )
    .replace(
      /&#(\d+);/g,
      (_, dec) =>
        String.fromCodePoint(
          parseInt(
            dec,
            10
          )
        )
    )
    .replace(
      /&nbsp;/gi,
      ' '
    )
    .replace(
      /&amp;/gi,
      '&'
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;|&apos;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      '<'
    )
    .replace(
      /&gt;/gi,
      '>'
    );
}

async function fetchText(
  url
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      30000
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',

            accept:
              'text/html,text/plain,*/*',
          },
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        `${url} -> HTTP ${response.status}`
      );
    }

    return response.text();
  } finally {
    clearTimeout(
      timer
    );
  }
}

async function fetchBuffer(
  url
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      30000
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36',

            accept:
              'application/pdf,*/*',
          },
        }
      );

    if (
      response.status ===
      404
    ) {
      return null;
    }

    if (
      !response.ok
    ) {
      throw new Error(
        `${url} -> HTTP ${response.status}`
      );
    }

    return new Uint8Array(
      await response.arrayBuffer()
    );
  } finally {
    clearTimeout(
      timer
    );
  }
}

async function currentLeafletRoot() {
  const html =
    decodeHtml(
      await fetchText(
        PENNY_LEAFLETS_URL
      )
    );

  const match =
    html.match(
      /https:\/\/files\.rewe\.co\.at\/PennyIntLeaflet\/CZ\/([^"'<>\\\s/]+)\/?/i
    );

  if (!match) {
    throw new Error(
      'Aktuální PENNY leták nebyl nalezen.'
    );
  }

  return (
    `https://files.rewe.co.at/PennyIntLeaflet/CZ/${match[1]}/`
  );
}

function toIsoDate(
  date
) {
  return date
    .toISOString()
    .slice(
      0,
      10
    );
}

function parseGlobalValidity(
  root
) {
  const match =
    root.match(
      /\/CZ\/(\d{2})_(\d{2})_(\d{4})_/
    );

  if (!match) {
    throw new Error(
      'Z názvu PENNY letáku nejde určit datum platnosti.'
    );
  }

  const day =
    Number(
      match[1]
    );

  const month =
    Number(
      match[2]
    );

  const year =
    Number(
      match[3]
    );

  const from =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  const to =
    new Date(
      from
    );

  to.setUTCDate(
    to.getUTCDate() +
      6
  );

  return {
    validFrom:
      toIsoDate(
        from
      ),

    validTo:
      toIsoDate(
        to
      ),

    year,
  };
}

function validDate(
  year,
  month,
  day
) {
  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  if (
    date.getUTCFullYear() !==
      year ||
    date.getUTCMonth() !==
      month - 1 ||
    date.getUTCDate() !==
      day
  ) {
    return null;
  }

  return date;
}

function overlapsGlobal(
  from,
  to,
  globalValidity
) {
  const globalFrom =
    new Date(
      `${globalValidity.validFrom}T00:00:00Z`
    );

  const globalTo =
    new Date(
      `${globalValidity.validTo}T23:59:59Z`
    );

  return (
    from <=
      globalTo &&
    to >=
      globalFrom
  );
}

function parsePageValidity(
  headerText,
  globalValidity
) {
  const normalized =
    clean(
      headerText
    ).replace(
      /[−‐-‒—]/g,
      '–'
    );

  const candidates =
    [];

  const fullRange =
    /(\d{1,2})\.\s*(\d{1,2})\.\s*–\s*(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?/g;

  let match;

  while (
    (
      match =
        fullRange.exec(
          normalized
        )
    )
  ) {
    const year =
      Number(
        match[5] ||
          globalValidity.year
      );

    const from =
      validDate(
        year,
        Number(
          match[2]
        ),
        Number(
          match[1]
        )
      );

    const to =
      validDate(
        year,
        Number(
          match[4]
        ),
        Number(
          match[3]
        )
      );

    if (
      !from ||
      !to ||
      to < from
    ) {
      continue;
    }

    const days =
      Math.round(
        (
          to -
          from
        ) /
          86400000
      ) + 1;

    if (
      days <= 0 ||
      days > 10 ||
      !overlapsGlobal(
        from,
        to,
        globalValidity
      )
    ) {
      continue;
    }

    candidates.push({
      from,
      to,
      days,
    });
  }

  const sameMonthRange =
    /(\d{1,2})\.\s*–\s*(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?/g;

  while (
    (
      match =
        sameMonthRange.exec(
          normalized
        )
    )
  ) {
    const year =
      Number(
        match[4] ||
          globalValidity.year
      );

    const month =
      Number(
        match[3]
      );

    const from =
      validDate(
        year,
        month,
        Number(
          match[1]
        )
      );

    const to =
      validDate(
        year,
        month,
        Number(
          match[2]
        )
      );

    if (
      !from ||
      !to ||
      to < from
    ) {
      continue;
    }

    const days =
      Math.round(
        (
          to -
          from
        ) /
          86400000
      ) + 1;

    if (
      days <= 0 ||
      days > 10 ||
      !overlapsGlobal(
        from,
        to,
        globalValidity
      )
    ) {
      continue;
    }

    candidates.push({
      from,
      to,
      days,
    });
  }

  if (
    !candidates.length
  ) {
    return {
      validFrom:
        globalValidity.validFrom,

      validTo:
        globalValidity.validTo,

      source:
        'leaflet',
    };
  }

  candidates.sort(
    (
      a,
      b
    ) =>
      a.days -
        b.days ||
      a.from -
        b.from
  );

  const best =
    candidates[0];

  return {
    validFrom:
      toIsoDate(
        best.from
      ),

    validTo:
      toIsoDate(
        best.to
      ),

    source:
      'page',
  };
}

function stripTags(
  value
) {
  return decodeHtml(
    String(
      value ?? ''
    )
      .replace(
        /<br\s*\/?>/gi,
        ' '
      )
      .replace(
        /<[^>]+>/g,
        ' '
      )
  );
}

function htmlParagraphs(
  html
) {
  const result =
    [];

  const regex =
    /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

  let match;

  while (
    (
      match =
        regex.exec(
          html
        )
    )
  ) {
    const text =
      clean(
        stripTags(
          match[1]
        )
      );

    if (text) {
      result.push(
        text
      );
    }
  }

  if (
    !result.length
  ) {
    const fallback =
      clean(
        stripTags(
          html
        )
      );

    if (fallback) {
      result.push(
        fallback
      );
    }
  }

  return result;
}

function makeItem(
  raw,
  index
) {
  if (
    !raw ||
    typeof raw.str !==
      'string' ||
    !Array.isArray(
      raw.transform
    )
  ) {
    return null;
  }

  const text =
    clean(
      raw.str
    );

  if (!text) {
    return null;
  }

  const font =
    Math.abs(
      Number(
        raw.transform[3]
      )
    );

  const x =
    Number(
      raw.transform[4]
    );

  const y =
    Number(
      raw.transform[5]
    );

  const width =
    Number(
      raw.width
    ) || 0;

  if (
    !Number.isFinite(
      font
    ) ||
    !Number.isFinite(
      x
    ) ||
    !Number.isFinite(
      y
    )
  ) {
    return null;
  }

  return {
    index,
    text,
    font,
    x,
    y,
    width,

    right:
      x +
      width,

    centerX:
      x +
      width / 2,
  };
}

function hasLetters(
  text
) {
  return /[A-Za-zÁ-Žá-ž]/u.test(
    text
  );
}

function uppercase(
  text
) {
  const letters =
    text.replace(
      /[^A-Za-zÁ-Žá-ž]/gu,
      ''
    );

  if (!letters) {
    return false;
  }

  return (
    letters ===
    letters.toLocaleUpperCase(
      'cs-CZ'
    )
  );
}

function noise(
  text
) {
  const value =
    clean(
      text
    ).toLocaleUpperCase(
      'cs-CZ'
    );

  const exact =
    new Set([
      'AI',
      'AI.',
      'BIO',
      'PENNY',
      'SUPER',
      'CENA',
      'CENA!',
      'NABÍDKA',
      'JEDINEČNÁ',
      'SLEVA',
      'KČ',
      'KG',
      'G',
      'KS',
      'L',
      'ML',
      'MAX.',
      'VYROBENO V ČR',
      'S JINÝM DRUHEM',
      '6 KS V BALENÍ',
    ]);

  if (
    exact.has(
      value
    )
  ) {
    return true;
  }

  return [
    /^PLATNOST/,
    /^NABÍDKA PLATNÁ/,
    /^OD STŘEDY/,
    /^DO ÚTERÝ/,
    /^OD PÁTKU/,
    /^JIŽ OD/,
    /^CENA ZA/,
    /^NEJNIŽŠÍ CENA/,
    /^NÍZKÉ CENY/,
    /^ILUSTRAČNÍ/,
    /^NA TÉTO STRANĚ/,
    /^SLEVA AŽ/,
    /^MEZINÁRODNÍ DEN/,
    /^NA ČOKOLÁDY/,
    /^NA KÁVU/,
    /^NA VYBRANÉ/,
    /^PRO TYTO PRODEJNY/,
    /^VŽDY STEJNÁ BALENÍ/,
    /^NEJDE KOMBINOVAT/,
    /^NOVÁ SKLIZEŇ$/,
    /^VELKÉ KUSY$/,
    /^SVAČINOVÁ PAUZA/,
    /^PONDĚLÍ A ÚTERÝ/,
    /^SUPER VÍKEND/,
    /^\d+\s*KS\s+V\s+BALENÍ/,
  ].some(
    (
      pattern
    ) =>
      pattern.test(
        value
      )
  );
}

function isTitleToken(
  item
) {
  if (
    item.font <
      5.15 ||
    item.font >
      8.25
  ) {
    return false;
  }

  if (
    /^\d{1,3}%$/.test(
      item.text
    )
  ) {
    return true;
  }

  if (
    !hasLetters(
      item.text
    ) ||
    !uppercase(
      item.text
    ) ||
    noise(
      item.text
    )
  ) {
    return false;
  }

  return true;
}

function sameRun(
  previous,
  current
) {
  if (
    Math.abs(
      previous.font -
        current.font
    ) > 0.55
  ) {
    return false;
  }

  const dy =
    Math.abs(
      previous.y -
        current.y
    );

  if (
    dy <= 2.4
  ) {
    const gap =
      current.x -
      previous.right;

    return (
      gap >= -15 &&
      gap <= 55
    );
  }

  if (
    dy > 2.4 &&
    dy <= 10.5
  ) {
    return (
      Math.abs(
        current.x -
          previous.x
      ) <= 30
    );
  }

  return false;
}

function makeRun(
  source
) {
  const text =
    clean(
      source
        .map(
          (
            item
          ) =>
            item.text
        )
        .join(
          ' '
        )
    );

  if (
    !text ||
    !hasLetters(
      text
    ) ||
    noise(
      text
    ) ||
    /^\d{1,3}%$/.test(
      text
    )
  ) {
    return null;
  }

  const x =
    Math.min(
      ...source.map(
        (
          item
        ) =>
          item.x
      )
    );

  const right =
    Math.max(
      ...source.map(
        (
          item
        ) =>
          item.right
      )
    );

  const top =
    Math.max(
      ...source.map(
        (
          item
        ) =>
          item.y
      )
    );

  const bottom =
    Math.min(
      ...source.map(
        (
          item
        ) =>
          item.y
      )
    );

  return {
    text,
    x,
    right,
    top,
    bottom,

    centerX:
      (
        x +
        right
      ) / 2,

    centerY:
      (
        top +
        bottom
      ) / 2,

    font:
      source.reduce(
        (
          sum,
          item
        ) =>
          sum +
          item.font,
        0
      ) /
      source.length,

    firstIndex:
      Math.min(
        ...source.map(
          (
            item
          ) =>
            item.index
        )
      ),

    lastIndex:
      Math.max(
        ...source.map(
          (
            item
          ) =>
            item.index
        )
      ),
  };
}

function buildRuns(
  items
) {
  const runs =
    [];

  let current =
    [];

  const flush =
    () => {
      if (
        !current.length
      ) {
        return;
      }

      const run =
        makeRun(
          current
        );

      current =
        [];

      if (run) {
        runs.push(
          run
        );
      }
    };

  for (
    const item of
    items
  ) {
    if (
      !isTitleToken(
        item
      )
    ) {
      flush();
      continue;
    }

    if (
      !current.length
    ) {
      current.push(
        item
      );

      continue;
    }

    if (
      sameRun(
        current.at(
          -1
        ),
        item
      )
    ) {
      current.push(
        item
      );

      continue;
    }

    flush();

    current.push(
      item
    );
  }

  flush();

  return runs;
}

function overlapLength(
  a1,
  a2,
  b1,
  b2
) {
  return Math.max(
    0,
    Math.min(
      a2,
      b2
    ) -
      Math.max(
        a1,
        b1
      )
  );
}

function mergeableRuns(
  upper,
  lower
) {
  const sourceGap =
    lower.firstIndex -
    upper.lastIndex;

  if (
    sourceGap < 0 ||
    sourceGap > 9
  ) {
    return false;
  }

  if (
    Math.abs(
      upper.font -
        lower.font
    ) > 0.6
  ) {
    return false;
  }

  const verticalGap =
    upper.bottom -
    lower.top;

  if (
    verticalGap < 2 ||
    verticalGap >
      11.5
  ) {
    return false;
  }

  const startAligned =
    Math.abs(
      upper.x -
        lower.x
    ) <= 35;

  const centerAligned =
    Math.abs(
      upper.centerX -
        lower.centerX
    ) <= 55;

  const overlap =
    overlapLength(
      upper.x,
      upper.right,
      lower.x,
      lower.right
    );

  const minWidth =
    Math.min(
      upper.right -
        upper.x,
      lower.right -
        lower.x
    );

  const overlapRatio =
    minWidth > 0
      ? overlap /
        minWidth
      : 0;

  return (
    startAligned ||
    centerAligned ||
    overlapRatio >=
      0.35
  );
}

function combineRuns(
  upper,
  lower
) {
  const x =
    Math.min(
      upper.x,
      lower.x
    );

  const right =
    Math.max(
      upper.right,
      lower.right
    );

  const top =
    Math.max(
      upper.top,
      lower.top
    );

  const bottom =
    Math.min(
      upper.bottom,
      lower.bottom
    );

  return {
    text:
      clean(
        `${upper.text} ${lower.text}`
      ),

    x,
    right,
    top,
    bottom,

    centerX:
      (
        x +
        right
      ) / 2,

    centerY:
      (
        top +
        bottom
      ) / 2,

    font:
      (
        upper.font +
        lower.font
      ) / 2,

    firstIndex:
      Math.min(
        upper.firstIndex,
        lower.firstIndex
      ),

    lastIndex:
      Math.max(
        upper.lastIndex,
        lower.lastIndex
      ),
  };
}

function mergeBrokenTitles(
  inputRuns
) {
  let runs =
    [
      ...inputRuns,
    ];

  let changed =
    true;

  while (changed) {
    changed =
      false;

    runs.sort(
      (
        a,
        b
      ) =>
        a.firstIndex -
        b.firstIndex
    );

    const result =
      [];

    for (
      let i = 0;
      i <
      runs.length;

    ) {
      const current =
        runs[i];

      const next =
        runs[
          i + 1
        ];

      if (
        next &&
        mergeableRuns(
          current,
          next
        )
      ) {
        result.push(
          combineRuns(
            current,
            next
          )
        );

        i += 2;

        changed =
          true;
      } else {
        result.push(
          current
        );

        i += 1;
      }
    }

    runs =
      result;
  }

  return runs;
}

async function loadPdfTitles(
  root,
  pageNumber
) {
  const url =
    new URL(
      `files/assets/common/downloads/page${String(
        pageNumber
      ).padStart(
        4,
        '0'
      )}.pdf`,
      root
    ).href;

  const data =
    await fetchBuffer(
      url
    );

  if (!data) {
    return null;
  }

  const document =
    await pdfjsLib
      .getDocument({
        data,

        disableFontFace:
          true,

        useSystemFonts:
          false,
      })
      .promise;

  const page =
    await document.getPage(
      1
    );

  const content =
    await page.getTextContent();

  const items =
    content.items
      .map(
        (
          raw,
          index
        ) =>
          makeItem(
            raw,
            index
          )
      )
      .filter(
        Boolean
      );

  return mergeBrokenTitles(
    buildRuns(
      items
    )
  );
}

function normalizeSearch(
  value
) {
  return clean(
    value
  )
    .replace(
      /\*/g,
      ''
    )
    .replace(
      /[‐-‒–—]/g,
      '-'
    )
    .toLocaleUpperCase(
      'cs-CZ'
    );
}

function locateTitles(
  flatText,
  titles
) {
  const upper =
    normalizeSearch(
      flatText
    );

  const located =
    [];

  let cursor =
    0;

  for (
    const title of
    titles
  ) {
    const needle =
      normalizeSearch(
        title.text
      );

    if (
      !needle ||
      needle.length <
        3
    ) {
      continue;
    }

    const variants =
      [
        needle,

        needle
          .split(
            ' '
          )
          .slice(
            0,
            6
          )
          .join(
            ' '
          ),

        needle
          .split(
            ' '
          )
          .slice(
            0,
            4
          )
          .join(
            ' '
          ),

        needle
          .split(
            ' '
          )
          .slice(
            0,
            3
          )
          .join(
            ' '
          ),
      ].filter(
        (
          value,
          index,
          array
        ) =>
          value.length >=
            5 &&
          array.indexOf(
            value
          ) ===
            index
      );

    let index =
      -1;

    let usedNeedle =
      needle;

    for (
      const variant of
      variants
    ) {
      index =
        upper.indexOf(
          variant,
          cursor
        );

      if (
        index >= 0
      ) {
        usedNeedle =
          variant;

        break;
      }
    }

    if (
      index < 0
    ) {
      continue;
    }

    located.push({
      title:
        title.text,

      index,
    });

    cursor =
      index +
      Math.max(
        1,
        usedNeedle.length
      );
  }

  return located;
}

function productBlocks(
  flatText,
  located
) {
  return located.map(
    (
      current,
      index
    ) => {
      const next =
        located[
          index + 1
        ];

      return {
        title:
          current.title,

        text:
          clean(
            flatText.slice(
              current.index,
              next
                ? next.index
                : flatText.length
            )
          ),
      };
    }
  );
}

function parseNumber(
  value
) {
  return Number(
    String(
      value
    )
      .replace(
        /\s/g,
        ''
      )
      .replace(
        ',',
        '.'
      )
  );
}

function unitInfo(
  amount,
  unit
) {
  const value =
    Number(
      amount
    );

  const name =
    String(
      unit
    ).toLocaleLowerCase(
      'cs-CZ'
    );

  if (
    !Number.isFinite(
      value
    )
  ) {
    return null;
  }

  if (
    name === 'g'
  ) {
    return {
      dimension:
        'mass',

      value,
    };
  }

  if (
    name === 'kg'
  ) {
    return {
      dimension:
        'mass',

      value:
        value *
        1000,
    };
  }

  if (
    name === 'ml'
  ) {
    return {
      dimension:
        'volume',

      value,
    };
  }

  if (
    name === 'l'
  ) {
    return {
      dimension:
        'volume',

      value:
        value *
        1000,
    };
  }

  if (
    name === 'ks'
  ) {
    return {
      dimension:
        'count',

      value,
    };
  }

  if (
    name === 'm'
  ) {
    return {
      dimension:
        'length',

      value,
    };
  }

  return null;
}

function parseBasis(
  text
) {
  const match =
    String(
      text
    )
      .trim()
      .match(
        /^(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|ks|m)$/i
      );

  if (!match) {
    return null;
  }

  return unitInfo(
    parseNumber(
      match[1]
    ),
    match[2]
  );
}

function calculatedPrices(
  blockText
) {
  const results =
    [];

  const regex =
    /(?:(\d+)\s*[x×]\s*)?(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l|ks|m)\s*(?:\|\s*)?(100\s*g|1\s*kg|100\s*ml|1\s*l|1\s*ks|1\s*m)\s+(\d+(?:[,.]\d+)?)\s*Kč/giu;

  let match;

  while (
    (
      match =
        regex.exec(
          blockText
        )
    )
  ) {
    const multiplier =
      match[1]
        ? Number(
            match[1]
          )
        : 1;

    const packageAmount =
      parseNumber(
        match[2]
      );

    const packageUnit =
      match[3];

    const basis =
      parseBasis(
        match[4]
      );

    const unitPrice =
      parseNumber(
        match[5]
      );

    const quantity =
      unitInfo(
        packageAmount,
        packageUnit
      );

    if (
      !quantity ||
      !basis ||
      quantity.dimension !==
        basis.dimension ||
      !Number.isFinite(
        unitPrice
      ) ||
      multiplier <=
        0
    ) {
      continue;
    }

    const calculated =
      (
        quantity.value *
        multiplier *
        unitPrice
      ) /
      basis.value;

    if (
      !Number.isFinite(
        calculated
      ) ||
      calculated <=
        0 ||
      calculated >
        5000
    ) {
      continue;
    }

    results.push({
      calculated:
        Math.round(
          calculated *
            100
        ) /
        100,

      source:
        clean(
          match[0]
        ),

      packageText:
        match[1]
          ? `${multiplier}x ${match[2]} ${packageUnit}`
          : `${match[2]} ${packageUnit}`,

      unitPriceText:
        `${clean(
          match[4]
        )} ${match[5]} Kč`,
    });
  }

  return results;
}

function extractCurrentPrices(
  prefix
) {
  const prices =
    [];

  const regex =
    /\d{1,4},\d{2}/g;

  let match;

  while (
    (
      match =
        regex.exec(
          prefix
        )
    )
  ) {
    const end =
      match.index +
      match[0].length;

    const after =
      prefix
        .slice(
          end
        )
        .trimStart();

    if (
      after.startsWith(
        '/'
      )
    ) {
      continue;
    }

    const value =
      parseNumber(
        match[0]
      );

    if (
      Number.isFinite(
        value
      ) &&
      value > 0 &&
      value < 5000
    ) {
      prices.push({
        text:
          match[0],

        value,
      });
    }
  }

  return prices;
}

function closestPrice(
  calculated,
  candidates
) {
  if (
    !candidates.length
  ) {
    return null;
  }

  return candidates
    .map(
      (
        candidate
      ) => ({
        ...candidate,

        difference:
          Math.abs(
            candidate.value -
              calculated
          ),
      })
    )
    .sort(
      (
        a,
        b
      ) =>
        a.difference -
        b.difference
    )[0];
}

function unsafeCondition(
  blockText
) {
  const value =
    clean(
      blockText
    ).toLocaleUpperCase(
      'cs-CZ'
    );

  return [
    /PENNY\s*KARTA/,
    /S\s+PENNY\s+KARTOU/,
    /POUZE\s+S\s+KARTOU/,
    /S\s+KARTOU\s+PENNY/,
    /PŘI\s+KOUPI/,
    /PŘI\s+NÁKUPU/,
    /PŘI\s+ODBĚRU/,
    /\b\d+\s*\+\s*\d+\b/,
    /DRUHÝ\s+KUS/,
    /2\.\s*KUS/,
    /OD\s+\d+\s*KS/,
    /MIN\.\s*\d+\s*KS/,
  ].some(
    (
      pattern
    ) =>
      pattern.test(
        value
      )
  );
}

function cleanOfferName(
  value
) {
  return clean(
    value
  )
    .replace(
      /\s*\*+\s*$/g,
      ''
    )
    .replace(
      /\s+([,.;:])/g,
      '$1'
    )
    .trim();
}

function invalidOfferName(
  value
) {
  const name =
    cleanOfferName(
      value
    ).toLocaleUpperCase(
      'cs-CZ'
    );

  if (
    name.length < 3 ||
    !hasLetters(
      name
    )
  ) {
    return true;
  }

  return [
    /^VYROBENO V ČR$/,
    /^\d+\s*KS\s+V\s+BALENÍ$/,
    /^S JINÝM DRUHEM$/,
    /^TO GO$/,
    /^SHARE$/,
    /^Z PODESTÝLKY$/,
    /^V NABÍDCE TAKÉ$/,
  ].some(
    (
      pattern
    ) =>
      pattern.test(
        name
      )
  );
}

function makeId(
  name,
  price,
  validFrom,
  validTo
) {
  return (
    `penny-${
      crypto
        .createHash(
          'sha1'
        )
        .update(
          `${name}|${price.toFixed(
            2
          )}|${validFrom}|${validTo}`
        )
        .digest(
          'hex'
        )
        .slice(
          0,
          16
        )
    }`
  );
}

async function processPage(
  root,
  pageNumber,
  globalValidity
) {
  const titles =
    await loadPdfTitles(
      root,
      pageNumber
    );

  if (!titles) {
    return null;
  }

  const pageUrl =
    new URL(
      `${pageNumber}/`,
      root
    ).href;

  const html =
    await fetchText(
      pageUrl
    );

  const flatText =
    clean(
      htmlParagraphs(
        html
      ).join(
        ' '
      )
    );

  const located =
    locateTitles(
      flatText,
      titles
    );

  if (
    !located.length
  ) {
    return {
      pageNumber,

      offers:
        [],

      stats: {
        titles:
          titles.length,

        located:
          0,

        blocks:
          0,

        accepted:
          0,

        unresolved:
          0,

        suspicious:
          0,

        conditionalSkipped:
          0,

        invalidTitleSkipped:
          0,
      },
    };
  }

  const prefix =
    flatText.slice(
      0,
      located[0].index
    );

  const pageValidity =
    parsePageValidity(
      prefix.slice(
        0,
        3000
      ),
      globalValidity
    );

  const currentPrices =
    extractCurrentPrices(
      prefix
    );

  const blocks =
    productBlocks(
      flatText,
      located
    );

  const offers =
    [];

  let unresolved =
    0;

  let suspicious =
    0;

  let conditionalSkipped =
    0;

  let invalidTitleSkipped =
    0;

  for (
    const block of
    blocks
  ) {
    const name =
      cleanOfferName(
        block.title
      );

    if (
      invalidOfferName(
        name
      )
    ) {
      invalidTitleSkipped++;

      continue;
    }

    if (
      unsafeCondition(
        block.text
      )
    ) {
      conditionalSkipped++;

      continue;
    }

    const calculations =
      calculatedPrices(
        block.text
      );

    if (
      !calculations.length
    ) {
      unresolved++;

      continue;
    }

    let best =
      null;

    for (
      const calculation of
      calculations
    ) {
      const candidate =
        closestPrice(
          calculation.calculated,
          currentPrices
        );

      if (!candidate) {
        continue;
      }

      const result = {
        calculation,
        candidate,
      };

      if (
        !best ||
        candidate.difference <
          best.candidate
            .difference
      ) {
        best =
          result;
      }
    }

    if (
      !best ||
      best.candidate
        .difference >
        0.55
    ) {
      suspicious++;

      continue;
    }

    const price =
      Math.round(
        best.candidate
          .value *
          100
      ) /
      100;

    offers.push({
      id:
        makeId(
          name,
          price,
          pageValidity.validFrom,
          pageValidity.validTo
        ),

      retailer:
        'Penny',

      name,

      price,

      currency:
        'CZK',

      packageText:
        best.calculation
          .packageText,

      unitPriceText:
        best.calculation
          .unitPriceText,

      validFrom:
        pageValidity.validFrom,

      validTo:
        pageValidity.validTo,

      sourceUrl:
        pageUrl,

      page:
        pageNumber,

      verification:
        'unit-price-arithmetic',
    });
  }

  return {
    pageNumber,

    offers,

    stats: {
      titles:
        titles.length,

      located:
        located.length,

      blocks:
        blocks.length,

      accepted:
        offers.length,

      unresolved,

      suspicious,

      conditionalSkipped,

      invalidTitleSkipped,
    },
  };
}

function deduplicate(
  offers
) {
  const map =
    new Map();

  for (
    const offer of
    offers
  ) {
    const key =
      [
        offer.name.toLocaleUpperCase(
          'cs-CZ'
        ),

        offer.price.toFixed(
          2
        ),

        offer.validFrom,

        offer.validTo,
      ].join(
        '|'
      );

    if (
      !map.has(
        key
      )
    ) {
      map.set(
        key,
        offer
      );
    }
  }

  return [
    ...map.values(),
  ];
}

async function main() {
  console.log(
    'PENNY PRODUKČNÍ IMPORTER'
  );

  console.log(
    '========================'
  );

  const root =
    await currentLeafletRoot();

  const globalValidity =
    parseGlobalValidity(
      root
    );

  console.log(
    `Leták: ${root}`
  );

  console.log(
    `Základní platnost: ${globalValidity.validFrom} až ${globalValidity.validTo}`
  );

  console.log('');

  const pageResults =
    [];

  const allOffers =
    [];

  for (
    let pageNumber =
      FIRST_PAGE;
    pageNumber <=
      LAST_PAGE;
    pageNumber++
  ) {
    const result =
      await processPage(
        root,
        pageNumber,
        globalValidity
      );

    if (!result) { if (pageNumber === 1) continue; break; }

    pageResults.push(
      result
    );

    allOffers.push(
      ...result.offers
    );

    const s =
      result.stats;

    console.log(
      `Strana ${String(
        pageNumber
      ).padStart(
        2
      )} | +${String(
        s.accepted
      ).padStart(
        2
      )} | ` +
        `bez výpočtu ${String(
          s.unresolved
        ).padStart(
          2
        )} | ` +
        `podezřelé ${String(
          s.suspicious
        ).padStart(
          2
        )} | ` +
        `podmíněné ${String(
          s.conditionalSkipped
        ).padStart(
          2
        )}`
    );
  }

  const offers =
    deduplicate(
      allOffers
    ).sort(
      (
        a,
        b
      ) => {
        if (
          a.page !==
          b.page
        ) {
          return (
            a.page -
            b.page
          );
        }

        return a.name.localeCompare(
          b.name,
          'cs-CZ'
        );
      }
    );

  const removedDuplicates =
    allOffers.length -
    offers.length;

  const totals =
    pageResults.reduce(
      (
        acc,
        result
      ) => {
        for (
          const [
            key,
            value,
          ] of
          Object.entries(
            result.stats
          )
        ) {
          acc[key] =
            (
              acc[key] ||
              0
            ) +
            value;
        }

        return acc;
      },
      {}
    );

  const output = {
    source:
      'penny-generated',

    generatedAt:
      new Date()
        .toISOString(),

    leafletUrl:
      root,

    validFrom:
      globalValidity.validFrom,

    validTo:
      globalValidity.validTo,

    verification:
      'unit-price-arithmetic',

    offers,
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE
    ),
    {
      recursive:
        true,
    }
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify(
      output,
      null,
      2
    )}\n`,
    'utf8'
  );

  console.log('');

  console.log(
    'SOUHRN'
  );

  console.log(
    '======'
  );

  console.log(
    `Bezpečně potvrzené před deduplikací: ${allOffers.length}`
  );

  console.log(
    `Duplicit odstraněno: ${removedDuplicates}`
  );

  console.log(
    `Výsledný PENNY katalog: ${offers.length}`
  );

  console.log(
    `Bez výpočtu: ${totals.unresolved || 0}`
  );

  console.log(
    `Podezřelé vynechané: ${totals.suspicious || 0}`
  );

  console.log(
    `Podmíněné / PENNY karta vynechané: ${totals.conditionalSkipped || 0}`
  );

  console.log(
    `Neplatné názvy vynechané: ${totals.invalidTitleSkipped || 0}`
  );

  console.log(
    `Soubor: ${OUTPUT_FILE}`
  );

  for (
    const checkPage of
    [
      2,
      26,
    ]
  ) {
    const sample =
      offers.filter(
        (
          offer
        ) =>
          offer.page ===
          checkPage
      );

    console.log('');

    console.log(
      `KONTROLA STRANY ${checkPage} (${sample.length} nabídek)`
    );

    console.log(
      '-----------------------------'
    );

    for (
      const offer of
      sample.slice(
        0,
        20
      )
    ) {
      console.log(
        `${offer.price
          .toFixed(
            2
          )
          .replace(
            '.',
            ','
          )
          .padStart(
            8
          )} Kč | ${offer.name} | ${offer.packageText}`
      );
    }
  }
}

if (require.main === module) main().catch(
  (
    error
  ) => {
    console.error('');

    console.error(
      error instanceof
      Error
        ? error.stack ??
            error.message
        : String(
            error
          )
    );

    process.exitCode =
      1;
  }
);
module.exports = { parseGlobalValidity, unitInfo, invalidOfferName, unsafeCondition };
