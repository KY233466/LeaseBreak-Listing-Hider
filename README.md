# LeaseBreak Listing Hider

A Chrome extension (only active on `https://www.leasebreak.com`) that hides listings you're not interested in from search results.

## How it works

- Listings are tracked by ID
- On search pages, any listing with an ID that's in the hide list is hidden with CSS.
- In the search **map view**, hidden listings are removed from the left column (the pins on the Google map itself can't be hidden). Each item has Hide on its address line and the transit time on its neighborhood line.
- Ways to hide a listing:
  - **Listing page:** Hide sits on the title line, and the commute time on the line below. If the page doesn't have that title block, they float in the bottom-right corner instead.
  - **Search results:** click "✕ Hide" in the top-right corner of a card (or on the address line in the map view).
  - **Popup:** on a listing page, click the extension icon and use Hide for that listing.
- **Saved listings:** listings you saved get a soft yellow background in search results.
- **Commute time:** in the popup's Commute section, find your destination (an address or a place like "Grand Central Terminal"), then set an arrive-by time (default 8:00 AM) and a day (default Tuesday). Each search card and listing page then shows a badge like "🚇 21 min · leave 7:37 AM · J→4": the subway/bus trip that lets you leave latest and still arrive on time.
  - Listing pages use the exact location on the page. Search cards geocode the card's street address and borough, and show "Address not found" rather than guess.
  - The ↗ icon at the right of each badge opens Google Maps in a new tab with transit directions from the listing to your destination, set to **Arrive by** your time and day, so you can double-check. This uses an undocumented Google Maps link format, but if it doesn't work in the future, the link still opens the right route at Google's default time.
  - Cards are looked up only when they scroll into view, and results are cached for 14 days. Lookups are spaced 1.5 s apart and capped at 600 a day.
- The popup lists hidden IDs; click × to unhide one.
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
- `src/content.ts`: content script (Hide buttons, saved highlight, commute badges)
- `src/background.ts`: service worker (Transitous geocoding + routing, cache, rate limit)
- `src/App.tsx`, `src/Commute.tsx`: popup UI
- `public/rules.json`: sets the User-Agent on Transitous requests

The `scripting` permission lets the extension reload its page script into LeaseBreak tabs that are already open after an install or update. Without it, those tabs keep a disconnected copy that ignores changes made in the popup.
