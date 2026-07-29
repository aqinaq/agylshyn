import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDueCards, getHistory, getTodayStats } from '../api.js'
import { currentStreak, heatLevel, lastNDays } from '../streak.js'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [dueCount, setDueCount] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([getTodayStats(), getDueCards(), getHistory()])
      .then(([s, due, hist]) => {
        setStats(s)
        setDueCount(due.length)
        setHistory(hist)
      })
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <p className="error">Could not reach the server: {error}</p>
  if (!stats || !history) return <p className="muted">Loading…</p>

  const goalPct = Math.min(100, Math.round((stats.newLearned / stats.goal) * 100))
  const streak = currentStreak(history)
  const days = lastNDays(history, 14)

  return (
    <div className="page dashboard">
      <h1>Today</h1>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-value">{stats.newLearned}/{stats.goal}</span>
          <span className="stat-label">New words</span>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${goalPct}%` }} />
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.reviewed}</span>
          <span className="stat-label">Reviewed today</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.totalCards}</span>
          <span className="stat-label">Total cards</span>
        </div>
      </div>

      <div className="dashboard-cta">
        {dueCount > 0 ? (
          <>
            <p>{dueCount} card{dueCount === 1 ? '' : 's'} ready for review.</p>
            <Link to="/review" className="btn btn-primary btn-lg">Start review</Link>
          </>
        ) : (
          <p className="muted">No cards due right now. Add more words or come back later.</p>
        )}
      </div>

      <div className="streak-card">
        <div className="streak-head">
          <span className="streak-count">{streak} day{streak === 1 ? '' : 's'}</span>
          <span className="muted">current streak</span>
        </div>
        <div className="heatmap-row">
          {days.map((d) => (
            <span
              key={d.key}
              className={`heat-cell heat-${heatLevel(d.reviewed)}`}
              title={`${d.date.toLocaleDateString()}: ${d.reviewed} review${d.reviewed === 1 ? '' : 's'}`}
            />
          ))}
        </div>
        <div className="heatmap-legend">
          <span className="muted">Less</span>
          <span className="heat-cell heat-0" />
          <span className="heat-cell heat-1" />
          <span className="heat-cell heat-2" />
          <span className="heat-cell heat-3" />
          <span className="heat-cell heat-4" />
          <span className="muted">More</span>
        </div>
      </div>

      <div className="quick-links">
        <Link to="/cards/new" className="btn btn-ghost">+ Add card</Link>
        <Link to="/import" className="btn btn-ghost">Import list</Link>
        <Link to="/cards" className="btn btn-ghost">Browse cards</Link>
      </div>
    </div>
  )
}
