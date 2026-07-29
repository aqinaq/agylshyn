import { useEffect, useRef, useState } from 'react'
import { exportBackup, getTodayStats, restoreBackup, updateSettings } from '../api.js'

export default function Settings() {
  const [dailyGoal, setDailyGoal] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const [backupError, setBackupError] = useState(null)
  const [backupMessage, setBackupMessage] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const restoreInputRef = useRef(null)

  useEffect(() => {
    getTodayStats()
      .then((s) => setDailyGoal(String(s.goal)))
      .catch((e) => setError(e.message))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    const value = Number(dailyGoal)
    if (!value || value <= 0) {
      setError('Daily goal must be a positive number.')
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await updateSettings({ dailyGoal: value })
      setSaved(true)
    } catch (e2) {
      setError(e2.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDownloadBackup() {
    setBackupError(null)
    setBackupMessage(null)
    try {
      const data = await exportBackup()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vocab-srs-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setBackupError(e.message)
    }
  }

  async function handleRestoreFile(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBackupError(null)
    setBackupMessage(null)

    let parsed
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      setBackupError('That file is not valid JSON.')
      return
    }
    if (!Array.isArray(parsed.cards)) {
      setBackupError('That file does not look like a vocab-srs backup.')
      return
    }
    if (
      !confirm(
        `Restore from "${file.name}"? This replaces all ${parsed.cards.length} card(s) currently stored and cannot be undone.`
      )
    ) {
      return
    }

    setRestoring(true)
    try {
      const result = await restoreBackup(parsed)
      setBackupMessage(`Restored ${result.cards} card(s). Reloading…`)
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      setBackupError(e.message)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      {error && <p className="error">{error}</p>}
      <form className="card-form" onSubmit={handleSubmit}>
        <label>
          Daily new-word goal
          <input
            className="input"
            type="number"
            min="1"
            value={dailyGoal}
            onChange={(e) => {
              setDailyGoal(e.target.value)
              setSaved(false)
            }}
          />
        </label>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saved && <span className="muted">Saved.</span>}
        </div>
      </form>

      <h2 className="section-heading">Backup &amp; restore</h2>
      <p className="muted">
        Your data lives in a single local file on the server. Download a backup
        periodically, and restore it if you ever need to recover your cards.
      </p>
      {backupError && <p className="error">{backupError}</p>}
      {backupMessage && <p className="muted">{backupMessage}</p>}
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={handleDownloadBackup}>
          Download backup
        </button>
        <button
          className="btn btn-ghost"
          disabled={restoring}
          onClick={() => restoreInputRef.current.click()}
        >
          {restoring ? 'Restoring…' : 'Restore from backup'}
        </button>
        <input
          ref={restoreInputRef}
          type="file"
          accept=".json"
          onChange={handleRestoreFile}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  )
}
