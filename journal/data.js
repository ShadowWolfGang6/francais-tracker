export const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit'
});
const datePattern = /^\d{4}-\d\d-\d\d$/;
const keyPattern = /^(log|duo|tv|speak|word|check|tvstep|milestone|prefs):[a-zA-Z0-9_.-]{1,120}$/;
const labels = { light: 'Light session', standard: 'Standard session', intensive: 'Intensive session' };

export function shiftDay(date, offset) {
  const clock = new Date(date + 'T12:00:00Z');
  clock.setUTCDate(clock.getUTCDate() + offset);
  return clock.toISOString().slice(0, 10);
}

export function streak(days, date) {
  let current = days.has(date) ? date : shiftDay(date, -1);
  let length = 0;
  while (days.has(current)) {
    length++;
    current = shiftDay(current, -1);
  }
  return length;
}

export const text = (value, limit = 300) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const number = value => {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 && result <= 1000000 ? result : 0;
};
const isDate = value => {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const d = new Date(value + 'T12:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
};
const safeDate = value => isDate(value) ? value : '';
const levels = ['A1', 'A2', 'B1', 'B1+', 'B2'];
const safeLevel = value => levels.includes(value) ? value : 'A2';

export function httpUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href.slice(0, 2000) : '';
  } catch {
    return '';
  }
}

export function cleanRecord(key, item) {
  if (!keyPattern.test(key) || !item || typeof item !== 'object' || Array.isArray(item)) return null;
  const base = { date: safeDate(item.date), minutes: number(item.minutes),
    created: text(item.created, 60) };
  switch (key.split(':')[0]) {
    case 'log':
      return base.date && text(item.type) ? { ...base, type: text(item.type), detail: text(item.detail, 1500),
        category: Object.hasOwn(labels, item.category) ? item.category : '',
        activities: Array.isArray(item.activities) ? item.activities.slice(0, 10).map(value => text(value)) : [] } : null;
    case 'duo':
      return base.date && key === 'duo:' + base.date ? base : null;
    case 'tv':
      return base.date ? { ...base, title: text(item.title) || 'Untitled lesson', level: safeLevel(item.level),
        difficulty: text(item.difficulty), expressions: text(item.expressions, 2000), notes: text(item.notes, 2000),
        source: item.source === 'Curated video' ? 'Curated video' : 'TV5MONDE', url: httpUrl(item.url),
        steps: Array.isArray(item.steps) ? item.steps.filter(step => Number.isInteger(step) && step >= 0 && step < 5) : [],
        revisited: item.revisited === true } : null;
    case 'speak':
      return base.date ? { ...base, topic: text(item.topic) || 'Conversation', improve: text(item.improve),
        notes: text(item.notes, 2000), level: safeLevel(item.level) } : null;
    case 'word':
      return text(item.fr) && text(item.en) ? { date: base.date, created: base.created, fr: text(item.fr),
        en: text(item.en), example: text(item.example, 2000), source: text(item.source),
        due: safeDate(item.due), interval: Math.min(32, number(item.interval)) } : null;
    case 'check':
    case 'tvstep':
    case 'milestone':
      return item.done === true ? { done: true } : null;
    case 'prefs':
      if (key === 'prefs:mode' && Object.hasOwn(labels, item.value)) return { value: item.value };
      return key === 'prefs:focus' && levels.includes(item.value) ? { value: item.value } : null;
    default:
      return null;
  }
}

async function fingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes).slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function readBackup(backup, date) {
  if (backup?.format === 'francais-journal-v2' && Array.isArray(backup.entries)) {
    if (backup.entries.length > 15000) throw Error('This backup is too large.');
    const entries = [];
    for (const entry of backup.entries) {
      if (typeof entry?.key !== 'string') throw Error('This file contains an invalid journal entry.');
      const value = cleanRecord(entry.key, entry.value);
      if (!value) throw Error('This file contains an invalid journal entry.');
      entries.push({ key: entry.key, value });
    }
    return entries;
  }
  if (!Array.isArray(backup?.logs) || !Array.isArray(backup.words)) throw Error('Choose a French tracker JSON backup.');
  const logs = backup.logs;
  const dated = (item, i) => ({ ...item, created: (item?.date || date) + 'T12:00:00Z~' + String(i).padStart(5, '0') });
  const matchCounts = new Map();
  const recordMatch = (kind, date, minutes, name) => JSON.stringify([kind, date, minutes, text(name)]);
  const entries = [];
  const counts = new Map();
  async function add(kind, item, fallbackDate) {
    const safe = cleanRecord(kind + ':legacy', item);
    if (!safe) return;
    const hashable = { ...safe };
    delete hashable.created;
    if (kind === 'word') {
      delete hashable.date;
      delete hashable.due;
    }
    const serialized = JSON.stringify([kind, hashable]);
    const occurrence = (counts.get(serialized) || 0) + 1;
    counts.set(serialized, occurrence);
    const hash = await fingerprint(serialized + ':' + occurrence);
    entries.push({ key: kind + ':legacy-' + hash, value: { ...safe, ...(fallbackDate ? { date: fallbackDate } : {}) },
      id: 'import_' + hash });
  }
  const lessons = Array.isArray(backup.tv) ? backup.tv : [];
  const speaking = Array.isArray(backup.speaking) ? backup.speaking : [];
  if (logs.length + lessons.length + speaking.length + backup.words.length > 15000) throw Error('This backup is too large.');
  for (const [i, item] of lessons.entries()) {
    const match = recordMatch('TV5MONDE', item?.date, number(item?.minutes), item?.title);
    matchCounts.set(match, (matchCounts.get(match) || 0) + 1);
    await add('tv', dated(item, i));
  }
  for (const [i, item] of speaking.entries()) {
    const match = recordMatch('Speaking', item?.date, number(item?.minutes), item?.topic);
    matchCounts.set(match, (matchCounts.get(match) || 0) + 1);
    await add('speak', dated(item, i));
  }
  const duoDates = new Map();
  for (const [i, item] of logs.entries()) {
    if (!isDate(item?.date)) continue;
    if (item.type === 'Duolingo') {
      duoDates.set(item.date, (duoDates.get(item.date) || 0) + number(item.minutes));
      continue;
    }
    const match = recordMatch(item.type, item.date, number(item.minutes), item.detail);
    if (item.detail !== 'Independent activity' && matchCounts.get(match)) {
      matchCounts.set(match, matchCounts.get(match) - 1);
      continue;
    }
    const mode = Object.keys(labels).find(key => item.type === key + ' session');
    await add('log', { ...dated(item, i), category: mode, type: mode ? labels[mode] : item.type });
  }
  for (const [day, done] of Object.entries(backup.duo || {})) {
    if (done && isDate(day) && !duoDates.has(day)) duoDates.set(day, 0);
  }
  for (const [day, minutes] of duoDates) {
    entries.push({ key: 'duo:' + day, value: { date: day, minutes, created: day + 'T12:00:00Z' },
      id: 'legacy_duo_' + day });
  }
  for (const [i, word] of backup.words.entries()) await add('word', { ...dated(word, i), due: date }, date);
  if (Object.hasOwn(labels, backup.mode)) entries.push({ key: 'prefs:mode', value: { value: backup.mode }, id: 'legacy_mode_import' });
  for (const [key, checked] of Object.entries(backup.checks || {})) {
    const match = /^(light|standard|intensive)-([0-3])$/.exec(key);
    if (match && checked) entries.push({ key: 'check:' + date + '.' + match[1] + '.' + match[2], value: { done: true } });
  }
  return entries;
}

export function journalEntries(state) {
  const entries = [...state].filter(([, value]) => value !== null).map(([key, value]) => ({ key, ...value }));
  return entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') ||
    (b.created || '').localeCompare(a.created || '') || b.key.localeCompare(a.key));
}

export function backupChanges(state, entries) {
  const additions = new Map();
  for (const entry of entries) {
    if (state.get(entry.key) || additions.has(entry.key)) continue;
    // A deleted record needs a new operation ID to restore an earlier backup.
    additions.set(entry.key, state.has(entry.key) ? { key: entry.key, value: entry.value } : entry);
  }
  return [...additions.values()];
}
