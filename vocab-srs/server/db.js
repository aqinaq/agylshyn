import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data", "data.json");

const DEFAULT_DATA = {
  cards: [],
  settings: { dailyGoal: 15 },
  history: {}, // { "2026-07-19": { newLearned: 3, reviewed: 8 } }
};

function ensureFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}

export function readData() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  const data = JSON.parse(raw);
  if (!data.settings) data.settings = DEFAULT_DATA.settings;
  if (!data.history) data.history = {};
  return data;
}

export function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
