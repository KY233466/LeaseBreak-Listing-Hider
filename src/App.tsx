import { useEffect, useState } from 'react'
import './App.css'
import { CommuteSettings } from './Commute'
import { HighlightSettings } from './Highlight'

const LISTERS_KEY = 'listerByListing'
const CLOSE_TAB_KEY = 'closeTabAfterHide'
const DETAIL_RE = /details\/(\d+)/i

function Logo() {
  return (
    <span className="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
      </svg>
    </span>
  )
}

type HideStatus = 'ok' | 'warn' | 'tip'

/** Whether the listing-page Hide buttons work on the active tab. */
function useHideStatus(): HideStatus {
  const [listingId, setListingId] = useState<string | null>(null)
  const [listers, setListers] = useState<Record<string, string>>({})

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const url = tab?.url ?? ''
      if (url.startsWith('https://www.leasebreak.com/')) {
        setListingId(new URL(url).pathname.match(DETAIL_RE)?.[1] ?? null)
      }
    })
    chrome.storage.local.get(LISTERS_KEY, (res) => setListers(res[LISTERS_KEY] ?? {}))
    const onChange = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && LISTERS_KEY in changes) setListers(changes[LISTERS_KEY].newValue ?? {})
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [])

  if (!listingId) return 'tip'
  return listers[listingId] ? 'ok' : 'warn'
}

function HideCard() {
  const status = useHideStatus()
  const [closeTab, setCloseTab] = useState(false)
  useEffect(() => {
    chrome.storage.local.get(CLOSE_TAB_KEY, (res) => setCloseTab(res[CLOSE_TAB_KEY] === true))
  }, [])
  return (
    <section className="card">
      <h2>🙈 Hide button on Listing's page</h2>
      <p className="body">
        Hiding a Listing or Lister can easily be undone at any time at the top of your search results.
      </p>
      {status === 'ok' && <p className="status is-ok">✓ Hide is available on this listing.</p>}
      {status === 'warn' && (
        <p className="status is-warn">
          ⚠ Hide isn't available here yet. Open this listing from LeaseBreak search results (with the extension on),
          then reload it.
        </p>
      )}
      {status === 'tip' && (
        <p className="status is-tip">
          Tip: browse search results first. That's how the extension learns which lister posted each listing.
        </p>
      )}
      <label className="toggle-row">
        <span>
          Close the tab after hiding from a Listing's page
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={closeTab}
          aria-label="Close the tab after hiding from a listing page"
          onChange={(e) => { setCloseTab(e.target.checked); chrome.storage.local.set({ [CLOSE_TAB_KEY]: e.target.checked }) }}
        />
      </label>
    </section>
  )
}

function App() {
  return (
    <main>
      <header className="app-header">
        <Logo />
        <h1>LeaseBreak Commute</h1>
      </header>
      <CommuteSettings />
      <HideCard />
      <HighlightSettings />
    </main>
  )
}

export default App
