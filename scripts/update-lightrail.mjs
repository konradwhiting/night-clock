// Reads the live Inner West Light Rail (L1 Dulwich Hill) trip updates from Transport for NSW
// and writes lightrail.json next to index.html. Run by .github/workflows/lightrail.yml.
//
// Needs a free Transport for NSW Open Data API key in the TFNSW_API_KEY environment variable
// (a GitHub Actions secret). The key never reaches the browser: the page only reads lightrail.json.
// Node 20 or newer. The only dependency is gtfs-realtime-bindings, installed by the workflow.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT = fileURLToPath(new URL('../lightrail.json', import.meta.url));

// Newest endpoint first. The Inner West feed carries only L1 Dulwich Hill.
const FEEDS = [
  'https://api.transport.nsw.gov.au/v2/gtfs/realtime/lightrail/innerwest',
  'https://api.transport.nsw.gov.au/v1/gtfs/realtime/lightrail/innerwest'
];

const LINE = { line: 'L1', name: 'Dulwich Hill' };
const MINOR_S = 5 * 60;       // 5 minutes late or more is a delay worth showing
const MAJOR_S = 10 * 60;      // 10 minutes late or more is a real delay
const FEED_MAX_AGE_S = 15 * 60;  // a feed older than this is not live
const HEARTBEAT_MS = 60 * 60 * 1000;  // rewrite an unchanged status at most once an hour

const minutes = (s) => Math.round(s / 60);

/**
 * Turns a list of trips ({delay: seconds or null, cancelled: boolean}) into a status.
 * Pure, so it can be tested without the network.
 */
export function classify(trips) {
  const cancelled = trips.filter((t) => t.cancelled).length;
  const delays = trips.filter((t) => !t.cancelled && typeof t.delay === 'number').map((t) => Math.max(0, t.delay));
  const worst = delays.length ? Math.max(...delays) : 0;
  const tracked = trips.length - cancelled;

  if (trips.length === 0) {
    return { state: 'quiet', text: 'No trips in the live feed', detail: '', trips: 0, worstMin: 0, cancelled: 0 };
  }
  let state = 'ontime';
  let text = 'Running on time';
  if (cancelled > 0 || worst >= MAJOR_S) { state = 'delays'; text = 'Delays'; }
  else if (worst >= MINOR_S) { state = 'minor'; text = 'Minor delays'; }

  const bits = [];
  if (state === 'ontime') bits.push(tracked + (tracked === 1 ? ' tram' : ' trams') + ' tracked');
  else if (worst >= MINOR_S) bits.push('Up to ' + minutes(worst) + ' min late');
  if (cancelled > 0) bits.push(cancelled + (cancelled === 1 ? ' trip cancelled' : ' trips cancelled'));
  return { state, text, detail: bits.join(' · '), trips: tracked, worstMin: minutes(worst), cancelled };
}

/** Pulls {delay, cancelled} out of every TripUpdate in a decoded GTFS-realtime feed. */
export function tripsFrom(feed, CANCELED = 3) {
  const trips = [];
  for (const e of feed.entity || []) {
    const u = e.tripUpdate;
    if (!u) continue;
    const cancelled = u.trip && u.trip.scheduleRelationship === CANCELED;
    let delay = typeof u.delay === 'number' ? u.delay : null;
    if (delay == null) {
      for (const s of u.stopTimeUpdate || []) {
        const d = s.arrival && typeof s.arrival.delay === 'number' ? s.arrival.delay
          : s.departure && typeof s.departure.delay === 'number' ? s.departure.delay : null;
        if (d != null) { delay = d; break; }
      }
    }
    trips.push({ delay, cancelled: !!cancelled });
  }
  return trips;
}

async function fetchFeed(key) {
  const { default: bindings } = await import('gtfs-realtime-bindings');
  const { FeedMessage } = bindings.transit_realtime;
  let lastError = 'no response';
  for (const url of FEEDS) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: 'apikey ' + key, Accept: 'application/x-google-protobuf' },
        signal: AbortSignal.timeout(30000)
      });
      if (!res.ok) { lastError = 'HTTP ' + res.status; continue; }
      const buf = new Uint8Array(await res.arrayBuffer());
      const feed = FeedMessage.decode(buf);
      return { feed, cancelledCode: bindings.transit_realtime.TripDescriptor.ScheduleRelationship.CANCELED };
    } catch (err) {
      lastError = err.name === 'TimeoutError' ? 'timed out' : 'could not read the feed';
    }
  }
  throw new Error(lastError);
}

async function readExisting() {
  try { return JSON.parse(await readFile(OUT, 'utf8')); } catch { return null; }
}

async function main() {
  const now = new Date();
  const key = process.env.TFNSW_API_KEY;
  let status;

  if (!key) {
    status = { state: 'setup', text: 'Not connected yet', detail: 'Waiting for the Transport for NSW key' };
  } else {
    try {
      const { feed, cancelledCode } = await fetchFeed(key);
      const feedTime = Number(feed.header && feed.header.timestamp) || 0;
      const ageS = feedTime ? (now.getTime() / 1000 - feedTime) : 0;
      if (feedTime && ageS > FEED_MAX_AGE_S) {
        status = { state: 'error', text: 'Status unavailable', detail: 'Live feed is ' + minutes(ageS) + ' min old' };
      } else {
        status = classify(tripsFrom(feed, cancelledCode));
        if (feedTime) status.feedTime = new Date(feedTime * 1000).toISOString();
      }
    } catch (err) {
      status = { state: 'error', text: 'Status unavailable', detail: 'Feed problem: ' + err.message };
    }
  }

  const next = { ...LINE, ...status, updated: now.toISOString() };
  const old = await readExisting();
  const same = old && ['state', 'text', 'detail'].every((k) => old[k] === next[k]);
  const fresh = old && old.updated && now - Date.parse(old.updated) < HEARTBEAT_MS;
  if (same && fresh) {
    console.log('Unchanged: ' + next.text + (next.detail ? ' (' + next.detail + ')' : ''));
    return;
  }
  await writeFile(OUT, JSON.stringify(next, null, 2) + '\n');
  console.log('Wrote: ' + next.text + (next.detail ? ' (' + next.detail + ')' : ''));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
