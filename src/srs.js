// Spaced repetition + interleaved session builder, tuned for a ~2-week run-up to finals.
const H = 3600e3, D = 24 * H;
// Box → next interval. Compressed Leitner: short gaps because exams are close.
const INTERVALS = [10 * 60e3, 12 * H, 1 * D, 2 * D, 4 * D, 7 * D];

export const GRADE = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };

export function daysUntil(iso, now = Date.now()) {
  return (new Date(iso).getTime() - now) / D;
}

export function activeCourses(courses, now = Date.now()) {
  // A course drops out of the mix once its exam has started.
  return courses.filter(c => daysUntil(c.exam, now) > 0);
}

export function review(state, grade, course, now = Date.now()) {
  const s = { box: 0, reps: 0, lapses: 0, correct: 0, seen: 0, ...(state || {}) };
  s.seen++;
  if (grade === GRADE.AGAIN) { s.box = 0; s.lapses++; }
  else {
    s.correct++;
    s.box = Math.min(INTERVALS.length - 1, s.box + (grade === GRADE.EASY ? 2 : grade === GRADE.HARD ? 0 : 1));
    if (grade === GRADE.HARD) s.box = Math.max(1, s.box);
  }
  s.reps++;
  let gap = INTERVALS[s.box];
  // Never schedule past the exam: cap at ~45% of remaining time so it comes back before the final.
  const left = course ? new Date(course.exam).getTime() - now : Infinity;
  if (left > 0 && grade !== GRADE.AGAIN) gap = Math.min(gap, Math.max(2 * H, left * 0.45));
  s.due = now + gap;
  s.last = now;
  s.updated = now;
  return s;
}

export function mastery(state) {
  if (!state || !state.seen) return 0;
  return Math.min(1, state.box / 4);
}

// Weight for how urgent a course is right now: nearer exam + heavier final weight → more questions.
function courseWeight(c, now) {
  const d = Math.max(0.25, daysUntil(c.exam, now));
  return (c.finalWeight / 100) * (1 / Math.sqrt(d)) * (c.boost || 1);
}

function weightedPick(items, w) {
  let total = 0; for (const it of items) total += w(it);
  let r = Math.random() * total;
  for (const it of items) { r -= w(it); if (r <= 0) return it; }
  return items[items.length - 1];
}

/**
 * Build a study session.
 * opts: { n, courseIds?, mode: 'mix'|'weak'|'new'|'cram', types? }
 */
export function buildSession(bank, progress, courses, opts = {}, now = Date.now()) {
  const n = opts.n || 10;
  let live = activeCourses(courses, now);
  if (opts.courseIds?.length) live = live.filter(c => opts.courseIds.includes(c.id));
  if (opts.mode === 'cram' && live.length) {
    live = [live.slice().sort((a, b) => new Date(a.exam) - new Date(b.exam))[0]];
  }
  const byId = Object.fromEntries(live.map(c => [c.id, c]));
  let pool = bank.filter(q => byId[q.course] && !q.retired && (!opts.types || opts.types.includes(q.type)));
  if (!pool.length) return [];

  const cw = Object.fromEntries(live.map(c => [c.id, courseWeight(c, now)]));
  const score = q => {
    const s = progress[q.id];
    let w = cw[q.course];
    if (!s || !s.seen) w *= opts.mode === 'weak' ? 0.3 : opts.mode === 'new' ? 4 : 1.4; // new
    else {
      const overdue = (now - (s.due || 0)) / D;
      if (overdue >= 0) w *= 2 + Math.min(3, overdue);           // due
      else w *= opts.mode === 'weak' ? 0.15 : 0.08;               // not due yet: rarely
      const err = s.lapses / Math.max(1, s.seen);
      w *= 1 + err * (opts.mode === 'weak' ? 6 : 2);
      if (s.last && now - s.last < 20 * 60e3) w *= 0.02;          // just saw it
    }
    return Math.max(w, 1e-6);
  };

  const picked = [];
  const remaining = pool.slice();
  while (picked.length < n && remaining.length) {
    const q = weightedPick(remaining, score);
    picked.push(q);
    remaining.splice(remaining.indexOf(q), 1);
  }
  return interleave(picked);
}

// Reorder so neighbours differ in course (then topic) whenever possible — interleaving beats blocking.
export function interleave(qs) {
  const out = [], left = qs.slice();
  while (left.length) {
    const prev = out[out.length - 1];
    let i = left.findIndex(q => !prev || (q.course !== prev.course && q.topic !== prev.topic));
    if (i < 0) i = left.findIndex(q => !prev || q.topic !== prev.topic);
    if (i < 0) i = 0;
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

export function dueCount(bank, progress, courses, now = Date.now()) {
  const live = new Set(activeCourses(courses, now).map(c => c.id));
  let due = 0, fresh = 0;
  for (const q of bank) {
    if (!live.has(q.course) || q.retired) continue;
    const s = progress[q.id];
    if (!s || !s.seen) fresh++;
    else if ((s.due || 0) <= now) due++;
  }
  return { due, fresh };
}

export function shuffleChoices(q) {
  if (q.type !== 'mcq' || q.noShuffle) return q;
  const idx = q.choices.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return { ...q, choices: idx.map(i => q.choices[i]), answer: idx.indexOf(q.answer) };
}
