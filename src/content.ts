// Content script for https://www.leasebreak.com/*
// - Hides search results whose id is in the hidden list, and highlights saved ones
//   (both via an injected <style>, so it also covers cards rendered later).
// - Adds Save / Hide buttons on listing detail pages and on each search result card.
// - Optionally auto-hides cards mentioning "Just a Room" (adds them to the hidden list).
// - Optionally shows transit commute time (via the background worker / Transitous).
// Must stay self-contained (no imports) so it builds into a single classic script.

const HIDDEN_KEY = 'hiddenListingIds';
const SAVED_KEY = 'savedListingIds';
type ListKey = typeof HIDDEN_KEY | typeof SAVED_KEY;
// Setting: auto-hide "Just a Room" listings. Exceptions = ids the user manually
// unhid, so auto-hide doesn't immediately re-hide them.
const AUTO_ROOM_KEY = 'autoHideJustARoom';
const EXCEPTIONS_KEY = 'autoHideExceptions';
const ROOM_RE = /just a room/i;

const STYLE_ID = 'lb-hider-style';
const DETAIL_RE = /details\/(\d+)/i;
const SAVED_BG = '#fff6c2';

const lists: Record<ListKey, string[]> = { [HIDDEN_KEY]: [], [SAVED_KEY]: [] };
let autoHideRooms = false;
let exceptions: string[] = [];

// Commute settings (must match src/background.ts).
const COMMUTE_ENABLED_KEY = 'commuteEnabled';
const COMMUTE_SETTING_KEYS = [COMMUTE_ENABLED_KEY, 'commuteDest', 'commuteArrival', 'commuteDay'];
let commuteEnabled = false;
let commuteArrival = '08:00';

const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function loadLists(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([HIDDEN_KEY, SAVED_KEY, AUTO_ROOM_KEY, EXCEPTIONS_KEY, ...COMMUTE_SETTING_KEYS], (res) => {
      commuteEnabled = res[COMMUTE_ENABLED_KEY] === true && !!res.commuteDest;
      if (typeof res.commuteArrival === 'string') commuteArrival = res.commuteArrival;
      lists[HIDDEN_KEY] = toIds(res[HIDDEN_KEY]);
      lists[SAVED_KEY] = toIds(res[SAVED_KEY]);
      autoHideRooms = res[AUTO_ROOM_KEY] === true;
      exceptions = toIds(res[EXCEPTIONS_KEY]);
      resolve();
    });
  });
}

function toggleId(key: ListKey, id: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key, EXCEPTIONS_KEY], (res) => {
      const ids = toIds(res[key]);
      const removing = ids.includes(id);
      const update: Record<string, string[]> = {
        [key]: removing ? ids.filter((x) => x !== id) : [...ids, id],
      };
      // Manually unhiding: remember it so auto-hide leaves it alone.
      const exc = toIds(res[EXCEPTIONS_KEY]);
      if (key === HIDDEN_KEY && removing && !exc.includes(id)) update[EXCEPTIONS_KEY] = [...exc, id];
      chrome.storage.local.set(update, () => resolve());
    });
  });
}

const autoHidePending = new Set<string>();

/** If enabled, add every visible "Just a Room" card to the hidden list (one write). */
function autoHideScan(): void {
  if (!autoHideRooms) return;
  const found: string[] = [];
  document.querySelectorAll<HTMLElement>('.search-item[id^="listing"]').forEach((card) => {
    const id = card.id.match(/^listing(\d+)$/)?.[1];
    if (!id || autoHidePending.has(id)) return;
    if (lists[HIDDEN_KEY].includes(id) || lists[SAVED_KEY].includes(id) || exceptions.includes(id)) return;
    if (ROOM_RE.test(card.textContent ?? '')) found.push(id);
  });
  if (!found.length) return;
  found.forEach((id) => autoHidePending.add(id));
  chrome.storage.local.get(HIDDEN_KEY, (res) => {
    const ids = toIds(res[HIDDEN_KEY]);
    const next = [...ids, ...found.filter((id) => !ids.includes(id))];
    chrome.storage.local.set({ [HIDDEN_KEY]: next }, () => found.forEach((id) => autoHidePending.delete(id)));
  });
}

const selectorsFor = (ids: string[]) =>
  ids.filter((id) => /^\d+$/.test(id)).map((id) => `#listing${id}`);

function applyStyle(): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  const hidden = selectorsFor(lists[HIDDEN_KEY]);
  const saved = selectorsFor(lists[SAVED_KEY]);
  style.textContent =
    (hidden.length ? `${hidden.join(',\n')} { display: none !important; }\n` : '') +
    (saved.length ? `${saved.join(',\n')} { background-color: ${SAVED_BG} !important; }\n` : '') +
    `
.lb-hider-actions { display: flex; gap: 6px; }
.lb-hider-card-actions { position: absolute; top: 8px; right: 8px; z-index: 50; }
#lb-hider-detail-actions { position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; }
#lb-hider-detail-actions:not(.is-inline) .lb-hider-btn { font-size: 14px; padding: 10px 16px; }
.lb-title-row { display: flex !important; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
#lb-hider-detail-actions.is-inline { position: static; flex: none; }
.lb-commute.is-inline { margin: 0; flex: none; }
#lb-commute-detail.is-inline { position: static; flex: none; margin: 0; box-shadow: none; font-size: 13px; padding: 4px 10px; }
.lb-hider-btn {
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  border: 1px solid currentColor; background: #fff;
  border-radius: 999px; padding: 6px 10px; cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,.15);
}
.lb-hider-hide { color: #c62828; }
.lb-hider-hide:hover { background: #c62828; color: #fff; border-color: #c62828; }
.lb-hider-save { color: #9a6b00; }
.lb-hider-save:hover { background: #f4c430; color: #3d2a00; border-color: #f4c430; }
.lb-hider-save.is-on { background: #f4c430; color: #3d2a00; border-color: #e0b000; }
.lb-hider-hide.is-on { color: #2e7d32; }
.lb-hider-hide.is-on:hover { background: #2e7d32; color: #fff; border-color: #2e7d32; }
.lb-commute {
  display: inline-flex; align-items: center; gap: 6px; margin: 6px 0 2px; padding: 3px 8px; border-radius: 6px;
  font: 600 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #e8f0fe; color: #174ea6; border: 1px solid #c6d7f5;
}
.lb-maps-link { display: inline-flex; color: inherit !important; opacity: .7; text-decoration: none !important; }
.lb-maps-link:hover { opacity: 1; }
.lb-maps-link svg { width: 14px; height: 14px; }
.lb-commute.is-error { background: #f5f5f5; color: #666; border-color: #ddd; font-weight: 500; }
#lb-commute-detail {
  position: fixed; bottom: 70px; right: 20px; z-index: 2147483647; margin: 0;
  font-size: 14px; padding: 8px 12px; box-shadow: 0 1px 4px rgba(0,0,0,.15);
}
`;
}

function makeButton(kind: 'save' | 'hide', id: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `lb-hider-btn lb-hider-${kind}`;
  btn.dataset.lbId = id;
  btn.dataset.lbKind = kind;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleId(kind === 'save' ? SAVED_KEY : HIDDEN_KEY, id);
  });
  return btn;
}

function setText(el: HTMLElement, text: string): void {
  // Only touch the DOM when needed, so our own MutationObserver doesn't loop.
  if (el.textContent !== text) el.textContent = text;
}

/** Sync every button's label/state with the current lists. */
function updateButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('.lb-hider-btn').forEach((btn) => {
    const id = btn.dataset.lbId!;
    if (btn.dataset.lbKind === 'save') {
      const on = lists[SAVED_KEY].includes(id);
      btn.classList.toggle('is-on', on);
      setText(btn, on ? '★ Saved' : '☆ Save');
      btn.title = on ? `Unsave listing #${id}` : `Save listing #${id}`;
    } else {
      const on = lists[HIDDEN_KEY].includes(id);
      btn.classList.toggle('is-on', on);
      setText(btn, on ? '✓ Hidden — undo' : '✕ Hide');
      btn.title = on ? `Unhide listing #${id}` : `Hide listing #${id}`;
    }
  });
}

/** Listing-page title block */
function detailTitle(): { title: HTMLElement; subtitle: HTMLElement } | null {
  const box = document.querySelector('.title-detail-apartments-col-55');
  const title = box?.querySelector<HTMLElement>('h2');
  const subtitle = box?.querySelector<HTMLElement>('.title-detail-apartments-text');
  return title && subtitle ? { title, subtitle } : null;
}

/** Text of an element ignoring anything we inserted into it. */
const ownText = (el: Element) =>
  Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();

/**
 * Put `el` at the end of `row` (spaced apart from the site's text) when the title block exists;
 * otherwise float it in the corner. Re-run safely: moves it inline if the title appears later.
 */
function placeDetailEl(el: HTMLElement, row: HTMLElement | undefined): void {
  if (row) {
    if (el.parentElement === row) return;
    row.classList.add('lb-title-row');
    el.classList.add('is-inline');
    row.appendChild(el);
  } else if (!el.isConnected) {
    document.body.appendChild(el);
  }
}

function renderDetailButtons(): void {
  const m = location.pathname.match(DETAIL_RE);
  if (!m) return;
  let wrap = document.getElementById('lb-hider-detail-actions');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'lb-hider-detail-actions';
    wrap.className = 'lb-hider-actions';
    wrap.append(makeButton('save', m[1]), makeButton('hide', m[1]));
  }
  placeDetailEl(wrap, detailTitle()?.title);
}

function decorateCards(): void {
  document.querySelectorAll<HTMLElement>('.search-item[id^="listing"]').forEach((card) => {
    const m = card.id.match(/^listing(\d+)$/);
    if (!m || card.querySelector(':scope > .lb-hider-card-actions')) return;
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    const wrap = document.createElement('div');
    wrap.className = 'lb-hider-actions lb-hider-card-actions';
    wrap.append(makeButton('save', m[1]), makeButton('hide', m[1]));
    card.appendChild(wrap);
  });
}

// ---------- commute ----------

interface MapsInfo { origin: string; dest: string; arriveIso: string }
type CommuteResult = (
  | { status: 'ok'; minutes: number; leaveBy: string; arriveAt: string; lines: string[]; transfers: number }
  | { status: 'error'; reason: string }
) & { maps?: MapsInfo };

let commuteGen = 0; // bumps when settings change, so stale responses are dropped

const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso));

function fmtArrival(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Google Maps transit directions with "Arrive by" pre-set. Undocumented `data=` format:
 * 3e3 = transit, 6e1 = arrive by, 8j = arrival as local wall-clock time written as if UTC (seconds).
 * If Google ever ignores `data=`, the link still opens the right origin/destination.
 */
function mapsUrl(m: MapsInfo): string {
  const [, y, mo, d, h, mi] = m.arriveIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)!.map(Number);
  const seconds = Date.UTC(y, mo - 1, d, h, mi) / 1000;
  const part = (p: string) => encodeURIComponent(p).replace(/%2C/g, ',');
  return `https://www.google.com/maps/dir/${part(m.origin)}/${part(m.dest)}/data=!4m6!4m5!2m3!6e1!7e2!8j${seconds}!3e3`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function externalIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/** Badge = <span class="lb-commute-text"> + optional Google Maps link. */
function badgeParts(badge: HTMLElement): { text: HTMLElement; link: HTMLAnchorElement } {
  let text = badge.querySelector<HTMLElement>(':scope > .lb-commute-text');
  let link = badge.querySelector<HTMLAnchorElement>(':scope > .lb-maps-link');
  if (!text || !link) {
    badge.textContent = '';
    text = document.createElement('span');
    text.className = 'lb-commute-text';
    link = document.createElement('a');
    link.className = 'lb-maps-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.hidden = true;
    link.append(externalIcon());
    // Don't let LeaseBreak's card click handlers react to this click.
    link.addEventListener('click', (e) => e.stopPropagation());
    badge.append(text, link);
  }
  return { text, link };
}

function renderCommute(badge: HTMLElement, r: CommuteResult): void {
  badge.classList.toggle('is-error', r.status !== 'ok');
  const { text, link } = badgeParts(badge);
  if (r.maps) {
    const href = mapsUrl(r.maps);
    if (link.href !== href) link.href = href;
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
      .format(new Date(`${r.maps.arriveIso.slice(0, 10)}T12:00:00Z`));
    link.title = `Check in Google Maps (arrive by ${fmtArrival(commuteArrival)} ${day})`;
    link.setAttribute('aria-label', link.title);
  }
  link.hidden = !r.maps;
  if (r.status === 'ok') {
    const lines = r.lines.length ? ` · ${r.lines.join('→')}` : '';
    setText(text, `🚇 ${r.minutes} min · leave ${fmtTime(r.leaveBy)}${lines}`);
    badge.title = `Leave ${fmtTime(r.leaveBy)}, arrive ${fmtTime(r.arriveAt)} ` +
      `(${r.transfers} transfer${r.transfers === 1 ? '' : 's'}). Routing: Transitous`;
    return;
  }
  const msg: Record<string, string> = {
    'no-route': `🚇 No transit route by ${fmtArrival(commuteArrival)}`,
    'address-not-found': '🚇 Address not found',
    'daily-limit': '🚇 Daily commute lookup limit reached',
    network: '🚇 Commute lookup failed',
  };
  setText(text, msg[r.reason] ?? '');
  badge.hidden = !(r.reason in msg);
}

function requestCommute(badge: HTMLElement, msg: Record<string, unknown>): void {
  if (badge.dataset.lbRequested) return;
  badge.dataset.lbRequested = '1';
  const gen = commuteGen;
  const { text, link } = badgeParts(badge);
  link.hidden = true;
  setText(text, '🚇 …');
  chrome.runtime.sendMessage({ type: 'commute', ...msg })
    .then((r: CommuteResult) => { if (gen === commuteGen && badge.isConnected) renderCommute(badge, r); })
    .catch(() => { badge.hidden = true; }); // e.g. extension reloaded
}

// Only look up cards that actually scroll into view (saves API quota; hidden cards never intersect).
const cardObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const badge = e.target as HTMLElement;
    cardObserver.unobserve(badge);
    const card = badge.closest<HTMLElement>('.search-item');
    if (!card) continue;
    // "Lower East Side, Manhattan" -> use only the borough; neighborhood names confuse the geocoder.
    const street = card.querySelector('h3')?.textContent?.trim();
    const areaEl = card.querySelector('.search-item-header-col .text');
    const borough = areaEl ? ownText(areaEl).split(',').pop()?.trim() : undefined; // ignore our badge's text
    requestCommute(badge, {
      listingId: badge.dataset.lbId,
      address: street ? [street, borough].filter(Boolean).join(', ') : undefined,
    });
  }
}, { rootMargin: '200px' });

function decorateCommuteCards(): void {
  if (!commuteEnabled) return;
  document.querySelectorAll<HTMLElement>('.search-item[id^="listing"]').forEach((card) => {
    const id = card.id.match(/^listing(\d+)$/)?.[1];
    if (!id || card.querySelector('.lb-commute')) return;
    const badge = document.createElement('div');
    badge.className = 'lb-commute';
    badge.dataset.lbId = id;
    // Same line as "Chelsea / Hudson Yards, Manhattan", pushed to the right.
    const area = card.querySelector<HTMLElement>('.search-item-header-col .header .text');
    const header = card.querySelector('.search-item-header-col .header');
    if (area) {
      area.classList.add('lb-title-row');
      badge.classList.add('is-inline');
      area.appendChild(badge);
    } else if (header) header.after(badge);
    else (card.querySelector('.search-item-header-col') ?? card).appendChild(badge);
    cardObserver.observe(badge);
  });
}

function detailCoords(): { lat: number; lon: number } | undefined {
  for (const s of Array.from(document.scripts)) {
    const t = s.textContent ?? '';
    const lat = t.match(/\blat\s*=\s*['"](-?\d+\.\d+)/)?.[1];
    const lng = t.match(/\blng\s*=\s*['"](-?\d+\.\d+)/)?.[1];
    if (lat && lng) return { lat: Number(lat), lon: Number(lng) };
  }
  return undefined;
}

function renderDetailCommute(): void {
  const id = location.pathname.match(DETAIL_RE)?.[1];
  if (!id || !commuteEnabled) return;
  const t = detailTitle();
  let badge = document.getElementById('lb-commute-detail');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'lb-commute-detail';
    badge.className = 'lb-commute';
  }
  placeDetailEl(badge, t?.subtitle);
  // Fallback address if the page has no coordinates.
  const street = t ? ownText(t.title) : document.querySelector('h1')?.textContent?.trim();
  const borough = t ? ownText(t.subtitle).split(',').pop()?.trim() : undefined;
  requestCommute(badge, {
    listingId: id,
    coords: detailCoords(),
    address: street ? [street, borough].filter(Boolean).join(', ') : undefined,
  });
}

function resetCommute(): void {
  commuteGen++;
  document.querySelectorAll('.lb-commute').forEach((b) => { cardObserver.unobserve(b); b.remove(); });
}

function refreshUi(): void {
  applyStyle();
  if (!document.body) return;
  renderDetailButtons();
  decorateCards();
  updateButtons();
  autoHideScan();
  decorateCommuteCards();
  renderDetailCommute();
}

async function init(): Promise<void> {
  await loadLists();
  applyStyle();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    if (AUTO_ROOM_KEY in changes) {
      autoHideRooms = changes[AUTO_ROOM_KEY].newValue === true;
      changed = true;
    }
    if (EXCEPTIONS_KEY in changes) exceptions = toIds(changes[EXCEPTIONS_KEY].newValue);
    if (COMMUTE_SETTING_KEYS.some((k) => k in changes)) {
      chrome.storage.local.get(COMMUTE_SETTING_KEYS, (res) => {
        commuteEnabled = res[COMMUTE_ENABLED_KEY] === true && !!res.commuteDest;
        if (typeof res.commuteArrival === 'string') commuteArrival = res.commuteArrival;
        resetCommute();
        refreshUi();
      });
    }
    for (const key of [HIDDEN_KEY, SAVED_KEY] as const) {
      if (key in changes) {
        lists[key] = toIds(changes[key].newValue);
        changed = true;
      }
    }
    if (changed) refreshUi();
  });

  const onReady = () => {
    refreshUi();
    // Search results may be loaded/replaced dynamically.
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      // setTimeout, not requestAnimationFrame: rAF is paused in background tabs.
      setTimeout(() => {
        pending = false;
        if (!document.getElementById(STYLE_ID)) applyStyle();
        decorateCards();
        updateButtons();
        autoHideScan();
        decorateCommuteCards();
        renderDetailButtons(); // no-ops once placed; moves them inline if the title renders late
        renderDetailCommute();
        updateButtons();
      }, 50);
    }).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
}

init();
