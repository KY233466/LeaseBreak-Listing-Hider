import { useEffect, useState } from 'react'
import './App.css'
import { CommuteSettings } from './Commute'

const HIDDEN_KEY = 'hiddenListingIds'
const SAVED_KEY = 'savedListingIds'
type ListKey = typeof HIDDEN_KEY | typeof SAVED_KEY
type Tab = 'saved' | 'hidden'

const DETAIL_RE = /details\/(\d+)/i
const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
const listingUrl = (id: string) => `https://www.leasebreak.com/short-term-rental-details/${id}/`

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

function IdList({ ids, onRemove, empty }: { ids: string[]; onRemove: (id: string) => void; empty: string }) {
  if (ids.length === 0) return <p className="empty">{empty}</p>
  return (
    <ul className="id-list">
      {[...ids].reverse().map((id) => (
        <li key={id}>
          <a href={listingUrl(id)} target="_blank" rel="noreferrer">
            Listing <strong>#{id}</strong>
            <span className="open-icon" aria-hidden="true">↗</span>
          </a>
          <button className="icon-btn" onClick={() => onRemove(id)} title="Remove" aria-label={`Remove listing ${id}`}>
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}

function App() {
  const [hidden, setHidden] = useState<string[]>([])
  const [saved, setSaved] = useState<string[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('saved')

  useEffect(() => {
    chrome.storage.local.get([HIDDEN_KEY, SAVED_KEY], (res) => {
      setHidden(toIds(res[HIDDEN_KEY]))
      setSaved(toIds(res[SAVED_KEY]))
    })
    const onChange = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return
      if (HIDDEN_KEY in changes) setHidden(toIds(changes[HIDDEN_KEY].newValue))
      if (SAVED_KEY in changes) setSaved(toIds(changes[SAVED_KEY].newValue))
    }
    chrome.storage.onChanged.addListener(onChange)

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const url = tab?.url ?? ''
      if (url.startsWith('https://www.leasebreak.com/')) {
        const m = new URL(url).pathname.match(DETAIL_RE)
        if (m) setCurrentId(m[1])
      }
    })
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [])

  const listFor = (key: ListKey) => (key === HIDDEN_KEY ? hidden : saved)
  // Always read the latest lists from storage before writing, so a click made before the
  // popup finished loading (or while a page changed the list) can't overwrite them.
  const add = async (key: ListKey, id: string) => {
    const ids = toIds((await chrome.storage.local.get(key))[key])
    if (!ids.includes(id)) await chrome.storage.local.set({ [key]: [...ids, id] })
  }
  const remove = async (key: ListKey, id: string) => {
    const ids = toIds((await chrome.storage.local.get(key))[key])
    await chrome.storage.local.set({ [key]: ids.filter((x) => x !== id) })
  }
  const toggle = (key: ListKey, id: string) =>
    listFor(key).includes(id) ? remove(key, id) : add(key, id)

  const isSaved = currentId !== null && saved.includes(currentId)
  const isHidden = currentId !== null && hidden.includes(currentId)

  return (
    <main>
      <header className="app-header">
        <Logo />
        <h1>LeaseBreak Listing Hider</h1>
      </header>

      {currentId && (
        <section className="card listing-card">
          <div className="listing-info">
            <span className="eyebrow">This listing</span>
            <strong className="listing-id">#{currentId}</strong>
          </div>
          <div className="actions">
            <button className={`pill pill-save${isSaved ? ' is-on' : ''}`} onClick={() => toggle(SAVED_KEY, currentId)}>
              {isSaved ? '★ Saved' : '☆ Save'}
            </button>
            <button
              className={`pill pill-hide${isHidden ? ' is-on' : ''}`}
              onClick={() => toggle(HIDDEN_KEY, currentId)}
              title={isHidden ? 'Click to unhide' : 'Hide from search results'}
            >
              {isHidden ? '✓ Hidden' : '✕ Hide'}
            </button>
          </div>
        </section>
      )}

      <CommuteSettings />

      <section className="card lists-card">
        <div className="segmented" role="tablist" aria-label="Lists">
          {(['saved', 'hidden'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={tab === t ? 'is-active' : ''}
              onClick={() => setTab(t)}
            >
              {t === 'saved' ? 'Saved' : 'Hidden'}
              <span className="count">{(t === 'saved' ? saved : hidden).length}</span>
            </button>
          ))}
        </div>
        {tab === 'saved' ? (
          <IdList ids={saved} onRemove={(id) => remove(SAVED_KEY, id)} empty="No saved listings yet: use ☆ Save on any listing." />
        ) : (
          <IdList ids={hidden} onRemove={(id) => remove(HIDDEN_KEY, id)} empty="Nothing hidden yet." />
        )}
      </section>
    </main>
  )
}

export default App
