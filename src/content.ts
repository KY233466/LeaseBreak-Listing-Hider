// Content script for https://www.leasebreak.com/*
// - Hides search results whose id is in the hidden list, and highlights saved ones
//   (both via an injected <style>, so it also covers cards rendered later).
// - Adds Save / Hide buttons on listing detail pages and on each search result card.
// - Optionally auto-hides cards mentioning "Just a Room" (adds them to the hidden list).
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

const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function loadLists(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get([HIDDEN_KEY, SAVED_KEY, AUTO_ROOM_KEY, EXCEPTIONS_KEY], (res) => {
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
#lb-hider-detail-actions .lb-hider-btn { font-size: 14px; padding: 10px 16px; }
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
    const detail = !!btn.closest('#lb-hider-detail-actions');
    if (btn.dataset.lbKind === 'save') {
      const on = lists[SAVED_KEY].includes(id);
      btn.classList.toggle('is-on', on);
      setText(btn, on ? '★ Saved' : '☆ Save');
      btn.title = on ? `Unsave listing #${id}` : `Save listing #${id}`;
    } else {
      const on = lists[HIDDEN_KEY].includes(id);
      btn.classList.toggle('is-on', on);
      setText(btn, on ? '✓ Hidden — undo' : detail ? '✕ Not interested' : '✕ Hide');
      btn.title = on ? `Unhide listing #${id}` : `Hide listing #${id}`;
    }
  });
}

function renderDetailButtons(): void {
  const m = location.pathname.match(DETAIL_RE);
  if (!m || document.getElementById('lb-hider-detail-actions')) return;
  const id = m[1];
  const wrap = document.createElement('div');
  wrap.id = 'lb-hider-detail-actions';
  wrap.className = 'lb-hider-actions';
  wrap.append(makeButton('save', id), makeButton('hide', id));
  document.body.appendChild(wrap);
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

function refreshUi(): void {
  applyStyle();
  if (!document.body) return;
  renderDetailButtons();
  decorateCards();
  updateButtons();
  autoHideScan();
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
      requestAnimationFrame(() => {
        pending = false;
        if (!document.getElementById(STYLE_ID)) applyStyle();
        decorateCards();
        updateButtons();
        autoHideScan();
      });
    }).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
}

init();
