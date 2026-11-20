// Content script for https://www.leasebreak.com/*
// - Highlights search cards the user saved with LeaseBreak's own Save button.
// - Adds "Hide listing" / "Hide lister" on listing pages, sending LeaseBreak's own hide request
//   (the site only offers it on search cards). The lister id it needs is picked up from search cards.
// - Highlights the user's keywords inside a listing's Features & Property Details section.
// - Optionally shows transit commute time (via the background worker / Transitous) on search
//   cards, map-view items and listing pages.
// Must stay self-contained (no imports) so it builds into a single classic script.

const STYLE_ID = 'lb-commute-style';
const DETAIL_RE = /details\/(\d+)/i;
const SAVED_BG = '#fff6c2';

// Commute settings (must match src/background.ts).
const COMMUTE_ENABLED_KEY = 'commuteEnabled';
const COMMUTE_SETTING_KEYS = [COMMUTE_ENABLED_KEY, 'commuteDest', 'commuteArrival', 'commuteDay'];
let commuteEnabled = false;
let commuteArrival = '08:00';

// Listing id -> lister (user) id, collected from LeaseBreak's own Hide links on search cards.
const LISTERS_KEY = 'listerByListing';
const MAX_LISTERS = 3000;
let listers: Record<string, string> = {};
// Popup setting: close the listing tab right after hiding it from the listing page.
const CLOSE_TAB_KEY = 'closeTabAfterHide';
let closeTabAfterHide = false;
// Keyword highlighter (set in the popup, src/Highlight.tsx).
const HL_ENABLED_KEY = 'highlightEnabled';
const HL_KEYWORDS_KEY = 'highlightKeywords';
interface HlKeyword { text: string; color: string; on: boolean }
let hlEnabled = true;
let hlKeywords: HlKeyword[] = [];

function readSettings(res: Record<string, unknown>): void {
  commuteEnabled = res[COMMUTE_ENABLED_KEY] === true && !!res.commuteDest;
  if (typeof res.commuteArrival === 'string') commuteArrival = res.commuteArrival;
}

function loadSettings(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([...COMMUTE_SETTING_KEYS, LISTERS_KEY, CLOSE_TAB_KEY, HL_ENABLED_KEY, HL_KEYWORDS_KEY], (res) => {
      readSettings(res);
      if (res[LISTERS_KEY] && typeof res[LISTERS_KEY] === 'object') listers = res[LISTERS_KEY];
      closeTabAfterHide = res[CLOSE_TAB_KEY] === true;
      readHighlightSettings(res);
      resolve();
    });
  });
}

function applyStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
/* Listings saved with LeaseBreak's own Save button. */
.search-item.lb-site-saved { background-color: ${SAVED_BG} !important; }
.lb-title-row { display: flex !important; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.lb-commute {
  display: inline-flex; align-items: center; gap: 6px; margin: 6px 0 2px; padding: 3px 8px; border-radius: 6px;
  font: 600 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #e8f0fe; color: #174ea6; border: 1px solid #c6d7f5;
}
.lb-commute.is-inline { margin: 0; flex: none; }
.map-listing-info-borough.lb-title-row .lb-commute { font-size: 11px; padding: 2px 6px; }
.lb-maps-link { display: inline-flex; color: inherit !important; opacity: .7; text-decoration: none !important; }
.lb-maps-link:hover { opacity: 1; }
.lb-maps-link svg { width: 14px; height: 14px; }
.lb-commute.is-error { background: #f5f5f5; color: #666; border-color: #ddd; font-weight: 500; }
#lb-commute-detail {
  position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; margin: 0;
  font-size: 14px; padding: 8px 12px; box-shadow: 0 1px 4px rgba(0,0,0,.15);
}
#lb-commute-detail.is-inline { position: static; z-index: auto; flex: none; margin: 0; box-shadow: none; font-size: 13px; padding: 4px 10px; }
#lb-hide-detail { display: flex; gap: 6px; position: fixed; bottom: 64px; right: 20px; z-index: 2147483647; }
#lb-hide-detail.is-inline { position: static; z-index: auto; flex: none; }
.lb-site-hide-btn {
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #c62828; background: #fff; border: 1px solid currentColor; border-radius: 999px;
  padding: 6px 10px; cursor: pointer; white-space: nowrap;
}
.lb-site-hide-btn:hover:not(:disabled) { background: #c62828; color: #fff; border-color: #c62828; }
.lb-site-hide-btn.is-confirm { background: #c62828; color: #fff; border-color: #c62828; }
.lb-site-hide-btn.is-done { color: #2e7d32; cursor: default; }
.lb-site-hide-btn.is-error { color: #666; border-color: #bbb; }
.lb-site-hide-btn:disabled:not(.is-done) { opacity: .6; cursor: default; }
#lb-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647;
  display: flex; flex-direction: column; gap: 2px; padding: 10px 16px; border-radius: 10px;
  background: #1f2328; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.25);
  font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; transition: opacity .3s;
}
#lb-toast span { color: #c9d1d9; font-size: 12px; }
#lb-toast.is-out { opacity: 0; }
.lb-hl { color: inherit; padding: 0 2px; border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.lb-hl[data-lb-color="yellow"] { background: #fff1a8; }
.lb-hl[data-lb-color="green"] { background: #c9f2cf; }
.lb-hl[data-lb-color="red"] { background: #ffd3d3; }
.lb-hl[data-lb-color="blue"] { background: #d4e5ff; }
.lb-hl[data-lb-color="purple"] { background: #e6d8ff; }
.lb-hl[data-lb-color="orange"] { background: #ffdcb3; }
.lb-hide-note {
  font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #6b7280;
  border: 1px dashed #cbd0d6; border-radius: 999px; padding: 4px 10px; cursor: help; white-space: nowrap;
}
`;
  (document.head || document.documentElement).appendChild(style);
}

function setText(el: HTMLElement, text: string): void {
  // Only touch the DOM when needed, so our own MutationObserver doesn't loop.
  if (el.textContent !== text) el.textContent = text;
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

/**
 * Mark search cards that the user saved with LeaseBreak's own Save button. Checked per card
 * in JS (not a CSS :has rule) because the site's markup can't be relied on: only a *visible*
 * button reading "Saved" inside the card itself counts, not a hidden one or one in a nested card.
 */
function markSiteSaved(): void {
  document.querySelectorAll<HTMLElement>('.search-item[id^="listing"]').forEach((card) => {
    const saved = Array.from(card.querySelectorAll<HTMLElement>('.search-item-save-block button')).some((b) =>
      b.closest('.search-item[id^="listing"]') === card &&
      b.textContent?.trim().toLowerCase() === 'saved' &&
      getComputedStyle(b).display !== 'none' && getComputedStyle(b).visibility !== 'hidden' &&
      !b.closest('[style*="display: none"], [style*="display:none"]'));
    if (card.classList.contains('lb-site-saved') !== saved) card.classList.toggle('lb-site-saved', saved);
  });
}

// ---------- LeaseBreak's own "hide from search", on listing pages ----------

/** Remember listing -> lister ids from the site's Hide links on search cards. */
function rememberListers(): void {
  const found: Record<string, string> = {};
  document.querySelectorAll<HTMLElement>('.js-hide-from-search[data-listingid][data-userid]').forEach((a) => {
    const lid = a.dataset.listingid!, uid = a.dataset.userid!;
    if (/^\d+$/.test(lid) && /^\d+$/.test(uid) && listers[lid] !== uid) found[lid] = uid;
  });
  if (!Object.keys(found).length) return;
  Object.assign(listers, found);
  chrome.storage.local.get(LISTERS_KEY, (res) => {
    const all: Record<string, string> = { ...(res[LISTERS_KEY] ?? {}) };
    for (const [lid, uid] of Object.entries(found)) { delete all[lid]; all[lid] = uid; } // newest last
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_LISTERS))) delete all[k];
    chrome.storage.local.set({ [LISTERS_KEY]: all });
  });
}

type HideType = 'listing' | 'user';

async function siteHide(uid: string, lid: string, type: HideType): Promise<boolean> {
  try {
    const res = await fetch('/leaseBreak/default/hideFromSearch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ uid, lid, type }).toString(),
    });
    if (!res.ok) return false;
    const text = await res.text();
    try { return (JSON.parse(text) as { success?: unknown })?.success !== false; } catch { return true; }
  } catch {
    return false;
  }
}

function makeHideButton(uid: string, lid: string, type: HideType): HTMLButtonElement {
  const label = type === 'listing' ? '✕ Hide listing' : '✕ Hide lister';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lb-site-hide-btn';
  btn.textContent = label;
  btn.title = type === 'listing'
    ? 'Hide this listing from your LeaseBreak search results'
    : 'Hide every listing from this lister in your LeaseBreak search results';
  let confirmTimer: number | undefined;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (type === 'user' && !btn.classList.contains('is-confirm')) {
      // Hiding a lister hides all their listings: ask once, inline.
      btn.classList.add('is-confirm');
      btn.textContent = 'Hide all their listings?';
      confirmTimer = window.setTimeout(() => { btn.classList.remove('is-confirm'); btn.textContent = label; }, 4000);
      return;
    }
    clearTimeout(confirmTimer);
    btn.classList.remove('is-confirm', 'is-error');
    btn.disabled = true;
    btn.textContent = 'Hiding…';
    if (await siteHide(uid, lid, type)) {
      btn.classList.add('is-done');
      btn.textContent = type === 'listing' ? '✓ Listing hidden' : '✓ Lister hidden';
      btn.title = 'Hidden. Undo anytime at the top of your LeaseBreak search results.';
      if (closeTabAfterHide) {
        btn.textContent += ' · closing tab…';
        // Short pause so you see it worked; the background worker closes only this tab.
        setTimeout(() => { chrome.runtime.sendMessage({ type: 'closeTab' }).catch(() => {}); }, 700);
      }
    } else {
      btn.disabled = false;
      btn.classList.add('is-error');
      btn.textContent = "Couldn't hide. Signed in?";
    }
  });
  return btn;
}

/**
 * "Hide listing" / "Hide lister" on the address line of a listing page. Without the lister's id
 * (listing never seen in search results) show a note instead; it turns into the buttons as soon
 * as the id is learned, e.g. from a search tab open next to this one.
 */
function renderDetailHide(): void {
  const lid = location.pathname.match(DETAIL_RE)?.[1];
  if (!lid) return;
  const uid = listers[lid];
  const state = uid ? 'buttons' : 'note';
  let wrap = document.getElementById('lb-hide-detail');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'lb-hide-detail';
  }
  if (wrap.dataset.state !== state) {
    wrap.dataset.state = state;
    wrap.textContent = '';
    if (uid) {
      wrap.append(makeHideButton(uid, lid, 'listing'), makeHideButton(uid, lid, 'user'));
    } else {
      const note = document.createElement('span');
      note.className = 'lb-hide-note';
      note.textContent = 'Hide unavailable: open this listing from search results first';
      note.title = "LeaseBreak's hide needs the lister's ID, which this page doesn't include. " +
        'The extension picks it up when you browse search results.';
      wrap.append(note);
    }
  }
  placeDetailEl(wrap, detailTitle()?.title);
}

// ---------- the site's own Hide links on search cards, without its page reload ----------

// LeaseBreak's "Hide this Listing / Lister" reloads the search page, which jumps back to page 1
// and the top. We send the same request ourselves (so it still lands in LeaseBreak's own hidden
// list) and just hide the card(s) in place.

const CARD_SEL = '.search-item[id^="listing"], .map-listing';
const busyLinks = new WeakSet<HTMLElement>();

function showToast(title: string, detail: string): void {
  document.getElementById('lb-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'lb-toast';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('span');
  small.textContent = detail;
  toast.append(strong, small);
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('is-out'), 4000);
  setTimeout(() => toast.remove(), 4400);
}

function collapse(card: HTMLElement): void {
  card.style.transition = 'opacity .2s ease';
  card.style.opacity = '0';
  setTimeout(() => card.style.setProperty('display', 'none', 'important'), 200);
}

async function onSiteHideClick(e: Event): Promise<void> {
  const link = (e.target as Element | null)?.closest?.<HTMLElement>('.js-hide-from-search');
  const uid = link?.dataset.userid, lid = link?.dataset.listingid;
  if (!link || !uid || !lid) return;
  // Stop the site's own handler (and its reload) from running.
  e.preventDefault();
  e.stopImmediatePropagation();
  if (busyLinks.has(link)) return;
  const type: HideType = link.dataset.type === 'user' ? 'user' : 'listing';
  if (!link.dataset.lbLabel) link.dataset.lbLabel = link.textContent ?? '';
  const label = link.dataset.lbLabel;

  if (type === 'user' && link.dataset.lbConfirm !== '1') {
    link.dataset.lbConfirm = '1';
    link.textContent = 'Click again to hide all their listings';
    setTimeout(() => {
      if (link.dataset.lbConfirm === '1' && !busyLinks.has(link)) { delete link.dataset.lbConfirm; link.textContent = label; }
    }, 4000);
    return;
  }
  delete link.dataset.lbConfirm;
  busyLinks.add(link);
  link.textContent = 'Hiding…';
  const ok = await siteHide(uid, lid, type);
  busyLinks.delete(link);
  if (!ok) {
    link.textContent = "Couldn't hide. Signed in?";
    return;
  }
  link.textContent = label;
  const cards = new Set<HTMLElement>();
  const own = link.closest<HTMLElement>(CARD_SEL);
  if (own) cards.add(own);
  if (type === 'user') {
    document.querySelectorAll<HTMLElement>(`.js-hide-from-search[data-userid="${CSS.escape(uid)}"]`).forEach((l) => {
      const c = l.closest<HTMLElement>(CARD_SEL);
      if (c) cards.add(c);
    });
  }
  cards.forEach(collapse);
  showToast(
    type === 'user' ? `Lister hidden (${cards.size} listing${cards.size === 1 ? '' : 's'})` : 'Listing hidden',
    'Undo anytime at the top of your search results (after the next page load).',
  );
}

// ---------- keyword highlighter (listing page, Features & Property Details only) ----------

const HL_COLORS = ['yellow', 'green', 'red', 'blue', 'purple', 'orange'];

function readHighlightSettings(res: Record<string, unknown>): void {
  hlEnabled = res[HL_ENABLED_KEY] !== false;
  const list = Array.isArray(res[HL_KEYWORDS_KEY]) ? (res[HL_KEYWORDS_KEY] as HlKeyword[]) : [];
  hlKeywords = list.filter((k) => k && typeof k.text === 'string' && k.text.trim() && k.on);
}

/** Regex source for one keyword: spaces match any whitespace, "-" and "/" are optional separators. */
function keywordPattern(text: string): string {
  return text.trim().toLowerCase().split(/[\s\-/]+/).filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\-/]*');
}

function unwrapHighlights(root: ParentNode): void {
  const parents = new Set<Node>();
  root.querySelectorAll('mark.lb-hl').forEach((m) => {
    if (m.parentNode) parents.add(m.parentNode);
    m.replaceWith(document.createTextNode(m.textContent ?? ''));
  });
  parents.forEach((p) => p.normalize());
}

function applyHighlights(): void {
  const box = location.pathname.match(DETAIL_RE) ? document.querySelector<HTMLElement>('.features-content') : null;
  if (!box) return;
  const active = hlEnabled ? hlKeywords : [];
  const signature = JSON.stringify(active.map((k) => [k.text.toLowerCase(), k.color]));
  if (box.dataset.lbHl === signature) return;
  unwrapHighlights(box);
  box.dataset.lbHl = signature;
  if (!active.length) return;

  // Longest first, so "Utilities included" wins over "Utilities".
  const byPattern = new Map<string, HlKeyword>();
  [...active].sort((a, b) => b.text.length - a.text.length).forEach((k) => {
    const p = keywordPattern(k.text);
    if (p && !byPattern.has(p)) byPattern.set(p, k);
  });
  const patterns = [...byPattern.keys()];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${patterns.map((p) => `(${p})`).join('|')})(?![\\p{L}\\p{N}])`, 'giu');

  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('script, style, mark.lb-hl, textarea, .building-address') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let last = 0;
    const frag = document.createDocumentFragment();
    while ((m = re.exec(text))) {
      const kw = byPattern.get(patterns[m.slice(1).findIndex((g) => g !== undefined)])!;
      if (m.index > last) frag.append(text.slice(last, m.index));
      const mark = document.createElement('mark');
      mark.className = 'lb-hl';
      mark.dataset.lbColor = HL_COLORS.includes(kw.color) ? kw.color : 'yellow';
      mark.title = `Keyword: ${kw.text}`;
      mark.textContent = m[0];
      frag.append(mark);
      last = m.index + m[0].length;
    }
    if (last === 0) continue;
    if (last < text.length) frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

// ---------- map view (left column next to the Google map) ----------

const mapListingId = (item: Element) =>
  item.querySelector<HTMLAnchorElement>('.map-listing-info-address a')?.getAttribute('href')?.match(DETAIL_RE)?.[1];

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

// Only look up cards that actually scroll into view (saves API quota).
const cardObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const badge = e.target as HTMLElement;
    cardObserver.unobserve(badge);
    const mapItem = badge.closest<HTMLElement>('.map-listing');
    if (mapItem) {
      const link = mapItem.querySelector<HTMLElement>('.js-view-on-map, [data-lat][data-lng]');
      const lat = Number(link?.dataset.lat), lon = Number(link?.dataset.lng);
      const street = mapItem.querySelector('.map-listing-info-address a')?.textContent?.trim();
      const boroughEl = mapItem.querySelector('.map-listing-info-borough');
      const borough = boroughEl ? ownText(boroughEl).split(',').pop()?.trim() : undefined;
      requestCommute(badge, {
        listingId: badge.dataset.lbId,
        coords: Number.isFinite(lat) && Number.isFinite(lon) && lat && lon ? { lat, lon } : undefined,
        address: street ? [street, borough].filter(Boolean).join(', ') : undefined,
      });
      continue;
    }
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
  // Map view: badge on the "Greenpoint, Brooklyn" line, pushed right.
  document.querySelectorAll<HTMLElement>('.map-listing').forEach((item) => {
    const id = mapListingId(item);
    const row = item.querySelector<HTMLElement>('.map-listing-info-borough');
    if (!id || !row) return;
    const old = row.querySelector<HTMLElement>(':scope > .lb-commute');
    if (old?.dataset.lbId === id) return;
    if (old) { cardObserver.unobserve(old); old.remove(); }
    const badge = document.createElement('div');
    badge.className = 'lb-commute is-inline';
    badge.dataset.lbId = id;
    row.classList.add('lb-title-row');
    row.appendChild(badge);
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
  applyHighlights();
  markSiteSaved();
  rememberListers();
  renderDetailHide();
  decorateCommuteCards();
  renderDetailCommute();
}

/** False once the extension is reloaded/updated: this copy of the script is cut off from it. */
const extensionAlive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

/** Remove buttons/badges left behind by a previous (now disconnected) copy of this script. */
function removeLeftovers(): void {
  // Includes the Hide/Save buttons and style of older versions of this extension.
  document.querySelectorAll('#lb-toast, #lb-hide-detail, #lb-hider-style, #lb-hider-detail-actions, .lb-hider-card-actions, .lb-hider-map-actions, #lb-commute-detail, .lb-commute')
    .forEach((el) => el.remove());
  unwrapHighlights(document);
}

async function init(): Promise<void> {
  // Re-injected after an extension reload while a live copy is still running (rare race): do nothing.
  const w = window as unknown as { __lbCommuteAlive?: () => boolean };
  if (w.__lbCommuteAlive?.()) return;
  w.__lbCommuteAlive = extensionAlive;

  await loadSettings();
  applyStyle();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (CLOSE_TAB_KEY in changes) closeTabAfterHide = changes[CLOSE_TAB_KEY].newValue === true;
    if (HL_ENABLED_KEY in changes || HL_KEYWORDS_KEY in changes) {
      chrome.storage.local.get([HL_ENABLED_KEY, HL_KEYWORDS_KEY], (res) => {
        readHighlightSettings(res);
        if (document.body) applyHighlights();
      });
    }
    if (LISTERS_KEY in changes) {
      // e.g. a search tab next to this listing tab just learned this listing's lister.
      const v = changes[LISTERS_KEY].newValue;
      if (v && typeof v === 'object') listers = v;
      if (document.body) renderDetailHide();
    }
    if (!COMMUTE_SETTING_KEYS.some((k) => k in changes)) return;
    chrome.storage.local.get(COMMUTE_SETTING_KEYS, (res) => {
      readSettings(res);
      resetCommute();
      refreshUi();
    });
  });

  // Capture phase on window: runs before the site's own click handlers.
  window.addEventListener('click', (e) => { void onSiteHideClick(e); }, true);
  try { sessionStorage.removeItem('lbCommuteScrollRestore'); } catch { /* left by an older version */ }

  const onReady = () => {
    removeLeftovers();
    refreshUi();
    // Search results may be loaded/replaced dynamically.
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      if (!extensionAlive()) { observer.disconnect(); return; } // extension reloaded: stop, the new copy takes over
      pending = true;
      // setTimeout, not requestAnimationFrame: rAF is paused in background tabs.
      setTimeout(() => {
        pending = false;
        applyStyle(); // no-op unless the page removed our style
        markSiteSaved();
        rememberListers();
        renderDetailHide(); // moves the buttons inline if the title renders late
        decorateCommuteCards();
        renderDetailCommute(); // moves the badge inline if the title renders late
        applyHighlights(); // no-op unless the details section or the keywords changed
      }, 50);
    });
    // Also watch text/class/style changes: clicking the site's Save may just relabel the button.
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'style', 'disabled'],
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
}

init();
