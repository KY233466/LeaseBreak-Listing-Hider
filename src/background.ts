// Background service worker: commute-time lookups via Transitous (https://transitous.org).
// All network calls happen here so requests are cached, serialized and rate-limited
// across every open tab. Transitous usage policy: non-commercial, light use
// (< ~720 /plan requests per day), User-Agent with contact (set via rules.json).

const API = 'https://api.transitous.org/api';
const NYC = '40.7128,-74.006';
// NYC bounding box + borough check keep e.g. "Bedford Avenue" from matching towns upstate.
const NYC_MIN = '40.47,-74.28';
const NYC_MAX = '40.93,-73.68';
const BOROUGH_RE = /^(Manhattan|Brooklyn|Queens|(The )?Bronx|Staten Island)$/i;
const NY_TZ = 'America/New_York';

export const COMMUTE_KEYS = {
  enabled: 'commuteEnabled',
  dest: 'commuteDest',
  arrival: 'commuteArrival',
  day: 'commuteDay',
} as const;
const CACHE_KEY = 'commuteCache';
const GEOCODE_KEY = 'geocodeCache';
const COORDS_KEY = 'coordsByListing';
const USAGE_KEY = 'commuteUsage';

const CACHE_TTL_MS = 14 * 24 * 3600 * 1000;
const MIN_GAP_MS = 1500;
const DAILY_PLAN_LIMIT = 600;

export const DEFAULT_ARRIVAL = '08:00';
export const DEFAULT_DAY = 2; // Tuesday (0 = Sunday)

export interface LatLon { lat: number; lon: number }
export interface Place extends LatLon { name: string }

/** What the content script needs to build a "check in Google Maps" link. Not cached. */
export interface MapsInfo { origin: string; dest: string; arriveIso: string }

export type CommuteResult = (
  | { status: 'ok'; minutes: number; leaveBy: string; arriveAt: string; lines: string[]; transfers: number }
  | { status: 'error'; reason: 'disabled' | 'no-destination' | 'address-not-found' | 'no-route' | 'daily-limit' | 'network' }
) & { maps?: MapsInfo };

export type BgMessage =
  | { type: 'commute'; listingId: string; coords?: LatLon; address?: string }
  | { type: 'geocode'; text: string };

// ---------- time helpers ----------

/** Offset like "-05:00" for America/New_York at the given instant. */
function nyOffset(at: Date): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  const m = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return '+00:00';
  return `${m[1]}${m[2].padStart(2, '0')}:${m[3] ?? '00'}`;
}

/** Next occurrence (strictly in the future) of weekday `day` at "HH:MM" New York time, as ISO with offset. */
export function nextArrivalIso(day: number, hhmm: string, now = new Date()): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: NY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now); // YYYY-MM-DD in NY
  const [y, mo, d] = ymd.split('-').map(Number);
  for (let add = 0; add <= 7; add++) {
    const date = new Date(Date.UTC(y, mo - 1, d + add, 12)); // noon UTC: safe for weekday/date math
    if (date.getUTCDay() !== day) continue;
    const dateStr = date.toISOString().slice(0, 10);
    const iso = `${dateStr}T${hhmm}:00${nyOffset(new Date(`${dateStr}T${hhmm}:00Z`))}`;
    if (new Date(iso).getTime() > now.getTime()) return iso;
  }
  throw new Error('unreachable');
}

export function fmtNyTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: NY_TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

// ---------- API ----------

interface Leg { mode: string; routeShortName?: string }
interface Itinerary { duration: number; startTime: string; endTime: string; transfers: number; legs: Leg[] }

/** Pick the itinerary that lets you leave latest while still arriving on time. */
export function pickItinerary(its: Itinerary[], targetIso: string): Itinerary | null {
  const target = new Date(targetIso).getTime();
  const ok = its.filter((it) => new Date(it.endTime).getTime() <= target && it.legs.some((l) => l.mode !== 'WALK'));
  ok.sort((a, b) =>
    new Date(b.startTime).getTime() - new Date(a.startTime).getTime() || a.transfers - b.transfers);
  return ok[0] ?? null;
}

export function summarize(it: Itinerary): Extract<CommuteResult, { status: 'ok' }> {
  const lines = it.legs
    .filter((l) => l.mode !== 'WALK')
    .map((l) => l.routeShortName?.trim() || (l.mode === 'BUS' ? 'bus' : l.mode.toLowerCase()));
  return {
    status: 'ok',
    minutes: Math.round(it.duration / 60),
    leaveBy: it.startTime,
    arriveAt: it.endTime,
    lines,
    transfers: it.transfers,
  };
}

const ABBR: Record<string, string> = {
  e: 'east', w: 'west', n: 'north', s: 'south', st: 'street', ave: 'avenue', av: 'avenue',
  blvd: 'boulevard', pl: 'place', rd: 'road', dr: 'drive', pkwy: 'parkway', ln: 'lane',
};
const GENERIC = new Set(['east', 'west', 'north', 'south', 'street', 'avenue', 'boulevard', 'place',
  'road', 'drive', 'parkway', 'lane', 'the', 'of', 'and']);
const tokens = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean).map((w) => ABBR[w] ?? w);

const BOROUGHS = ['manhattan', 'brooklyn', 'queens', 'bronx', 'staten island'];

/** Split "225 E 10th St, Manhattan" into street part + borough (if the last part names one). */
function splitBorough(query: string): { street: string; borough: string | null } {
  const parts = query.split(',').map((p) => p.trim());
  const last = parts[parts.length - 1]?.toLowerCase().replace(/^the\s+/, '') ?? '';
  return BOROUGHS.includes(last) && parts.length > 1
    ? { street: parts.slice(0, -1).join(', '), borough: last }
    : { street: query, borough: null };
}

/** "225 E 10th St" -> "225 East 10th Street" (the geocoder matches full words better). */
export function expandAbbreviations(text: string): string {
  return text.replace(/\b([A-Za-z]+)\b\.?/g, (w, word: string) => {
    const full = ABBR[word.toLowerCase()];
    return full ? full.replace(/^./, (c) => c.toUpperCase()) : w;
  });
}

/**
 * Is the match plausibly the queried address? Its street words / house number must all
 * appear in the query's street part, and its borough must match the query's borough.
 * Rejects e.g. "5th Avenue" for "E 10th St & Avenue A".
 */
export function plausibleMatch(query: string, matchName: string, matchAreas: string[] = []): boolean {
  const { street, borough } = splitBorough(query);
  if (borough && !matchAreas.some((a) => a.toLowerCase().replace(/^the\s+/, '') === borough)) return false;
  const q = new Set(tokens(street));
  // Street words only: house numbers may differ slightly (geocoder ranks the nearest first).
  const key = tokens(matchName).filter((w) => !GENERIC.has(w) && !/^\d+(-\d+)?$/.test(w));
  return key.length > 0 && key.every((w) => q.has(w));
}

/**
 * Geocode within NYC. `addressOnly` restricts to street addresses (for listings);
 * otherwise landmarks/places are allowed too (for the destination search).
 */
export async function geocode(text: string, limit = 1, addressOnly = true): Promise<Place[]> {
  const params = new URLSearchParams({
    text: addressOnly ? expandAbbreviations(text) : text, place: NYC, min: NYC_MIN, max: NYC_MAX, numResults: String(Math.max(limit, 5)),
  });
  if (addressOnly) params.set('type', 'ADDRESS');
  const res = await fetch(`${API}/v1/geocode?${params}`);
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const data = (await res.json()) as { name: string; lat: number; lon: number; areas?: { name: string; default?: boolean }[] }[];
  const seen = new Set<string>();
  const places: Place[] = [];
  for (const m of data) {
    if (!m.areas?.some((a) => BOROUGH_RE.test(a.name))) continue;
    if (addressOnly && !plausibleMatch(text, m.name, m.areas.map((a) => a.name))) continue;
    const area = m.areas.find((a) => a.default)?.name;
    const name = area ? `${m.name}, ${area}` : m.name;
    if (seen.has(name)) continue;
    seen.add(name);
    places.push({ name, lat: m.lat, lon: m.lon });
  }
  return places.slice(0, limit);
}

export async function plan(from: LatLon, to: LatLon, arriveIso: string): Promise<Itinerary[]> {
  const url = `${API}/v6/plan?${new URLSearchParams({
    fromPlace: `${from.lat},${from.lon}`,
    toPlace: `${to.lat},${to.lon}`,
    time: arriveIso,
    arriveBy: 'true',
  })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`plan ${res.status}`);
  return ((await res.json()) as { itineraries: Itinerary[] }).itineraries ?? [];
}

// ---------- extension glue (only when running as the service worker) ----------

const isServiceWorker = typeof chrome !== 'undefined' && !!chrome.runtime?.onMessage;

if (isServiceWorker) {
  const local = chrome.storage.local;

  // Serialize API calls with a minimum gap, shared across all tabs.
  let chain: Promise<unknown> = Promise.resolve();
  let lastCall = 0;
  const throttled = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = lastCall + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };

  // Coalesce identical in-flight requests (e.g. same listing open in two tabs).
  const inflight = new Map<string, Promise<CommuteResult>>();

  async function takePlanQuota(): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    const { [USAGE_KEY]: u } = await local.get(USAGE_KEY);
    const usage = u && u.date === today ? u : { date: today, count: 0 };
    if (usage.count >= DAILY_PLAN_LIMIT) return false;
    await local.set({ [USAGE_KEY]: { date: today, count: usage.count + 1 } });
    return true;
  }

  async function cachedGeocode(address: string): Promise<LatLon | null> {
    const { [GEOCODE_KEY]: cache = {} } = await local.get(GEOCODE_KEY);
    if (address in cache) return cache[address];
    const [hit] = await throttled(() => geocode(address));
    const value = hit ? { lat: hit.lat, lon: hit.lon } : null;
    const { [GEOCODE_KEY]: fresh = {} } = await local.get(GEOCODE_KEY);
    await local.set({ [GEOCODE_KEY]: { ...fresh, [address]: value } });
    return value;
  }

  async function commute(msg: Extract<BgMessage, { type: 'commute' }>): Promise<CommuteResult> {
    const s = await local.get([...Object.values(COMMUTE_KEYS), COORDS_KEY]);
    if (s[COMMUTE_KEYS.enabled] !== true) return { status: 'error', reason: 'disabled' };
    const dest = s[COMMUTE_KEYS.dest] as Place | undefined;
    if (!dest) return { status: 'error', reason: 'no-destination' };
    const day = typeof s[COMMUTE_KEYS.day] === 'number' ? s[COMMUTE_KEYS.day] : DEFAULT_DAY;
    const arrival = typeof s[COMMUTE_KEYS.arrival] === 'string' ? s[COMMUTE_KEYS.arrival] : DEFAULT_ARRIVAL;
    const arriveIso = nextArrivalIso(day, arrival);
    const ll = (p: LatLon) => `${p.lat},${p.lon}`;

    // Origin coordinates: exact (detail page) > remembered from detail page > geocoded address.
    let from: LatLon | null = msg.coords ?? s[COORDS_KEY]?.[msg.listingId] ?? null;
    // Link info even if lookups fail below: Google can still try the raw address.
    const maps: MapsInfo | undefined = from || msg.address
      ? { origin: from ? ll(from) : msg.address!, dest: ll(dest), arriveIso }
      : undefined;
    const withMaps = (r: CommuteResult): CommuteResult => ({ ...r, maps });

    try {
      if (msg.coords) {
        const { [COORDS_KEY]: all = {} } = await local.get(COORDS_KEY);
        await local.set({ [COORDS_KEY]: { ...all, [msg.listingId]: msg.coords } });
      }
      if (!from && msg.address) from = await cachedGeocode(msg.address);
      if (!from) return withMaps({ status: 'error', reason: 'address-not-found' });
      if (maps) maps.origin = ll(from);
      const key = `${msg.listingId}|${from.lat.toFixed(5)},${from.lon.toFixed(5)}|${dest.lat},${dest.lon}|${day}|${arrival}`;
      return withMaps(await routeCached(key, from, dest, arriveIso));
    } catch {
      return withMaps({ status: 'error', reason: 'network' });
    }
  }

  /** Cached (without the per-call `maps` info) and quota-limited route lookup. */
  async function routeCached(key: string, from: LatLon, dest: LatLon, arriveIso: string): Promise<CommuteResult> {
    const { [CACHE_KEY]: cache = {} } = await local.get(CACHE_KEY);
    const hit = cache[key];
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

    if (!(await takePlanQuota())) return { status: 'error', reason: 'daily-limit' };
    const its = await throttled(() => plan(from, dest, arriveIso));
    const best = pickItinerary(its, arriveIso);
    const result: CommuteResult = best ? summarize(best) : { status: 'error', reason: 'no-route' };

    // Prune expired entries while saving.
    const { [CACHE_KEY]: latest = {} } = await local.get(CACHE_KEY);
    const pruned = Object.fromEntries(
      Object.entries(latest as Record<string, { at: number }>).filter(([, v]) => Date.now() - v.at < CACHE_TTL_MS));
    await local.set({ [CACHE_KEY]: { ...pruned, [key]: { at: Date.now(), result } } });
    return result;
  }

  chrome.runtime.onMessage.addListener((msg: BgMessage, _sender, sendResponse) => {
    if (msg?.type === 'commute') {
      const k = JSON.stringify(msg);
      let p = inflight.get(k);
      if (!p) {
        p = commute(msg)
          .catch((): CommuteResult => ({ status: 'error', reason: 'network' }))
          .finally(() => inflight.delete(k));
        inflight.set(k, p);
      }
      p.then(sendResponse);
      return true; // async response
    }
    if (msg?.type === 'geocode') {
      throttled(() => geocode(msg.text, 3, false))
        .then((places) => sendResponse({ ok: true, places }))
        .catch(() => sendResponse({ ok: false, places: [] }));
      return true;
    }
    return false;
  });
}
