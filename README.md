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
- **Commute time:** in the popup's Commute section, find your destination (an address or a place like "Grand Central Terminal"), then set an arrive-by time (default 8:00 AM) and a day (default Tuesday). Each search card and listing page then shows a badge like "🚇 21 min · leave 7:37 AM · J→4": the subway/bus trip that lets you leave latest and still arrive on time.
  - Listing pages use the exact location on the page. Search cards geocode the card's street address and borough, and show "Address not found" rather than guess.
  - Cards are looked up only when they scroll into view, and results are cached for 14 days. Lookups are spaced 1.5 s apart and capped at 600 a day.
- The popup lists saved and hidden IDs; click "Remove" to take one off a list.
- IDs are saved in `chrome.storage.local`, so they stay on this browser profile.

## Commute data: Transitous

Routing and geocoding come from [Transitous](https://transitous.org), a free, community-run service built on MTA's open transit data. Its [usage policy](https://transitous.org/api/) requires:
- non-commercial use only
- open-source code (this repo is MIT licensed, see `LICENSE`)
- light use: under about 720 route lookups a day, which the daily cap enforces
- attribution, shown in the popup

Requests carry a `User-Agent` naming this project (`public/rules.json`), as Transitous asks.

## Build & install

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `build/` folder.
After making changes, run `npm run build` again and click the reload icon on the extension card.

## Project structure

- `public/manifest.json`: MV3 manifest (content script + popup, `storage` permission, leasebreak.com only)
- `src/content.ts`: content script (hide/save buttons, auto-hide, commute badges)
- `src/background.ts`: service worker (Transitous geocoding + routing, cache, rate limit)
- `src/App.tsx`, `src/Commute.tsx`: popup UI
- `public/rules.json`: sets the User-Agent on Transitous requests
