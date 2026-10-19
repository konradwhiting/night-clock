// One-off helper: prints the Inner West Light Rail stops (id, name, parent) from the Transport for NSW
// timetable data, so a personal trip can be set up by stop name. Run by .github/workflows/lightrail-stops.yml.
import { execFileSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const key = process.env.TFNSW_API_KEY;
if (!key) { console.error('No TFNSW_API_KEY'); process.exit(1); }

const URLS = [
  'https://api.transport.nsw.gov.au/v1/gtfs/schedule/lightrail/innerwest',
  'https://api.transport.nsw.gov.au/v2/gtfs/schedule/lightrail/innerwest'
];
let buf = null;
for (const url of URLS) {
  const res = await fetch(url, { headers: { Authorization: 'apikey ' + key }, signal: AbortSignal.timeout(60000) });
  console.log(url, '->', res.status);
  if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); break; }
}
if (!buf) { console.error('Could not download the timetable'); process.exit(1); }

const dir = await mkdtemp(join(tmpdir(), 'lr-'));
const zip = join(dir, 'gtfs.zip');
await writeFile(zip, buf);
const read = (name) => execFileSync('unzip', ['-p', zip, name], { maxBuffer: 200 * 1024 * 1024 }).toString('utf8');

const rows = (txt) => {
  const lines = txt.replace(/\r/g, '').split('\n').filter(Boolean);
  const head = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
  return lines.slice(1).map((l) => {
    const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
};

const stops = rows(read('stops.txt'));
console.log('STOPS', stops.length);
for (const s of stops) console.log('STOP', [s.stop_id, s.stop_name, 'parent=' + (s.parent_station || ''), 'type=' + (s.location_type || ''), s.platform_code || ''].join(' | '));

// one example trip each way, to show stop order
const trips = rows(read('trips.txt'));
const times = rows(read('stop_times.txt'));
const name = Object.fromEntries(stops.map((s) => [s.stop_id, s.stop_name]));
for (const dir of ['0', '1']) {
  const t = trips.find((x) => x.direction_id === dir);
  if (!t) continue;
  const seq = times.filter((x) => x.trip_id === t.trip_id).sort((a, b) => +a.stop_sequence - +b.stop_sequence);
  console.log('TRIP direction', dir, t.trip_id, t.trip_headsign || '');
  for (const x of seq) console.log('  SEQ', x.stop_sequence, x.stop_id, name[x.stop_id], x.departure_time);
}
