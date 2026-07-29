const BASE = "/api";

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const getCards = () => request("/cards");
export const getDueCards = () => request("/cards/due");
export const createCard = (card) =>
  request("/cards", { method: "POST", body: JSON.stringify(card) });
export const bulkCreateCards = (cards) =>
  request("/cards/bulk", { method: "POST", body: JSON.stringify(cards) });
export const updateCard = (id, card) =>
  request(`/cards/${id}`, { method: "PUT", body: JSON.stringify(card) });
export const deleteCard = (id) =>
  request(`/cards/${id}`, { method: "DELETE" });
export const reviewCard = (id, payload) =>
  request(`/cards/${id}/review`, { method: "POST", body: JSON.stringify(payload) });
export const undoReview = (id, payload) =>
  request(`/cards/${id}/undo-review`, { method: "POST", body: JSON.stringify(payload) });
export const getTodayStats = () => request("/stats/today");
export const getHistory = () => request("/stats/history");
export const updateSettings = (settings) =>
  request("/settings", { method: "PUT", body: JSON.stringify(settings) });
export const exportBackup = () => request("/export");
export const restoreBackup = (data) =>
  request("/restore", { method: "POST", body: JSON.stringify(data) });
