import { useEffect, useState } from 'react'
// Type-only import: erased at build time, so the popup doesn't bundle the worker.
import type { Place } from './background'

const KEYS = {
  enabled: 'commuteEnabled',
  dest: 'commuteDest',
  arrival: 'commuteArrival',
  day: 'commuteDay',
} as const
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function CommuteSettings() {
  const [enabled, setEnabled] = useState(false)
  const [dest, setDest] = useState<Place | null>(null)
  const [arrival, setArrival] = useState('08:00')
  const [day, setDay] = useState(2)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Place[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(Object.values(KEYS), (res) => {
      setEnabled(res[KEYS.enabled] === true)
      setDest(res[KEYS.dest] ?? null)
      if (typeof res[KEYS.arrival] === 'string') setArrival(res[KEYS.arrival])
      if (typeof res[KEYS.day] === 'number') setDay(res[KEYS.day])
    })
  }, [])

  const save = (patch: Record<string, unknown>) => chrome.storage.local.set(patch)

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    try {
      const res = await chrome.runtime.sendMessage({ type: 'geocode', text: query.trim() })
      setMatches(res?.places ?? [])
    } catch {
      setMatches([])
    } finally {
      setBusy(false)
    }
  }

  const pick = (p: Place) => {
    setDest(p)
    setEnabled(true)
    setMatches(null)
    setQuery('')
    save({ [KEYS.dest]: p, [KEYS.enabled]: true })
  }

  return (
    <section className="commute">
      <h2>Commute</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!dest}
          onChange={(e) => { setEnabled(e.target.checked); save({ [KEYS.enabled]: e.target.checked }) }}
        />
        <span>Show transit time on listings</span>
      </label>

      <p className="dest">
        To: {dest ? <strong>{dest.name}</strong> : <em>no destination set</em>}
      </p>

      <form onSubmit={search}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={dest ? 'Change destination…' : 'Destination address'}
          aria-label="Destination address"
        />
        <button type="submit" disabled={busy}>{busy ? '…' : 'Find'}</button>
      </form>
      {matches && (
        matches.length === 0
          ? <p className="error">No match. Try adding a cross street or ZIP.</p>
          : <ul className="matches">
              {matches.map((m) => (
                <li key={`${m.lat},${m.lon}`}>
                  <button type="button" className="link pick" onClick={() => pick(m)}>{m.name}</button>
                </li>
              ))}
            </ul>
      )}

      <div className="when">
        <span>Arrive by</span>
        <input
          type="time"
          value={arrival}
          onChange={(e) => { if (e.target.value) { setArrival(e.target.value); save({ [KEYS.arrival]: e.target.value }) } }}
        />
        <span>on</span>
        <select value={day} onChange={(e) => { const d = Number(e.target.value); setDay(d); save({ [KEYS.day]: d }) }}>
          {DAYS.map((name, i) => <option key={name} value={i}>{name}</option>)}
        </select>
      </div>

      <p className="attribution">
        Routing by <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">Transitous</a>
        {' · '}© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors
      </p>
    </section>
  )
}
