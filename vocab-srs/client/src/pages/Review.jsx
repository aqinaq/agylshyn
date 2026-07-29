import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { getDueCards, reviewCard, undoReview } from '../api.js'

const GRADES = [
  { label: 'Again', quality: 1, className: 'grade-again' },
  { label: 'Hard', quality: 3, className: 'grade-hard' },
  { label: 'Good', quality: 4, className: 'grade-good' },
  { label: 'Easy', quality: 5, className: 'grade-easy' },
]

const SWIPE_DISTANCE = 120
const SWIPE_VELOCITY = 700

export default function Review() {
  const [queue, setQueue] = useState(null)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [error, setError] = useState(null)
  const [lastAction, setLastAction] = useState(null)
  const [leechMessage, setLeechMessage] = useState(null)

  useEffect(() => {
    getDueCards()
      .then(setQueue)
      .catch((e) => setError(e.message))
  }, [])

  const hasCard = queue && index < queue.length
  const card = hasCard ? queue[index] : null

  async function grade(quality) {
    if (submitting || !card) return
    const i = index
    setSubmitting(true)
    setLeechMessage(null)
    try {
      const updated = await reviewCard(card.id, { quality })
      if (updated.suspended && !card.suspended) {
        setLeechMessage(`"${card.word}" failed too many times and was suspended. Reactivate it from the Cards page.`)
      }
      setLastAction({ index: i, quality })
      setReviewedCount((c) => c + 1)
      setFlipped(false)
      setIndex((idx) => idx + 1)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function undo() {
    if (submitting || !lastAction || !queue) return
    const { index: i, quality } = lastAction
    const original = queue[i]
    setSubmitting(true)
    try {
      await undoReview(original.id, {
        repetition: original.repetition,
        interval: original.interval,
        easeFactor: original.easeFactor,
        dueDate: original.dueDate,
        lastReviewedAt: original.lastReviewedAt,
        lapses: original.lapses || 0,
        suspended: original.suspended || false,
        wasNew: original.repetition === 0,
        quality,
      })
      setReviewedCount((c) => Math.max(0, c - 1))
      setIndex(i)
      setFlipped(false)
      setLastAction(null)
      setLeechMessage(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (!hasCard || submitting) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!flipped) setFlipped(true)
        else grade(4)
      } else if (flipped && e.key >= '1' && e.key <= '4') {
        const g = GRADES[Number(e.key) - 1]
        if (g) grade(g.quality)
      } else if ((e.key === 'u' || e.key === 'U') && lastAction) {
        undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (error) return <p className="error">{error}</p>
  if (!queue) return <p className="muted">Loading…</p>

  if (queue.length === 0) {
    return (
      <div className="page review-done">
        <h1>Nothing to review</h1>
        <p className="muted">You're all caught up. Add more cards or check back later.</p>
        <Link to="/" className="btn btn-primary">Back to dashboard</Link>
      </div>
    )
  }

  if (!hasCard) {
    return (
      <div className="page review-done">
        <h1>Session complete</h1>
        <p className="muted">You reviewed {reviewedCount} card{reviewedCount === 1 ? '' : 's'}.</p>
        <Link to="/" className="btn btn-primary">Back to dashboard</Link>
      </div>
    )
  }

  return (
    <div className="page review">
      <div className="review-progress-row">
        <span className="review-progress">{index + 1} / {queue.length}</span>
        {lastAction && (
          <button className="btn btn-ghost btn-sm" disabled={submitting} onClick={undo}>
            Undo
          </button>
        )}
      </div>

      {leechMessage && <p className="leech-banner">{leechMessage}</p>}

      <div className="flip-stage">
        <AnimatePresence mode="wait">
          <FlipCard
            key={card.id}
            card={card}
            flipped={flipped}
            submitting={submitting}
            onReveal={() => setFlipped(true)}
            onSwipeRight={() => grade(4)}
            onSwipeLeft={() => grade(1)}
          />
        </AnimatePresence>
      </div>

      {flipped ? (
        <div className="grade-row">
          {GRADES.map((g) => (
            <button
              key={g.label}
              className={`btn grade-btn ${g.className}`}
              disabled={submitting}
              onClick={() => grade(g.quality)}
            >
              {g.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="grade-row">
          <button className="btn btn-primary" onClick={() => setFlipped(true)}>
            Show answer
          </button>
        </div>
      )}

      <p className="review-hint muted">
        {flipped
          ? 'Swipe, tap a grade, or press 1-4 · U to undo'
          : 'Tap the card or press space to reveal'}
      </p>
    </div>
  )
}

function FlipCard({ card, flipped, submitting, onReveal, onSwipeRight, onSwipeLeft }) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 200], [-12, 12])
  const goodOpacity = useTransform(x, [20, SWIPE_DISTANCE], [0, 1])
  const againOpacity = useTransform(x, [-SWIPE_DISTANCE, -20], [1, 0])

  function handleDragEnd(_, info) {
    if (submitting) return
    if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) {
      animate(x, 500, { duration: 0.2, ease: 'easeOut' })
      onSwipeRight()
    } else if (info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY) {
      animate(x, -500, { duration: 0.2, ease: 'easeOut' })
      onSwipeLeft()
    }
  }

  return (
    <motion.div
      className="flip-card"
      style={{ x, rotate }}
      drag={flipped && !submitting ? 'x' : false}
      dragElastic={0.7}
      dragSnapToOrigin
      onDragEnd={handleDragEnd}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={() => {
        if (!flipped) onReveal()
      }}
    >
      <motion.div
        className="flip-card-inner"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="flip-face flip-front">
          <span className="word">{card.word}</span>
          <span className="hint muted">tap to reveal</span>
        </div>
        <div className="flip-face flip-back">
          <span className="translation">{card.translation}</span>
          {card.example && <p className="example">"{card.example}"</p>}
          <CardTags label="Collocations" items={card.collocations} />
          <CardTags label="Synonyms" items={card.synonyms} />
          <CardTags label="Antonyms" items={card.antonyms} />
        </div>
      </motion.div>

      {flipped && (
        <>
          <motion.span className="swipe-stamp stamp-good" style={{ opacity: goodOpacity }}>
            Good
          </motion.span>
          <motion.span className="swipe-stamp stamp-again" style={{ opacity: againOpacity }}>
            Again
          </motion.span>
        </>
      )}
    </motion.div>
  )
}

function CardTags({ label, items }) {
  if (!items || items.length === 0) return null
  return (
    <div className="card-tags">
      <span className="card-tags-label">{label}:</span> {items.join(', ')}
    </div>
  )
}
