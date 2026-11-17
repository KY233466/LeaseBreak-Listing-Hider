# LeaseBreak Listing Hider

A Chrome extension (only active on `https://www.leasebreak.com`) that hides listings you're not interested in from search results.

## How it works

- Listings are tracked by ID, e.g. `410557` from `https://www.leasebreak.com/short-term-rental-details/410557/just-posted`.
- On search pages (e.g. `/advanced-search?page=2`), any `<div id="listing{ID}">` for a hidden ID is hidden with CSS.
- Ways to hide a listing:
  - **Listing page:** click the floating "✕ Not interested" button (bottom-right). Click again to undo.
  - **Search results:** click "✕ Hide" in the top-right corner of a card.
  - **Popup:** click the extension icon, then paste an ID or URL, or click "Hide" for the listing you're on.
- **Save:** each card and listing page also has a "☆ Save" button. Saved listings get a soft yellow background in search results. Click again to unsave.
- **Auto-hide "Just a Room":** a toggle in the popup. When on, any search result whose text contains "Just a Room" is hidden and added to the hidden list automatically. Saved listings are skipped, and a listing you remove from the hidden list in the popup won't be auto-hidden again.
- The popup lists saved and hidden IDs; click "Remove" to take one off a list.
- IDs are saved in `chrome.storage.local`, so they stay on this browser profile.

## Build & install

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `build/` folder.
After making changes, run `npm run build` again and click the reload icon on the extension card.

## Project structure

- `public/manifest.json`: MV3 manifest (content script + popup, `storage` permission, leasebreak.com only)
- `src/content.ts`: content script (hides listings, adds the hide buttons)
- `src/App.tsx`: popup UI
