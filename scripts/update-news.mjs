// Fetches the top regional headline for each place from public RSS feeds and
// writes news.json next to index.html. Run by .github/workflows/news.yml.
// Node 20 or newer, no dependencies.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT = fileURLToPath(new URL('../news.json', import.meta.url));

// First feed that works wins. For BBC and ABC the first item is the top story.
// Google News search feeds are not ranked by date, so those take the newest item instead.
const gnews = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=en-AU&gl=AU&ceid=AU:en';

export const PLACES = {
  syd: {
    feeds: [
      { area: 'Earlwood', url: gnews('Earlwood when:14d'), newest: true },
      { area: 'Canterbury-Bankstown and Inner West', url: gnews('"Canterbury-Bankstown" OR "Inner West" Sydney when:7d'), newest: true },
      { source: 'ABC News NSW', url: 'https://www.abc.net.au/news/feed/5555986/rss.xml' }
    ]
  },
  uk: {
    feeds: [
      { source: 'BBC News Sussex', url: 'https://feeds.bbci.co.uk/news/england/sussex/rss.xml' },
      { source: 'BBC News England', url: 'https://feeds.bbci.co.uk/news/england/rss.xml' }
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

/** The most recently published item, or the first one if none has a date. */
export function newestItem(xml) {
  const items = parseItems(xml);
  if (!items.length) return null;
  return items.reduce((best, it) =>
    (it.published || '') > (best.published || '') ? it : best, items[0]);
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
    let found = null;
    for (const feed of place.feeds) {
      try {
        const xml = await fetchFeed(feed.url);
        const item = feed.newest ? newestItem(xml) : parseFirstItem(xml);
        if (item) {
          const { publisher, ...rest } = item;
          found = { ...(feed.area ? { area: feed.area } : {}), source: feed.source || publisher || 'News', ...rest };
          break;
        }
        console.warn(`${key}: no items in ${feed.url}`);
      } catch (err) {
        console.warn(`${key}: ${feed.url} failed: ${err.message}`);
      }
    }
    if (found) { next[key] = found; updated++; }
    else console.warn(`${key}: keeping the previous headline`);
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
