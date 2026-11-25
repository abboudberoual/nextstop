// Fails the build if any question is malformed. Run: npm run validate [path]
import { readFileSync } from 'node:fs';
const path = process.argv[2] || 'public/bank.json';
const b = JSON.parse(readFileSync(path, 'utf8'));
const errs = [], ids = new Set(), courses = new Set(b.courses.map(c => c.id));
for (const c of b.courses) {
  if (isNaN(new Date(c.exam))) errs.push(`${c.id}: bad exam date`);
  if (!['green', 'orange', 'blue', 'yellow'].includes(c.colorName)) errs.push(`${c.id}: colorName`);
}
for (const q of b.questions) {
  const w = m => errs.push(`${q.id || '(no id)'}: ${m}`);
  if (!q.id) w('missing id'); else if (ids.has(q.id)) w('duplicate id'); else ids.add(q.id);
  if (!courses.has(q.course)) w(`unknown course ${q.course}`);
  if (!q.topic) w('missing topic');
  if (!q.question?.trim()) w('missing question');
  if (!q.explanation?.trim()) w('missing explanation');
  if (((q.question || '') + (q.explanation || '')).split('$').length % 2 === 0) w('unbalanced $ math');
  if (q.type === 'mcq') {
    if (!Array.isArray(q.choices) || q.choices.length < 3 || q.choices.length > 5) w('mcq needs 3–5 choices');
    else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) w('mcq answer index out of range');
    else if (new Set(q.choices).size !== q.choices.length) w('duplicate choices');
  } else if (q.type === 'tf') { if (typeof q.answer !== 'boolean') w('tf answer must be true/false'); }
  else if (q.type === 'short') { if (!q.answer?.trim()) w('short answer missing'); }
  else w(`bad type ${q.type}`);
}
const by = {};
for (const q of b.questions) { by[q.course] ??= { mcq: 0, tf: 0, short: 0 }; by[q.course][q.type]++; }
console.table(by);
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log(`OK: ${b.questions.length} questions`);
