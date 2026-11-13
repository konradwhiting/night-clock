// Fetches the top regional headlines (several per place, the page rotates through them) from public RSS feeds and
// writes news.json next to index.html. Run by .github/workflows/news.yml.
// Node 20 or newer, no dependencies.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT = fileURLToPath(new URL('../news.json', import.meta.url));

// First feed that works wins. For BBC and ABC the first item is the top story.
// Google News search feeds are not ranked by date, so those take the newest item instead.
const gnews = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-AU&gl=AU&ceid=AU:en';

// A story older than this gives way to the next, wider feed, so the headline never sits for days
const EARLWOOD_MAX_AGE_H = 72;
const MAX_AGE_H = 72;
const MAX_ITEMS = 14;  // headlines kept per place, most local first; the page shows as many as fit
const gnewsUk = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-GB&gl=GB&ceid=GB:en';

// Headline words that mark sport, national or international stories, which the Sydney column leaves out.
// Property, food and what's-on sites are not news, so the Sydney column skips them too.
const NOT_NEWS_SOURCES = /real estate|domain|concrete playground|broadsheet|gourmet traveller|mirage news|time out|urban list|drinks trade|sydney times|secret sydney|catholic weekly/i;
const NOT_SYDNEY = new RegExp('\\b(' + [
  // job ads
  'finance officer', 'vacanc\\w*', 'job ads?', 'position available',
  // sport
  'cricket', 'test match', 'ashes', 'bbl', 'afl', 'nrl', 'a-league', 'rugby', 'wallabies', 'socceroos', 'matildas', 'soccer', 'football',
  'tennis', 'golf', 'f1', 'grand prix', 'olympic\\w*', 'commonwealth games', 'world cup', 'premiership', 'state of origin', 'melbourne cup',
  'swans', 'roosters', 'rabbitohs', 'eels', 'bulldogs', 'sea eagles', 'storm', 'broncos', 'warner', 'cummins', 'khawaja', 'smith', 'kyrgios', 'de minaur',
  'swimming', 'athletics', 'jockey', 'racing', 'horse', 'boxing', 'ufc', 'sport\\w*', 'coach', 'quarterback', 'nba', 'nfl',
  // national
  'albanese', 'prime minister', 'canberra', 'federal', 'coalition', 'senate', 'senator', 'parliament house', 'one nation', 'liberal party', 'labor party',
  'reserve bank', 'rba', 'asx', 'westpac', 'cba', 'anz', 'nab', 'aussies?', 'australians', 'across australia', 'australia\\W?s', 'nationwide',
  // international
  'trump', 'biden', 'putin', 'ukraine', 'russia\\w*', 'gaza', 'israel\\w*', 'hamas', 'china', 'chinese', 'xi jinping', 'nato', 'eu', 'europe\\w*',
  'uk', 'britain', 'british', 'london', 'us', 'u\\.s\\.', 'america\\w*', 'new zealand', 'nz', 'japan\\w*', 'india\\w*', 'iran\\w*', 'korea\\w*', 'microsoft', 'google', 'apple', 'tesla', 'bitcoin'
].join('|') + ')\\b', 'i');

export const PLACES = {
  // Earlwood stories are too rare to fill a screen, so this column is Sydney news (no area, so the page shows no tag).
  // Sport, national politics and world news are filtered out by headline (NOT_SYDNEY).
  syd: {
    feeds: [
      { url: 'https://news.google.com/rss/headlines/section/geo/Sydney?hl=en-AU&gl=AU&ceid=AU:en', newest: true, maxAgeHours: MAX_AGE_H, take: 10, skip: NOT_SYDNEY },
      { url: gnews('"NSW Police" OR "Inner West" OR "Sydney council" OR "NSW Government" when:1d'), newest: true, maxAgeHours: MAX_AGE_H, take: 8, skip: NOT_SYDNEY },
      { url: gnews('Sydney NSW -Sweeney when:1d'), newest: true, maxAgeHours: MAX_AGE_H, take: 6, skip: NOT_SYDNEY }
    ]
  },
  uk: {
    feeds: [
      { area: 'Eastbourne', url: gnewsUk('Eastbourne Sussex when:7d'), newest: true, maxAgeHours: MAX_AGE_H, take: 6 },
      { area: 'East Sussex', url: gnewsUk('"East Sussex" when:3d'), newest: true, maxAgeHours: MAX_AGE_H, take: 5 },
      { source: 'BBC News Sussex', url: 'https://feeds.bbci.co.uk/news/england/sussex/rss.xml', maxAgeHours: MAX_AGE_H, take: 4 }
    ]
  }
};

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function tagText(xml, name) {
  const m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  if (!m) return '';
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  const raw = cdata ? cdata[1] : decodeEntities(m[1]);
  return raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function itemFrom(block) {
  let title = tagText(block, 'title');
  if (!title) return null;
  // Google News appends the publisher to the title: "Headline - Publisher"
  const publisher = tagText(block, 'source');
  if (publisher && title.endsWith(' - ' + publisher)) title = title.slice(0, -(publisher.length + 3));
  const date = new Date(tagText(block, 'pubDate'));
  return {
    title,
    link: tagText(block, 'link'),
    published: Number.isNaN(date.getTime()) ? null : date.toISOString(),
    publisher
  };
}

/** Returns every item in a feed, in feed order. */
export function parseItems(xml) {
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  return blocks.map(itemFrom).filter(Boolean);
}

/** Returns {title, link, published} for the first <item>, or null. */
export function parseFirstItem(xml) {
  const first = parseItems(xml)[0];
  if (!first) return null;
  return { title: first.title, link: first.link, published: first.published };
}

// Left out: outlets behind a paywall (donation or registration asks are fine) and weak sources (rewrites, press releases).
export const EXCLUDED_SOURCES = /smh\.com\.au|sydney morning herald|the age|theage\.com|afr|financial review|daily telegraph|telegraph\.co|^the telegraph|^the australian$|courier.?mail|herald sun|herald-sun|west australian|the times|financial times|economist|wall street|new york times|washington post|ssbcrack|senator james|news24/i;

// Search feeds pick up obituaries and notices that are not news.
const SKIP = /obituar|death notice|funeral notice|in memoriam|\bRIP\b|property value estimate|homes? for sale/i;

/** The most recently published item, or the first one if none has a date. */
export function newestItem(xml, exclude = SKIP) {
  const items = parseItems(xml).filter((it) => !exclude.test(it.title));
  if (!items.length) return null;
  return items.reduce((best, it) =>
    (it.published || '') > (best.published || '') ? it : best, items[0]);
}

// Several outlets rewrite the same story. Two headlines sharing three or more longer words, and a third of the shorter one, count as one.
const STOP = new Set(['after', 'about', 'their', 'with', 'from', 'that', 'this', 'into', 'over', 'says', 'were', 'have', 'will', 'been', 'what']);
const words = (t) => new Set(t.toLowerCase().replace(/'s\b/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
export function sameStory(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return false;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common >= 3 && common / Math.min(A.size, B.size) >= 0.3;
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'night-clock/1.0 (+https://github.com/konradwhiting/night-clock)' },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

async function main() {
  let previous = {};
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

  const next = { ...previous };
  let updated = 0;

  for (const [key, place] of Object.entries(PLACES)) {
    const list = [];
    for (const feed of place.feeds) {
      try {
        const xml = await fetchFeed(feed.url);
        let items = parseItems(xml).filter((it) => !SKIP.test(it.title) && !EXCLUDED_SOURCES.test(it.publisher || feed.source || '') && !(feed.skip && (feed.skip.test(it.title) || NOT_NEWS_SOURCES.test(it.publisher || '') || /[^\x00-\x7F\u2018-\u201F\u2013\u2014\u2026]/.test(it.publisher || ''))));
        if (feed.newest) items.sort((a, b) => (b.published || '').localeCompare(a.published || ''));
        items = items.filter((it) => !(feed.maxAgeHours && it.published
          && Date.now() - Date.parse(it.published) > feed.maxAgeHours * 3600 * 1000));
        for (const item of items.slice(0, feed.take || 1)) {
          if (list.some((x) => sameStory(x.title, item.title))) continue;
          const { publisher, ...rest } = item;
          list.push({ ...(feed.area ? { area: feed.area } : {}), source: feed.source || publisher || 'News', ...rest });
        }
      } catch (err) {
        console.warn(`${key}: ${feed.url} failed: ${err.message}`);
      }
    }
    if (list.length) { next[key] = list.slice(0, MAX_ITEMS); updated++; }
    else console.warn(`${key}: keeping the previous headlines`);
  }

  if (updated === 0) {
    console.error('No feed could be read.');
    process.exit(1);
  }

  const body = JSON.stringify(next, null, 2) + '\n';
  const same = JSON.stringify(previous, null, 2) + '\n' === body;
  if (!same) await writeFile(OUT, body);
  console.log(same ? 'Headlines unchanged.' : 'Headlines updated.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
