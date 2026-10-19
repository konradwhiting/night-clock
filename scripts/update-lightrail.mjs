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
const CANCEL_FADE_MIN = 30;     // stop flagging a cancelled trip this long after it was due
const HEARTBEAT_MS = 20 * 60 * 1000;  // rewrite an unchanged status at least every 20 minutes, so the 'checked' time stays honest

const minutes = (s) => Math.round(s / 60);

// "13:42:00" (GTFS start time, local) or a Unix time in seconds -> "13:42" in Sydney
const hhmm = (v) => {
  if (typeof v === 'string') {
    const m = /^(\d+):(\d\d)/.exec(v);
    return m ? String(Number(m[1]) % 24).padStart(2, '0') + ':' + m[2] : null;
  }
  const n = Number(v);
  if (!n) return null;
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(n * 1000));
};

/**
 * Turns a list of trips ({delay: seconds or null, cancelled: boolean}) into a status.
 * Pure, so it can be tested without the network.
 */
export function classify(trips, nowMin = null) {
  // minutes since a cancelled trip was due, or null if its time is unknown (or it is still ahead)
  const since = (t) => {
    if (nowMin == null || !t.at) return null;
    const [h, m] = t.at.split(':').map(Number);
    const diff = (nowMin - (h * 60 + m) + 1440) % 1440;
    return diff < 720 ? diff : null;
  };
  // a cancelled trip that was due over half an hour ago no longer matters to anyone leaving now
  const allCancelled = trips.filter((t) => t.cancelled);
  const live = allCancelled.filter((t) => { const d = since(t); return d == null || d <= CANCEL_FADE_MIN; });
  const cancelled = live.length;
  const delays = trips.filter((t) => !t.cancelled && typeof t.delay === 'number').map((t) => Math.max(0, t.delay));
  const worst = delays.length ? Math.max(...delays) : 0;
  const tracked = trips.length - allCancelled.length;

  if (trips.length === 0) {
    return { state: 'quiet', text: 'No trips in the live feed', detail: '', trips: 0, worstMin: 0, cancelled: 0 };
  }
  let state = 'ontime';
  let text = 'Running normally';
  // Words follow Transport for NSW's own: Delays, Cancellations
  if (worst >= MAJOR_S) { state = 'delays'; text = 'Delays'; }
  else if (worst >= MINOR_S) { state = 'minor'; text = 'Delays'; }
  else if (cancelled > 0) { state = 'delays'; text = 'Cancellations'; }

  const times = [...new Set(live.filter((t) => t.at).map((t) => t.at))].sort();
  const bits = [];
  if (state === 'ontime') bits.push(tracked + (tracked === 1 ? ' tram' : ' trams') + ' tracked');
  else if (worst >= MINOR_S) bits.push('Up to ' + minutes(worst) + ' min late');
  if (cancelled > 0) {
    if (times.length === 1 && cancelled === 1) {
      const past = since(live.find((t) => t.at)) != null;
      bits.push('The ' + times[0] + ' tram ' + (past ? 'was' : 'is') + ' cancelled');
    } else {
      const shown = times.slice(0, 3).join(', ') + (times.length > 3 ? '…' : '');
      bits.push(cancelled + ' trips cancelled' + (times.length ? ': ' + shown : ''));
    }
  }
  const out = { state, text, detail: bits.join(' · '), trips: tracked, worstMin: minutes(worst), cancelled };
  if (times.length) out.cancelledAt = times;
  return out;
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
    // when a cancelled trip was due to run: its scheduled start time, else its first stop time
    let at = null;
    if (cancelled) {
      at = hhmm(u.trip && u.trip.startTime);
      for (const st of u.stopTimeUpdate || []) {
        if (at) break;
        at = hhmm((st.departure && st.departure.time) || (st.arrival && st.arrival.time));
      }
    }
    trips.push({ delay, cancelled: !!cancelled, at });
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
        const sydney = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
        const [nh, nm] = sydney.split(':').map(Number);
        status = classify(tripsFrom(feed, cancelledCode), (nh % 24) * 60 + nm);
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
