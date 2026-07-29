import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createCard, getCards, updateCard } from '../api.js'

const EMPTY = {
  word: '',
  translation: '',
  example: '',
  collocations: '',
  synonyms: '',
  antonyms: '',
}

const toList = (s) =>
  s.split(',').map((x) => x.trim()).filter(Boolean)

export default function CardForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isEdit) return
    getCards()
      .then((cards) => {
        const card = cards.find((c) => c.id === id)
        if (!card) throw new Error('Card not found')
        setForm({
          word: card.word,
          translation: card.translation,
          example: card.example || '',
          collocations: (card.collocations || []).join(', '),
          synonyms: (card.synonyms || []).join(', '),
          antonyms: (card.antonyms || []).join(', '),
        })
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.word.trim() || !form.translation.trim()) {
      setError('Word and translation are required.')
      return
    }
    setSaving(true)
    setError(null)
    const payload = {
      word: form.word,
      translation: form.translation,
      example: form.example,
      collocations: toList(form.collocations),
      synonyms: toList(form.synonyms),
      antonyms: toList(form.antonyms),
    }
    try {
      if (isEdit) {
        await updateCard(id, payload)
      } else {
        await createCard(payload)
      }
      navigate('/cards')
    } catch (e2) {
      setError(e2.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="muted">Loading…</p>

  return (
    <div className="page">
      <h1>{isEdit ? 'Edit card' : 'Add card'}</h1>
      {error && <p className="error">{error}</p>}
      <form className="card-form" onSubmit={handleSubmit}>
        <label>
          Word *
          <input className="input" value={form.word} onChange={set('word')} required />
        </label>
        <label>
          Translation *
          <input className="input" value={form.translation} onChange={set('translation')} required />
        </label>
        <label>
          Example sentence
          <textarea className="input" rows={2} value={form.example} onChange={set('example')} />
        </label>
        <label>
          Collocations <span className="muted">(comma separated)</span>
          <input className="input" value={form.collocations} onChange={set('collocations')} />
        </label>
        <label>
          Synonyms <span className="muted">(comma separated)</span>
          <input className="input" value={form.synonyms} onChange={set('synonyms')} />
        </label>
        <label>
          Antonyms <span className="muted">(comma separated)</span>
          <input className="input" value={form.antonyms} onChange={set('antonyms')} />
        </label>

        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add card'}
          </button>
        </div>
      </form>
    </div>
  )
}
