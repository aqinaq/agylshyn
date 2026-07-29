import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteCard, getCards, updateCard } from '../api.js'

export default function Cards() {
  const [cards, setCards] = useState(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    load()
  }, [])

  function load() {
    getCards()
      .then(setCards)
      .catch((e) => setError(e.message))
  }

  async function handleDelete(id, word) {
    if (!confirm(`Delete "${word}"?`)) return
    try {
      await deleteCard(id)
      setCards((cs) => cs.filter((c) => c.id !== id))
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleReactivate(id) {
    try {
      const updated = await updateCard(id, { suspended: false })
      setCards((cs) => cs.map((c) => (c.id === id ? updated : c)))
    } catch (e) {
      setError(e.message)
    }
  }

  const filtered = useMemo(() => {
    if (!cards) return []
    const q = query.trim().toLowerCase()
    if (!q) return cards
    return cards.filter(
      (c) => c.word.toLowerCase().includes(q) || c.translation.toLowerCase().includes(q)
    )
  }, [cards, query])

  return (
    <div className="page">
      <div className="page-head">
        <h1>Cards</h1>
        <Link to="/cards/new" className="btn btn-primary">+ Add card</Link>
      </div>

      {error && <p className="error">{error}</p>}

      <input
        className="input"
        type="search"
        placeholder="Search word or translation…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!cards ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No cards found.</p>
      ) : (
        <table className="card-table">
          <thead>
            <tr>
              <th>Word</th>
              <th>Translation</th>
              <th>Status</th>
              <th>Due</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className={c.suspended ? 'row-suspended' : ''}>
                <td>{c.word}</td>
                <td>{c.translation}</td>
                <td>
                  {c.suspended ? (
                    <span className="leech-badge" title={`Failed ${c.lapses} times`}>
                      Suspended
                    </span>
                  ) : c.repetition === 0 ? (
                    'New'
                  ) : (
                    `Rep ${c.repetition}`
                  )}
                </td>
                <td>{new Date(c.dueDate).toLocaleDateString()}</td>
                <td className="row-actions">
                  {c.suspended && (
                    <button className="btn btn-ghost btn-sm" onClick={() => handleReactivate(c.id)}>
                      Reactivate
                    </button>
                  )}
                  <Link to={`/cards/${c.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => handleDelete(c.id, c.word)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
