const DAY_MS = 24 * 60 * 60 * 1000

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

export function lastNDays(history, n) {
  const days = []
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * DAY_MS)
    const key = dateKey(date)
    days.push({ key, date, reviewed: history[key]?.reviewed || 0 })
  }
  return days
}

export function currentStreak(history) {
  const today = new Date()
  let cursor = today
  if (!(history[dateKey(today)]?.reviewed > 0)) {
    cursor = new Date(today.getTime() - DAY_MS)
  }
  let streak = 0
  while (history[dateKey(cursor)]?.reviewed > 0) {
    streak += 1
    cursor = new Date(cursor.getTime() - DAY_MS)
  }
  return streak
}

export function heatLevel(reviewed) {
  if (reviewed <= 0) return 0
  if (reviewed < 4) return 1
  if (reviewed < 8) return 2
  if (reviewed < 15) return 3
  return 4
}
