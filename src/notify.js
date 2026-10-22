// JSON publish keeps non-ASCII titles/messages (emoji, Hindi, ...) intact.
export async function notify({ server, topic, title, message, priority, tags }) {
  const res = await fetch(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority: priorityNum(priority), tags }),
  });
  if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
}

const LEVELS = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };
const priorityNum = (p) => LEVELS[p] ?? 3;
