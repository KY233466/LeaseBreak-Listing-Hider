import { useEffect, useState } from 'react'
import './App.css'

const HIDDEN_KEY = 'hiddenListingIds'
const SAVED_KEY = 'savedListingIds'
type ListKey = typeof HIDDEN_KEY | typeof SAVED_KEY
const AUTO_ROOM_KEY = 'autoHideJustARoom'
const EXCEPTIONS_KEY = 'autoHideExceptions'

const DETAIL_RE = /details\/(\d+)/i
const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])
const listingUrl = (id: string) => `https://www.leasebreak.com/short-term-rental-details/${id}/`

/** Accepts a bare id ("410557") or any LeaseBreak details URL. */
function parseId(input: string): string | null {
  const s = input.trim()
  if (/^\d+$/.test(s)) return s
  const m = s.match(DETAIL_RE) ?? s.match(/listing(\d+)/)
  return m ? m[1] : null
}

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
  const [autoRoom, setAutoRoom] = useState(false)
  const [exceptions, setExceptions] = useState<string[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    chrome.storage.local.get([HIDDEN_KEY, SAVED_KEY, AUTO_ROOM_KEY, EXCEPTIONS_KEY], (res) => {
      setHidden(toIds(res[HIDDEN_KEY]))
      setSaved(toIds(res[SAVED_KEY]))
      setAutoRoom(res[AUTO_ROOM_KEY] === true)
      setExceptions(toIds(res[EXCEPTIONS_KEY]))
    })
    const onChange = (changes: { [k: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local') return
      if (HIDDEN_KEY in changes) setHidden(toIds(changes[HIDDEN_KEY].newValue))
      if (SAVED_KEY in changes) setSaved(toIds(changes[SAVED_KEY].newValue))
      if (AUTO_ROOM_KEY in changes) setAutoRoom(changes[AUTO_ROOM_KEY].newValue === true)
      if (EXCEPTIONS_KEY in changes) setExceptions(toIds(changes[EXCEPTIONS_KEY].newValue))
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
  const add = (key: ListKey, id: string) => {
    const ids = listFor(key)
    if (!ids.includes(id)) chrome.storage.local.set({ [key]: [...ids, id] })
  }
  const remove = (key: ListKey, id: string) => {
    const update: Record<string, string[]> = { [key]: listFor(key).filter((x) => x !== id) }
    // Manually unhiding: remember it so auto-hide doesn't re-hide it.
    if (key === HIDDEN_KEY && !exceptions.includes(id)) update[EXCEPTIONS_KEY] = [...exceptions, id]
    chrome.storage.local.set(update)
  }
  const toggle = (key: ListKey, id: string) =>
    listFor(key).includes(id) ? remove(key, id) : add(key, id)

  const submitTo = (key: ListKey) => {
    const id = parseId(input)
    if (!id) { setError('Enter a listing ID or a LeaseBreak listing URL.'); return }
    setError('')
    add(key, id)
    setInput('')
  }

  return (
    <main>
      <h1>LeaseBreak Listing Hider</h1>

      <label className="toggle">
        <input
          type="checkbox"
          checked={autoRoom}
          onChange={(e) => chrome.storage.local.set({ [AUTO_ROOM_KEY]: e.target.checked })}
        />
        <span>Auto-hide &ldquo;Just a Room&rdquo; listings</span>
      </label>

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

      <form onSubmit={(e) => { e.preventDefault(); submitTo(HIDDEN_KEY) }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Listing ID or URL"
          aria-label="Listing ID or URL"
        />
        <button type="button" className="save" onClick={() => submitTo(SAVED_KEY)}>Save</button>
        <button type="submit" className="danger">Hide</button>
      </form>
      {error && <p className="error">{error}</p>}

      <h2>Saved ({saved.length})</h2>
      <IdList ids={saved} onRemove={(id) => remove(SAVED_KEY, id)} empty="None yet." />

      <h2>Hidden ({hidden.length})</h2>
      <IdList ids={hidden} onRemove={(id) => remove(HIDDEN_KEY, id)} empty="None yet." />
    </main>
  )
}

export default App
