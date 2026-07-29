// SM-2 spaced repetition algorithm
// quality: 0-5 (0 = total blackout, 5 = perfect recall)

// Cards that fail this many times in their lifetime are auto-suspended
// ("leeches") so they stop resurfacing every day.
export const LEECH_THRESHOLD = 8;

export function applySm2(card, quality) {
  const q = Math.max(0, Math.min(5, quality));

  if (q < 3) {
    card.repetition = 0;
    card.interval = 1;
    card.lapses = (card.lapses || 0) + 1;
    if (card.lapses >= LEECH_THRESHOLD) {
      card.suspended = true;
    }
  } else {
    if (card.repetition === 0) {
      card.interval = 1;
    } else if (card.repetition === 1) {
      card.interval = 6;
    } else {
      card.interval = Math.round(card.interval * card.easeFactor);
    }
    card.repetition += 1;
  }

  card.easeFactor = Math.max(
    1.3,
    card.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  );

  const due = new Date();
  due.setDate(due.getDate() + card.interval);
  card.dueDate = due.toISOString();
  card.lastReviewedAt = new Date().toISOString();

  return card;
}

export function newCardDefaults() {
  return {
    repetition: 0,
    interval: 0,
    easeFactor: 2.5,
    dueDate: new Date().toISOString(),
    lastReviewedAt: null,
    lapses: 0,
    suspended: false,
  };
}
