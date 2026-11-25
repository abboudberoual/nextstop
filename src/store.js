// Local-first storage. Everything works offline; sync.js reconciles with Supabase when configured.
const K = { progress: 'fs.progress', settings: 'fs.settings', daily: 'fs.daily', bank: 'fs.bank', meta: 'fs.meta', device: 'fs.device' };

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

export const DEFAULT_SETTINGS = {
  dailyGoal: 60,
  sessionSize: 10,
  notify: true,
  // Commute / dead-time nudges. days: 0=Sun..6=Sat
  nudges: [
    { time: '08:05', days: [1, 2, 3, 4, 5], label: 'Morning commute' },
    { time: '12:40', days: [1, 2, 3, 4, 5], label: 'Lunch' },
    { time: '17:40', days: [1, 2, 3, 4, 5], label: 'Ride home' },
    { time: '10:30', days: [0, 6], label: 'Weekend warm-up' },
    { time: '15:30', days: [0, 6], label: 'Afternoon set' },
  ],
  streakReminder: '21:00',
  quietStart: '23:00',
  quietEnd: '07:30',
  supabaseUrl: '',
  supabaseKey: '',
  boost: {},          // courseId → multiplier set from the UI
};

export const store = {
  progress: read(K.progress, {}),
  settings: { ...DEFAULT_SETTINGS, ...read(K.settings, {}) },
  daily: read(K.daily, {}),       // 'YYYY-MM-DD' → { answered, correct }
  meta: read(K.meta, { lastPull: 0, bankVersion: 0 }),
  device: read(K.device, null) || (() => { const id = 'd' + Math.random().toString(36).slice(2, 10); write(K.device, id); return id; })(),
  dirty: new Set(read('fs.dirty', [])),

  saveProgress() { write(K.progress, this.progress); write('fs.dirty', [...this.dirty]); },
  saveSettings() { write(K.settings, this.settings); },
  saveDaily() { write(K.daily, this.daily); },
  saveMeta() { write(K.meta, this.meta); },
  cachedBank() { return read(K.bank, null); },
  saveBank(b) { write(K.bank, b); },

  setState(qid, s) { this.progress[qid] = s; this.dirty.add(qid); this.saveProgress(); },

  logAnswer(ok) {
    const d = today();
    const r = this.daily[d] || { answered: 0, correct: 0 };
    r.answered++; if (ok) r.correct++;
    r.updated = Date.now();
    this.daily[d] = r; this.dirty.add('__daily'); this.saveDaily(); this.saveProgress();
  },
};

export function today(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function streak(daily, goal) {
  // Consecutive days hitting at least a third of the goal; today counts if already hit, otherwise it doesn't break the streak yet.
  const min = Math.max(5, Math.round(goal / 3));
  let n = 0, t = Date.now();
  const hit = d => (daily[d]?.answered || 0) >= min;
  if (hit(today(t))) n++;
  for (let i = 1; i < 400; i++) {
    const d = today(t - i * 864e5);
    if (hit(d)) n++; else break;
  }
  return n;
}
