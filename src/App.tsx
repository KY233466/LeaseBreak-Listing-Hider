import { useEffect, useState } from 'react'
import './App.css'
import { CommuteSettings } from './Commute'

const HIDDEN_KEY = 'hiddenListingIds'
const SAVED_KEY = 'savedListingIds'
type ListKey = typeof HIDDEN_KEY | typeof SAVED_KEY

const DETAIL_RE = /details\/(\d+)/i
const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
const listingUrl = (id: string) => `https://www.leasebreak.com/short-term-rental-details/${id}/`

function IdList({ ids, onRemove, empty }: { ids: string[]; onRemove: (id: string) => void; empty: string }) {
  if (ids.length === 0) return <p className="empty">{empty}</p>
  return (
    <ul>
      {[...ids].reverse().map((id) => (
        <li key={id}>
          <a href={listingUrl(id)} target="_blank" rel="noreferrer">#{id}</a>
          <button className="link" onClick={() => onRemove(id)}>Remove</button>
        </li>
      ))}
    </ul>
  )
}

function App() {
  const [hidden, setHidden] = useState<string[]>([])
  const [saved, setSaved] = useState<string[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)

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

  return (
    <main>
      <h1>LeaseBreak Listing Hider</h1>

      <CommuteSettings />

      {currentId && (
        <section className="current">
          <span>This listing: <strong>#{currentId}</strong></span>
          <div className="row">
            <button
              className={saved.includes(currentId) ? 'save on' : 'save'}
              onClick={() => toggle(SAVED_KEY, currentId)}
            >
              {saved.includes(currentId) ? '★ Saved' : '☆ Save'}
            </button>
            <button
              className={hidden.includes(currentId) ? 'secondary' : 'danger'}
              onClick={() => toggle(HIDDEN_KEY, currentId)}
            >
              {hidden.includes(currentId) ? 'Unhide' : 'Hide'}
            </button>
          </div>
        </section>
      )}

      <h2>Saved ({saved.length})</h2>
      <IdList ids={saved} onRemove={(id) => remove(SAVED_KEY, id)} empty="None yet." />

      <h2>Hidden ({hidden.length})</h2>
      <IdList ids={hidden} onRemove={(id) => remove(HIDDEN_KEY, id)} empty="None yet." />
    </main>
  )
}

export default App
