import { useEffect, useState } from 'react'

const ENABLED_KEY = 'highlightEnabled'
const KEYWORDS_KEY = 'highlightKeywords'

export const COLORS = ['yellow', 'green', 'red', 'blue', 'purple', 'orange'] as const
type Color = (typeof COLORS)[number]
export interface Keyword { text: string; color: Color; on: boolean; custom?: true }

// Common things renters look for: green = usually good, red = watch out, yellow = worth a look.
const PRESETS: [string, Color][] = [
  ['Dishwasher', 'green'], ['Washer/Dryer', 'green'], ['Laundry', 'green'], ['Rent stabilized', 'green'],
  ['Utilities included', 'green'], ['Doorman', 'green'], ['Elevator', 'green'], ['No fee', 'green'],
  ['Private bathroom', 'green'], ['Air conditioning', 'green'],
  ['Kitchenette', 'red'], ['Walk-up', 'red'], ['Shared bathroom', 'red'], ['Broker fee', 'red'], ['No pets', 'red'],
  ['Utilities', 'yellow'], ['Amenities', 'yellow'], ['Furnished', 'yellow'], ['Pets', 'yellow'],
]

const norm = (t: string) => t.trim().toLowerCase()

/** Presets (with any stored on/color changes) followed by the user's own keywords. */
function merge(stored: Keyword[]): Keyword[] {
  const byText = new Map(stored.map((k) => [norm(k.text), k]))
  const presets = PRESETS.map(([text, color]): Keyword => {
    const s = byText.get(norm(text))
    return { text, color: s?.color ?? color, on: s?.on ?? false }
  })
  const presetSet = new Set(PRESETS.map(([t]) => norm(t)))
  const custom = stored.filter((k) => !presetSet.has(norm(k.text))).map((k) => ({ ...k, custom: true as const }))
  return [...presets, ...custom]
}

export function HighlightSettings() {
  const [enabled, setEnabled] = useState(true)
  const [keywords, setKeywords] = useState<Keyword[]>(() => merge([]))
  const [input, setInput] = useState('')

  useEffect(() => {
    chrome.storage.local.get([ENABLED_KEY, KEYWORDS_KEY], (res) => {
      setEnabled(res[ENABLED_KEY] !== false)
      setKeywords(merge(Array.isArray(res[KEYWORDS_KEY]) ? res[KEYWORDS_KEY] : []))
    })
  }, [])

  const save = (next: Keyword[]) => {
    setKeywords(next)
    // Store custom keywords and presets that differ from their defaults.
    const defaults = new Map(PRESETS.map(([t, c]) => [norm(t), c]))
    const toStore = next
      .filter((k) => k.custom || k.on || defaults.get(norm(k.text)) !== k.color)
      .map(({ text, color, on }) => ({ text, color, on }))
    chrome.storage.local.set({ [KEYWORDS_KEY]: toStore })
  }

  const update = (i: number, patch: Partial<Keyword>) =>
    save(keywords.map((k, j) => (j === i ? { ...k, ...patch } : k)))

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    const seen = new Set(keywords.map((k) => norm(k.text)))
    let next = [...keywords]
    let colorIdx = keywords.filter((k) => k.custom).length
    for (const raw of input.split(',')) {
      const text = raw.trim().replace(/\s+/g, ' ')
      if (!text) continue
      const existing = next.findIndex((k) => norm(k.text) === norm(text))
      if (existing >= 0) {
        next = next.map((k, j) => (j === existing ? { ...k, on: true } : k)) // re-adding a preset turns it on
        continue
      }
      if (seen.has(norm(text))) continue
      seen.add(norm(text))
      next.push({ text, color: COLORS[colorIdx++ % COLORS.length], on: true, custom: true })
    }
    setInput('')
    save(next)
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>🖍 Keyword highlighter</h2>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={enabled}
          aria-label="Highlight keywords on listing pages"
          onChange={(e) => { setEnabled(e.target.checked); chrome.storage.local.set({ [ENABLED_KEY]: e.target.checked }) }}
        />
      </div>

      <div className={`chips${enabled ? '' : ' is-disabled'}`}>
        {keywords.map((k, i) => (
          <span key={norm(k.text)} className={`chip${k.on ? ` is-on hl-${k.color}` : ''}`}>
            {k.on && (
              <button
                type="button"
                className={`dot hl-${k.color}`}
                title={`Color: ${k.color} (click to change)`}
                aria-label={`Change color of ${k.text}, now ${k.color}`}
                onClick={() => update(i, { color: COLORS[(COLORS.indexOf(k.color) + 1) % COLORS.length] })}
              />
            )}
            <button type="button" className="chip-label" aria-pressed={k.on} onClick={() => update(i, { on: !k.on })}>
              {k.text}
            </button>
            {k.custom && (
              <button
                type="button"
                className="chip-x"
                aria-label={`Remove ${k.text}`}
                title="Remove"
                onClick={() => save(keywords.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      <form className="search" onSubmit={add}>
        <input
          className="field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add your own, e.g. balcony, roof deck"
          aria-label="Add keywords, separated by commas"
        />
        <button type="submit" className="btn-primary" disabled={!input.trim()}>Add</button>
      </form>
      <p className="hint">
        Click a keyword's dot to change its color
      </p>
    </section>
  )
}
