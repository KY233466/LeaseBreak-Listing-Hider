# LeaseBreak Commute

A Chrome extension (only active on `https://www.leasebreak.com`) that shows public-transit commute times on NYC rental listings, and highlights listings you saved on LeaseBreak.

LeaseBreak already lets you save listings and hide listings or listers, so this extension doesn't duplicate those features.

## How it works

- **Commute time:** in the popup, find your destination (an address or a place like "Grand Central Terminal"), then set an arrive-by time (default 8:00 AM) and a day (default Tuesday). Listings then show a badge like "🚇 21 min · leave 7:37 AM · J→4": the subway/bus trip that lets you leave latest and still arrive on time.
  - **Search results:** on the neighborhood line of each card ("Chelsea / Hudson Yards, Manhattan"), pushed right.
  - **Map view:** on the neighborhood line of each item in the left column.
  - **Listing page:** on the neighborhood line under the address. If the page doesn't have that title block, it floats in the bottom-right corner instead.
  - Listing pages and map items use the listing's exact location. Search cards geocode the card's street address and borough, and show "Address not found" rather than guess.
  - The ↗ icon at the right of each badge opens Google Maps in a new tab with transit directions from the listing to your destination, set to **Arrive by** your time and day, so you can double-check. This uses an undocumented Google Maps link format, but if it doesn't work in the future, the link still opens the right route at Google's default time.
  - Cards are looked up only when they scroll into view, and results are cached for 14 days. Lookups are spaced 1.5 s apart and capped at 600 a day.
- **Hide from a listing page:** LeaseBreak only offers "Hide this Listing / Lister" on search cards. The extension adds **Hide listing** and **Hide lister** on the listing page's address line, sending the site's own hide request (`/leaseBreak/default/hideFromSearch`) with your LeaseBreak login. That request needs the lister's ID, which the page doesn't include, so the extension picks it up from LeaseBreak's Hide links on search results: the buttons appear for listings you've seen in search. Hide lister asks for a second click first. Turn on **Close the tab after hiding** in the popup to have the listing's tab close itself right after a successful hide from that page. On a listing you haven't seen in search yet, a small note on the address line explains why Hide isn't available, and the popup shows the same status for the current tab. Hiding a listing or lister can be undone at any time at the top of LeaseBreak's search results.
- **Hide without losing your place:** LeaseBreak's own "Hide this Listing / Lister" on search cards reloads the page, which sends you back to page 1 and the top. The extension takes over those links: it sends the same hide request (so it's still saved in LeaseBreak's own hidden list) and removes the card in place, so you stay on the same page and scroll position. Hide this Lister asks for a second click first and removes all of that lister's cards. The site's hidden list at the top shows the change on the next page load.
- **Keyword highlighter:** in the popup, turn on common keywords (Kitchenette, Walk-up, Rent stabilized, Utilities included, Dishwasher, …) or add your own, separated by commas. Each keyword gets a color (yellow, green, red, blue, purple, orange; click its dot to change it). Matches are highlighted only inside a listing's Features & Property Details section, skipping the building-address line at the bottom. Matching ignores case, only matches whole words ("AC" won't match "back"), and treats spaces, hyphens and slashes alike ("Walk-up" also finds "walk up" and "walkup").
- **Saved listings:** listings you saved with LeaseBreak's own Save button get a soft yellow background in search results.
- Settings and the cache are stored in `chrome.storage.local`, so they stay on this browser profile.

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
- `src/content.ts`: content script (saved highlight, commute badges)
- `src/background.ts`: service worker (Transitous geocoding + routing, cache, rate limit)
- `src/App.tsx`, `src/Commute.tsx`: popup UI
- `public/rules.json`: sets the User-Agent on Transitous requests

The `scripting` permission lets the extension reload its page script into LeaseBreak tabs that are already open after an install or update. Without it, those tabs keep a disconnected copy that ignores changes made in the popup.
