import express from "express";
import cors from "cors";
import crypto from "crypto";
import { readData, writeData, todayKey } from "./db.js";
import { applySm2, newCardDefaults } from "./srs.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

function normalizeCard(input) {
  return {
    id: crypto.randomUUID(),
    word: input.word?.trim() || "",
    translation: input.translation?.trim() || "",
    example: input.example?.trim() || "",
    collocations: input.collocations || [],
    synonyms: input.synonyms || [],
    antonyms: input.antonyms || [],
    createdAt: new Date().toISOString(),
    ...newCardDefaults(),
  };
}

// --- Cards ---

app.get("/api/cards", (req, res) => {
  const data = readData();
  res.json(data.cards);
});

app.get("/api/cards/due", (req, res) => {
  const data = readData();
  const now = new Date();
  const key = todayKey();
  const todayHist = data.history[key] || { newLearned: 0, reviewed: 0 };
  const remainingNew = Math.max(0, data.settings.dailyGoal - todayHist.newLearned);

  const dueReview = data.cards.filter(
    (c) => !c.suspended && c.repetition > 0 && new Date(c.dueDate) <= now
  );
  const newCards = data.cards
    .filter((c) => !c.suspended && c.repetition === 0)
    .slice(0, remainingNew);

  res.json([...dueReview, ...newCards]);
});

app.post("/api/cards", (req, res) => {
  const data = readData();
  const card = normalizeCard(req.body);
  if (!card.word || !card.translation) {
    return res.status(400).json({ error: "word and translation are required" });
  }
  data.cards.push(card);
  writeData(data);
  res.status(201).json(card);
});

app.post("/api/cards/bulk", (req, res) => {
  const data = readData();
  const items = Array.isArray(req.body) ? req.body : [];
  const created = [];
  for (const item of items) {
    const card = normalizeCard(item);
    if (!card.word || !card.translation) continue;
    data.cards.push(card);
    created.push(card);
  }
  writeData(data);
  res.status(201).json(created);
});

app.put("/api/cards/:id", (req, res) => {
  const data = readData();
  const card = data.cards.find((c) => c.id === req.params.id);
  if (!card) return res.status(404).json({ error: "not found" });
  const { word, translation, example, collocations, synonyms, antonyms, suspended } = req.body;
  if (word !== undefined) card.word = word;
  if (translation !== undefined) card.translation = translation;
  if (example !== undefined) card.example = example;
  if (collocations !== undefined) card.collocations = collocations;
  if (synonyms !== undefined) card.synonyms = synonyms;
  if (antonyms !== undefined) card.antonyms = antonyms;
  if (suspended !== undefined) card.suspended = Boolean(suspended);
  writeData(data);
  res.json(card);
});

app.delete("/api/cards/:id", (req, res) => {
  const data = readData();
  const idx = data.cards.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "not found" });
  data.cards.splice(idx, 1);
  writeData(data);
  res.status(204).end();
});

// review: { know: boolean } from swipe, or { quality: 0-5 } for graded review
app.post("/api/cards/:id/review", (req, res) => {
  const data = readData();
  const card = data.cards.find((c) => c.id === req.params.id);
  if (!card) return res.status(404).json({ error: "not found" });

  const quality =
    typeof req.body.quality === "number"
      ? req.body.quality
      : req.body.know
      ? 4
      : 1;

  const wasNew = card.repetition === 0;
  applySm2(card, quality);

  const key = todayKey();
  if (!data.history[key]) data.history[key] = { newLearned: 0, reviewed: 0 };
  data.history[key].reviewed += 1;
  if (wasNew && quality >= 3) data.history[key].newLearned += 1;

  writeData(data);
  res.json(card);
});

// Reverts a single review action: restores the card's pre-review SRS fields
// (sent by the client, which still holds them from before the grade call)
// and rolls back today's history counters.
app.post("/api/cards/:id/undo-review", (req, res) => {
  const data = readData();
  const card = data.cards.find((c) => c.id === req.params.id);
  if (!card) return res.status(404).json({ error: "not found" });

  const { repetition, interval, easeFactor, dueDate, lastReviewedAt, lapses, suspended, wasNew, quality } =
    req.body;
  card.repetition = repetition;
  card.interval = interval;
  card.easeFactor = easeFactor;
  card.dueDate = dueDate;
  card.lastReviewedAt = lastReviewedAt;
  card.lapses = lapses || 0;
  card.suspended = Boolean(suspended);

  const key = todayKey();
  if (data.history[key]) {
    data.history[key].reviewed = Math.max(0, data.history[key].reviewed - 1);
    if (wasNew && quality >= 3) {
      data.history[key].newLearned = Math.max(0, data.history[key].newLearned - 1);
    }
  }

  writeData(data);
  res.json(card);
});

// --- Stats & settings ---

app.get("/api/stats/today", (req, res) => {
  const data = readData();
  const key = todayKey();
  const todayHist = data.history[key] || { newLearned: 0, reviewed: 0 };
  res.json({
    date: key,
    goal: data.settings.dailyGoal,
    newLearned: todayHist.newLearned,
    reviewed: todayHist.reviewed,
    totalCards: data.cards.length,
  });
});

app.get("/api/stats/history", (req, res) => {
  const data = readData();
  res.json(data.history);
});

app.put("/api/settings", (req, res) => {
  const data = readData();
  if (typeof req.body.dailyGoal === "number" && req.body.dailyGoal > 0) {
    data.settings.dailyGoal = req.body.dailyGoal;
  }
  writeData(data);
  res.json(data.settings);
});

// --- Backup & restore ---

app.get("/api/export", (req, res) => {
  res.json(readData());
});

app.post("/api/restore", (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.cards)) {
    return res.status(400).json({ error: "Backup file must include a cards array" });
  }
  const data = {
    cards: incoming.cards,
    settings:
      incoming.settings && typeof incoming.settings.dailyGoal === "number"
        ? incoming.settings
        : { dailyGoal: 15 },
    history: incoming.history && typeof incoming.history === "object" ? incoming.history : {},
  };
  writeData(data);
  res.json({ cards: data.cards.length });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
