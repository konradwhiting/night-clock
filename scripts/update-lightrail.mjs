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

// The live feed has been seen carrying a delay of about 42 hours on a few late-night trips (a stop repeated with a time
// two days ahead). No tram is that late, so a delay beyond this is treated as a feed error and ignored.
const MAX_SANE_DELAY_S = 2 * 60 * 60;
const sane = (d) => (typeof d === 'number' && Math.abs(d) <= MAX_SANE_DELAY_S ? d : null);

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

// Her school trips (Mon to Fri). Stop ids come from the Transport for NSW timetable (scripts/lightrail-stops.mjs).
//   morning: Dulwich Hill, leaving just before 8am, to Jubilee Park (towards Central)
//   afternoon: Jubilee Park (towards Dulwich Hill), around 3:20pm, back to Dulwich Hill
export const MY_TRIPS = {
  morning: { from: '220363', to: '203779', label: 'Dulwich Hill to Jubilee Park', window: [7 * 60 + 15, 8 * 60 + 30] },
  afternoon: { from: '203780', to: '220363', label: 'Jubilee Park to Dulwich Hill', window: [15 * 60, 16 * 60] }
};

const sydneyMin = (epochSec) => {
  const [h, m] = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(epochSec * 1000)).split(':').map(Number);
  return (h % 24) * 60 + m;
};
const hmOf = (min) => String(Math.floor(min / 60) % 24).padStart(2, '0') + ':' + String(Math.round(min) % 60).padStart(2, '0');

/**
 * Trips that pass the origin stop and then the destination stop, with when they are due at the origin.
 * window = [fromMin, toMin] of scheduled time (minutes since midnight, Sydney); null keeps every trip.
 */
export function myTrips(trips, cfg, nowMin = null, window = cfg.window) {
  const out = [];
  for (const t of trips) {
    const st = t.stopTimes || [];
    const i = st.findIndex((x) => x.id === cfg.from);
    const j = st.findIndex((x) => x.id === cfg.to);
    if (i < 0 || j <= i) continue;
    const delaySec = st[i].delay != null ? st[i].delay : (typeof t.delay === 'number' ? t.delay : 0);
    let expMin = null;
    if (st[i].time) expMin = sydneyMin(st[i].time);
    else if (i === 0 && typeof t.start === 'string') { const m = /^(\d+):(\d\d)/.exec(t.start); if (m) expMin = Number(m[1]) * 60 + Number(m[2]) + delaySec / 60; }
    if (expMin == null) continue;
    const schedMin = Math.round(st[i].time && st[i].delay == null ? expMin : expMin - delaySec / 60);
    if (window && (schedMin < window[0] || schedMin > window[1])) continue;
    if (nowMin != null && Math.max(expMin, schedMin) < nowMin - 5) continue;  // already gone
    out.push({ schedMin, delayMin: minutes(Math.max(0, delaySec)), cancelled: !!t.cancelled });
  }
  return out.sort((a, b) => a.schedMin - b.schedMin);
}

/** A status for her trips only, in the same shape as classify(). Null when none are in view. */
export function classifyMine(list) {
  if (!list.length) return null;
  const shown = list.slice(0, 4);
  const ok = (x) => !x.cancelled && x.delayMin < MINOR_S / 60;
  const cancelled = list.filter((x) => x.cancelled).length;
  const worst = Math.max(0, ...list.filter((x) => !x.cancelled).map((x) => x.delayMin));
  let state = 'ontime', text = 'Running normally';
  if (cancelled > 0) {
    text = 'Cancellations';
    // A cancelled tram with another one on time within 10 minutes costs only a short wait: a notice (amber), not an alarm (red).
    const shortWait = list.every((x, i) => {
      if (!x.cancelled) return true;
      const next = list.slice(i + 1).find((y) => !y.cancelled);
      return !!next && next.schedMin - x.schedMin <= 10 && ok(next);
    });
    state = shortWait && worst < MINOR_S / 60 ? 'notice' : 'delays';
  } else if (worst >= MAJOR_S / 60) { state = 'delays'; text = 'Delays'; }
  else if (worst >= MINOR_S / 60) { state = 'minor'; text = 'Delays'; }
  // Problems first, then the trams that are fine, grouped: "08:09 cancelled · 08:15, 08:21, 08:27 on time"
  const problems = shown.filter((x) => !ok(x)).map((x) => hmOf(x.schedMin) + (x.cancelled ? ' cancelled' : ' ' + x.delayMin + ' min late'));
  const good = shown.filter(ok).map((x) => hmOf(x.schedMin));
  const detail = problems.concat(good.length ? [good.join(', ') + ' on time'] : []).join(' · ');
  return { state, text, detail, cancelled };
}

/** Pulls {delay, cancelled} out of every TripUpdate in a decoded GTFS-realtime feed. */
export function tripsFrom(feed, CANCELED = 3) {
  const trips = [];
  for (const e of feed.entity || []) {
    const u = e.tripUpdate;
    if (!u) continue;
    const cancelled = u.trip && u.trip.scheduleRelationship === CANCELED;
    let delay = sane(u.delay);
    let ignored = typeof u.delay === 'number' && delay == null;
    if (delay == null) {
      for (const s of u.stopTimeUpdate || []) {
        const raw = s.arrival && typeof s.arrival.delay === 'number' ? s.arrival.delay
          : s.departure && typeof s.departure.delay === 'number' ? s.departure.delay : null;
        const d = sane(raw);
        if (raw != null && d == null) ignored = true;
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
    const stops = (u.stopTimeUpdate || []).map((st) => st.stopId).filter(Boolean);
    const stopTimes = (u.stopTimeUpdate || []).map((st) => {
      const ev = st.departure || st.arrival || {};
      const ownDelay = sane(typeof ev.delay === 'number' ? ev.delay : null);
      return { id: st.stopId, time: ev.time ? Number(ev.time) : null, delay: ownDelay };
    });
    trips.push({
      delay, cancelled: !!cancelled, at, stopTimes, start: u.trip && u.trip.startTime,
      id: u.trip && u.trip.tripId, startDate: u.trip && u.trip.startDate, ignoredDelay: ignored,
      info: cancelled ? {
        tripId: u.trip && u.trip.tripId, routeId: u.trip && u.trip.routeId, direction: u.trip && u.trip.directionId,
        start: u.trip && u.trip.startTime, firstStop: stops[0], lastStop: stops[stops.length - 1], stops: stops.length
      } : undefined
    });
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
        const parsed = tripsFrom(feed, cancelledCode);
        const bad = parsed.filter((t) => t.ignoredDelay).length;
        if (bad) console.log('Ignored an impossible delay (over 2 hours) on ' + bad + ' trips: ' + parsed.filter((t) => t.ignoredDelay).map((t) => t.id + ' ' + t.start).join(', '));
        for (const t of parsed) if (t.info) console.log('Cancelled trip:', JSON.stringify(t.info));
        for (const t of parsed) {
          if (!t.cancelled && typeof t.delay === 'number' && t.delay >= 300) {
            const st = (t.stopTimes || []).slice(0, 3).map((x) => x.id + '@' + (x.time ? new Date(x.time * 1000).toISOString() : '-') + '/d' + x.delay);
            console.log('Late trip:', JSON.stringify({ id: t.id, startDate: t.startDate, start: t.start, delayMin: Math.round(t.delay / 60), firstStops: st }));
          }
        }
        const nowMin = (nh % 24) * 60 + nm;
        const lineStatus = classify(parsed, nowMin);
        status = lineStatus;
        // her trips: weekday mornings and afternoons
        const dow = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short' }).format(now);
        for (const k of Object.keys(MY_TRIPS)) console.log('Her ' + k + ' trips in the feed (any time):', JSON.stringify(myTrips(parsed, MY_TRIPS[k], null, null).map((x) => hmOf(x.schedMin) + (x.cancelled ? 'X' : '+' + x.delayMin))));
        if (!/^(Sat|Sun)/.test(dow)) {
          const mode = nowMin < 12 * 60 ? 'morning' : 'afternoon';
          const mine = classifyMine(myTrips(parsed, MY_TRIPS[mode], nowMin));
          if (mine) {
            status = { ...mine, trips: lineStatus.trips, worstMin: lineStatus.worstMin, scope: 'yours', label: MY_TRIPS[mode].label,
              line: { state: lineStatus.state, text: lineStatus.text, detail: lineStatus.detail } };
          }
        }
        if (feedTime) status.feedTime = new Date(feedTime * 1000).toISOString();
      }
    } catch (err) {
      status = { state: 'error', text: 'Status unavailable', detail: 'Feed problem: ' + err.message };
    }
  }

  const next = { ...LINE, ...status, updated: now.toISOString() };
  const old = await readExisting();
  const same = old && ['state', 'text', 'detail', 'label'].every((k) => old[k] === next[k]);
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
