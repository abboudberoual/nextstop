import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import 'katex/dist/katex.min.css';
import './style.css';
import katex from 'katex';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { store, today, streak } from './store.js';
import { buildSession, review, GRADE, dueCount, mastery, daysUntil, activeCourses, shuffleChoices } from './srs.js';
import * as notify from './notify.js';
import * as sync from './sync.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const native = Capacitor.isNativePlatform();
// Text with $inline$ / $$display$$ LaTeX → safe HTML.
const tx = v => String(v ?? '').split(/(\$\$[^$]+\$\$|\$[^$\n]+\$)/g).map(part => {
  const disp = part.startsWith('$$') && part.endsWith('$$') && part.length > 4;
  const inl = !disp && part.startsWith('$') && part.endsWith('$') && part.length > 2;
  if (!disp && !inl) return esc(part).replace(/\((sheet(?: p\.\d)?[^)]*|Lesson \d[^)]*|definition, not on the sheet|know this[^)]*|derived[^)]*)\)/g, (m, t) => `<span class="src ${t.startsWith('sheet') || t.startsWith('Lesson') ? 'sheet' : t.startsWith('know') ? 'know' : t.startsWith('derived') ? 'der' : 'def'}">${t}</span>`);
  try { return katex.renderToString(part.slice(disp ? 2 : 1, disp ? -2 : -1), { displayMode: disp, throwOnError: false, output: 'html' }); } catch { return esc(part); }
}).join('');
const buzz = (ok) => { if (native) (ok === undefined ? Haptics.impact({ style: ImpactStyle.Light }) : Haptics.notification({ type: ok ? NotificationType.Success : NotificationType.Error })).catch(() => {}); };

let BANK = [], COURSES = [], FIGS = {}, view = 'home', sess = null, filter = { courses: [], mode: 'mix' };

// ---------- data ----------
async function loadBank() {
  let bundled = { version: 0, courses: [], questions: [] };
  try { bundled = await (await fetch('./bank.json', { cache: 'no-store' })).json(); } catch {}
  const cached = store.cachedBank();
  const b = cached && cached.version >= bundled.version ? cached : bundled;
  COURSES = b.courses; BANK = b.questions; FIGS = b.figures || {};
  if (b === bundled) store.saveBank(bundled);
}

async function doSync(quiet = true) {
  try {
    const meta = await sync.pullMeta();
    if (meta?.courses) COURSES = meta.courses;
    if (meta?.figures) FIGS = { ...FIGS, ...meta.figures };
    const merged = await sync.pullBank(BANK);
    if (merged) BANK = merged;
    if (meta || merged) { const c = store.cachedBank() || {}; store.saveBank({ ...c, courses: COURSES, questions: BANK, figures: FIGS }); }
    const r = await sync.syncProgress();
    if (!quiet) toast(r.ok ? `Synced · ${r.pushed} up, ${r.merged} down` : `Sync: ${r.reason}`);
    if (r.ok && view === 'home') render();
  } catch (e) { if (!quiet) toast('Sync failed: ' + e.message); }
}

const course = id => COURSES.find(c => c.id === id);
const col = c => `var(--${c?.colorName === 'blue' ? 'blue-line' : (c?.colorName || 'ink')})`;
const lightText = c => c && ['yellow'].includes(c.colorName);
const allDaily = () => {
  const out = { ...store.daily };
  for (const [d, r] of Object.entries(store.remoteDaily || {})) {
    const l = out[d] || { answered: 0, correct: 0 };
    out[d] = { answered: l.answered + r.answered, correct: l.correct + r.correct };
  }
  return out;
};

// ---------- home ----------
function metroSVG() {
  const live = COURSES.slice().sort((a, b) => new Date(a.exam) - new Date(b.exam));
  if (!live.length) return '';
  const now = Date.now(), W = 360, H = 112, y = 52, x0 = 14;
  const xs = live.map((_, i) => live.length === 1 ? W - 50 : 70 + (W - 50 - 70) * i / (live.length - 1));
  // "you" sits between the last finished exam and the next one, proportionally by time.
  let me = x0, prevT = now - 3 * 864e5, prevX = x0;
  for (let i = 0; i < live.length; i++) {
    const t = new Date(live[i].exam).getTime();
    if (t <= now) { prevT = t; prevX = xs[i]; me = xs[i]; continue; }
    me = prevX + (xs[i] - prevX) * Math.min(.85, Math.max(0, (now - prevT) / (t - prevT)));
    break;
  }
  let px = x0, segs = '';
  live.forEach((c, i) => { segs += `<line x1="${px}" y1="${y}" x2="${xs[i]}" y2="${y}" stroke="${col(c)}" stroke-width="9" stroke-linecap="round"/>`; px = xs[i]; });
  const st = live.map((c, i) => {
    const t = new Date(c.exam).getTime(), past = t < now, d = Math.ceil(daysUntil(c.exam, now)), up = i % 2 === 1;
    const day = new Date(c.exam).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `<g opacity="${past ? .35 : 1}"><circle cx="${xs[i]}" cy="${y}" r="10" fill="var(--bg)" stroke="${col(c)}" stroke-width="5.5"/>
      <text x="${xs[i]}" y="${up ? y - 30 : y + 30}" text-anchor="middle" class="d">${esc(c.code)}</text>
      <text x="${xs[i]}" y="${up ? y - 16 : y + 44}" text-anchor="middle" style="fill:var(--mute)">${past ? 'done' : esc(day) + ' · ' + (d <= 0 ? 'today' : d + 'd')}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Days until each final">${segs}${st}
    <circle cx="${me}" cy="${y}" r="8" fill="var(--ink)"/><circle cx="${me}" cy="${y}" r="3.5" fill="var(--bg)"/>
    <text x="${me}" y="${y - 16}" text-anchor="middle" class="d">you</text></svg>`;
}

function home() {
  const daily = allDaily();
  const done = daily[today()]?.answered || 0, goal = store.settings.dailyGoal;
  const st = streak(daily, goal);
  const { due, fresh } = dueCount(BANK, store.progress, COURSES);
  const next = activeCourses(COURSES).sort((a, b) => new Date(a.exam) - new Date(b.exam))[0];
  const pct = Math.min(1, done / goal), R = 36, C = 2 * Math.PI * R;
  const modes = [['mix', 'Mixed'], ['weak', 'Weak spots'], ['new', 'New only'], ['cram', 'Next exam']];
  app.innerHTML = `
    <h1>${next ? `${esc(next.code)} in ${Math.ceil(daysUntil(next.exam))} days` : 'All finals done'}</h1>
    <div class="mute">${next ? esc(next.name) + ' · ' + new Date(next.exam).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (next.room ? ' · ' + esc(next.room) : '') : 'Nice work.'}</div>
    <div class="metro">${metroSVG()}</div>
    <div class="today">
      <svg class="ring" viewBox="0 0 84 84"><circle cx="42" cy="42" r="${R}" fill="none" stroke="var(--line)" stroke-width="9"/>
        <circle cx="42" cy="42" r="${R}" fill="none" stroke="${pct >= 1 ? 'var(--ok)' : 'var(--accent)'}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C * pct} ${C}" transform="rotate(-90 42 42)"/>
        <text x="42" y="48" text-anchor="middle" >${done}</text></svg>
      <div><div class="big">${done} / ${goal}</div><div class="mute">today · ${st}-day streak</div>
        <div class="small mute">${due} due for review · ${fresh} not seen yet</div></div>
    </div>
    <button class="cta" id="go">Start ${store.settings.sessionSize} questions</button>
    <div class="chips" role="group" aria-label="Mode">${modes.map(([k, l]) => `<button class="chip" data-mode="${k}" aria-pressed="${filter.mode === k}">${l}</button>`).join('')}
      <button class="chip" id="q5">Quick 5</button></div>
    <h2>Courses</h2>
    <div>${COURSES.map(c => {
      const qs = BANK.filter(q => q.course === c.id && !q.retired);
      const m = qs.length ? qs.reduce((a, q) => a + mastery(store.progress[q.id]), 0) / qs.length : 0;
      const seen = qs.filter(q => store.progress[q.id]?.seen).length;
      const on = filter.courses.includes(c.id), past = daysUntil(c.exam) <= 0;
      return `<div class="course" style="opacity:${past ? .45 : 1}"><span class="dot" style="background:${col(c)}"></span>
        <div><div class="row"><b>${esc(c.code)}</b><span class="mute small">${esc(c.name)}</span></div>
        <div class="small mute">${seen}/${qs.length} seen · ${Math.round(m * 100)}% mastered · final ${c.finalWeight}%</div>
        <div class="bar"><i style="width:${m * 100}%;background:${col(c)}"></i></div></div>
        <button data-course="${esc(c.id)}" aria-pressed="${on}" ${past ? 'disabled' : ''}>${on ? 'Only this ✓' : 'Only this'}</button></div>`;
    }).join('')}</div>
    <p class="small mute">Questions mix across courses by default, weighted toward the nearest exam and the biggest final weight. Anything you miss comes back within the session, then again over the next days.</p>
  ` + nav();
  $('#go').onclick = () => start({ n: store.settings.sessionSize, mode: filter.mode, courseIds: filter.courses });
  $('#q5').onclick = () => start({ n: 5, mode: 'mix', courseIds: filter.courses });
  app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { filter.mode = b.dataset.mode; render(); });
  app.querySelectorAll('[data-course]').forEach(b => b.onclick = () => {
    const id = b.dataset.course; filter.courses = filter.courses.includes(id) ? filter.courses.filter(x => x !== id) : [...filter.courses, id]; render();
  });
  bindNav();
}

// ---------- session ----------
function start(opts, firstQid) {
  let qs = buildSession(BANK, store.progress, COURSES, opts);
  if (firstQid) { const q = BANK.find(x => x.id === firstQid); if (q) qs = [q, ...qs.filter(x => x.id !== firstQid)].slice(0, opts.n || 10); }
  if (!qs.length) return toast('No questions available for that filter.');
  sess = { qs: qs.map(shuffleChoices), i: 0, results: [], requeued: new Set(), tried: new Set(), answered: false, started: Date.now() };
  view = 'q'; render();
}

function question() {
  const q = sess.qs[sess.i], c = course(q.course);
  const tagStyle = `background:${col(c)}`;
  let body = '';
  if (q.type === 'mcq') body = `<div class="choices">${q.choices.map((t, i) => `<button class="choice" data-i="${i}">${tx(t)}</button>`).join('')}</div>`;
  else if (q.type === 'tf') body = `<div class="choices tf"><button class="choice" data-i="true">True</button><button class="choice" data-i="false">False</button></div>`;
  else body = `<textarea id="draft" placeholder="Answer in your head or jot a few words…"></textarea>`;
  app.innerHTML = `
    <div class="qtop"><button class="x" id="quit" aria-label="End session">×</button>
      <div class="prog"><i style="width:${sess.i / sess.qs.length * 100}%"></i></div><span class="small mute num">${sess.i + 1}/${sess.qs.length}</span></div>
    <span class="tag" style="--c:${col(c)}">${esc(c?.code)} · ${esc(q.topic)}</span>
    ${q.figure && FIGS[q.figure] ? `<div class="figq">${FIGS[q.figure]}</div>` : ''}
    <div class="qtext">${tx(q.question)}</div>
    ${body}
    <div id="after"></div>
    <div class="dock"><div class="in" id="dock">${q.type === 'short' ? '<button class="cta" id="reveal">Show answer</button>' : ''}</div></div>`;
  $('#quit').onclick = () => finish();
  app.querySelectorAll('.choice').forEach(b => b.onclick = () => answerChoice(q, b));
  const rv = $('#reveal'); if (rv) rv.onclick = () => revealShort(q);
}

function explain(q, ok) {
  const src = q.source ? `<div class="srcline">${esc(q.source)}</div>` : '';
  const cls = ok === undefined ? 'model' : ok ? 'good' : 'wrong';
  return `<div class="reveal ${cls}"><b>${ok === undefined ? 'Why' : ok ? 'Correct' : 'Not quite'}</b>${tx(q.explanation || '')}${src}</div>`;
}

function answerChoice(q, btn) {
  if (sess.answered) return;
  sess.answered = true;
  const pick = q.type === 'tf' ? btn.dataset.i === 'true' : Number(btn.dataset.i);
  const ok = pick === q.answer;
  app.querySelectorAll('.choice').forEach(b => {
    b.disabled = true;
    const v = q.type === 'tf' ? b.dataset.i === 'true' : Number(b.dataset.i);
    if (v === q.answer) b.classList.add('ok'); else if (b === btn) b.classList.add('bad');
  });
  buzz(ok);
  $('#after').innerHTML = (sess.tried.has(q.id) ? '<div class="small mute" style="margin-top:10px">Retry. Only your first try counts.</div>' : '') + explain(q, ok);
  let grade = ok ? GRADE.GOOD : GRADE.AGAIN;
  $('#dock').innerHTML = (ok ? '<button class="ghost" id="guess" aria-pressed="false">I guessed</button>' : '') + '<button class="cta" id="next">Next</button>';
  const g = $('#guess'); if (g) g.onclick = () => { const on = g.getAttribute('aria-pressed') !== 'true'; g.setAttribute('aria-pressed', on); g.textContent = on ? 'Guessed ✓' : 'I guessed'; grade = on ? GRADE.HARD : GRADE.GOOD; };
  $('#next').onclick = () => commit(q, grade, ok);
}

function revealShort(q) {
  $('#after').innerHTML = explain(q) + (q.keywords?.length ? `<div class="small mute" style="margin-top:8px">Key points: ${q.keywords.map(tx).join(' · ')}</div>` : '');
  const a = q.answer ? `<div class="reveal good"><b>Answer</b>${tx(q.answer)}</div>` : '';
  $('#after').innerHTML = a + $('#after').innerHTML;
  $('#dock').innerHTML = `<div class="grades" style="width:100%;margin:0"><button class="g0" data-g="0">Missed</button><button class="g1" data-g="1">Partly</button><button class="g2" data-g="2">Got it</button></div>`;
  app.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { const g = Number(b.dataset.g); commit(q, g, g > 0); });
  $('#after').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function commit(q, grade, ok) {
  // Only the first try at a card counts (score and spaced repetition). The in-session retry is practice.
  const first = !sess.tried.has(q.id);
  sess.tried.add(q.id);
  if (first) store.setState(q.id, review(store.progress[q.id], grade, course(q.course)));
  const before = store.daily[today()]?.answered || 0;
  store.logAnswer(ok);
  if (before < store.settings.dailyGoal && before + 1 >= store.settings.dailyGoal) { notify.goalReached(); toast('Daily goal hit 🎯'); }
  if (first) sess.results.push({ id: q.id, ok, course: q.course });
  // Missed → see it again a few cards later (once).
  if (!ok && !sess.requeued.has(q.id)) { sess.requeued.add(q.id); sess.qs.splice(Math.min(sess.qs.length, sess.i + 4), 0, shuffleChoices(BANK.find(x => x.id === q.id))); }
  sess.answered = false;
  sess.i++;
  if (sess.i >= sess.qs.length) finish(); else { render(); window.scrollTo(0, 0); }
}

function finish() {
  const r = sess?.results || [];
  if (!r.length) { sess = null; view = 'home'; return render(); }
  const ok = r.filter(x => x.ok).length;
  const by = {};
  for (const x of r) { by[x.course] ??= { n: 0, ok: 0 }; by[x.course].n++; if (x.ok) by[x.course].ok++; }
  const mins = Math.max(1, Math.round((Date.now() - sess.started) / 60e3));
  view = 'done';
  app.innerHTML = `<h1>${ok}/${r.length} correct</h1><div class="small mute">First tries only.</div><div class="mute">${mins} min · ${store.daily[today()]?.answered || 0} answered today</div>
    <h2>By course</h2>${Object.entries(by).map(([id, v]) => { const c = course(id); return `<div class="topic"><span><b>${esc(c?.code)}</b></span>
      <div class="bar"><i style="width:${v.ok / v.n * 100}%;background:${col(c)}"></i></div><span class="num">${v.ok}/${v.n}</span></div>`; }).join('')}
    <div class="dock"><div class="in"><button class="ghost" id="home">Home</button><button class="cta" id="again">Another ${store.settings.sessionSize}</button></div></div>`;
  $('#home').onclick = () => { view = 'home'; render(); };
  $('#again').onclick = () => start({ n: store.settings.sessionSize, mode: filter.mode, courseIds: filter.courses });
  sess = null;
  doSync(); notify.reschedule(BANK, COURSES).catch(() => {});
}

// ---------- stats ----------
function stats() {
  const daily = allDaily(), goal = store.settings.dailyGoal;
  const days = [...Array(14)].map((_, i) => today(Date.now() - (13 - i) * 864e5));
  const max = Math.max(goal, ...days.map(d => daily[d]?.answered || 0));
  app.innerHTML = `<h1>Progress</h1><div class="mute">Last 14 days · goal ${goal}/day</div>
    <div class="bars">${days.map(d => { const n = daily[d]?.answered || 0; return `<div class="${n >= goal ? 'goal' : ''}" style="height:${n / max * 100}%" title="${d}: ${n}"></div>`; }).join('')}</div>
    ${COURSES.map(c => {
      const topics = {};
      for (const q of BANK.filter(q => q.course === c.id && !q.retired)) { (topics[q.topic] ??= []).push(q); }
      return `<h2 class="row"><span class="dot" style="background:${col(c)};min-height:18px"></span>${esc(c.code)}</h2>` + Object.entries(topics).map(([t, qs]) => {
        const m = qs.reduce((a, q) => a + mastery(store.progress[q.id]), 0) / qs.length;
        return `<div class="topic"><span>${esc(t)}</span><div class="bar"><i style="width:${m * 100}%;background:${col(c)}"></i></div><span class="num small">${Math.round(m * 100)}%</span></div>`;
      }).join('');
    }).join('')}` + nav();
  bindNav();
}

// ---------- settings ----------
const DN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function settings() {
  const s = store.settings;
  app.innerHTML = `<h1>Settings</h1>
    <label class="f">Daily goal (questions)<input type="number" id="goal" min="10" max="500" value="${s.dailyGoal}"></label>
    <label class="f">Questions per session<input type="number" id="size" min="3" max="50" value="${s.sessionSize}"></label>
    <h2>Nudges</h2>
    <label class="row"><input type="checkbox" id="notify" ${s.notify ? 'checked' : ''} style="min-height:0;width:22px;height:22px"> Send study notifications</label>
    <p class="small mute">Each nudge carries a real question from your due pile. Set these to your commute and other dead time.</p>
    <div id="nudges">${s.nudges.map((n, i) => `<div class="nudge"><input type="time" data-t="${i}" value="${n.time}"><div><input data-l="${i}" value="${esc(n.label)}" style="width:100%">
      <div class="days" style="margin-top:6px">${DN.map((d, j) => `<button data-n="${i}" data-d="${j}" aria-pressed="${n.days.includes(j)}" aria-label="${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][j]}">${d}</button>`).join('')}</div></div>
      <button class="x" data-del="${i}" aria-label="Remove nudge">×</button></div>`).join('')}</div>
    <button class="chip" id="add">Add nudge</button>
    <label class="f">Streak reminder (if goal not met)<input type="time" id="streak" value="${s.streakReminder}"></label>
    <div class="row"><label class="f" style="flex:1">Quiet from<input type="time" id="qs" value="${s.quietStart}"></label><label class="f" style="flex:1">until<input type="time" id="qe" value="${s.quietEnd}"></label></div>
    <button class="chip" id="test">Send a test nudge in 10 s</button>
    <h2>Sync</h2><div id="acct" class="note">Checking…</div>
    <details style="margin-top:10px"><summary class="small mute">Server settings</summary>
      <label class="f">Supabase URL<input id="surl" value="${esc(s.supabaseUrl)}" placeholder="built-in"></label>
      <label class="f">Anon key<input id="skey" value="${esc(s.supabaseKey)}" placeholder="built-in"></label></details>
    <p class="small mute">${BANK.length} questions · device ${esc(store.device)}</p>` + nav();
  const save = () => { store.saveSettings(); notify.reschedule(BANK, COURSES).catch(() => {}); };
  $('#goal').onchange = e => { s.dailyGoal = Math.max(10, +e.target.value || 60); save(); };
  $('#size').onchange = e => { s.sessionSize = Math.min(50, Math.max(3, +e.target.value || 10)); save(); };
  $('#notify').onchange = async e => { s.notify = e.target.checked; if (s.notify) await notify.ensurePermission(); save(); };
  $('#streak').onchange = e => { s.streakReminder = e.target.value; save(); };
  $('#qs').onchange = e => { s.quietStart = e.target.value; save(); };
  $('#qe').onchange = e => { s.quietEnd = e.target.value; save(); };
  $('#surl').onchange = e => { s.supabaseUrl = e.target.value.trim(); save(); };
  $('#skey').onchange = e => { s.supabaseKey = e.target.value.trim(); save(); };
  app.querySelectorAll('[data-t]').forEach(el => el.onchange = () => { s.nudges[+el.dataset.t].time = el.value; save(); });
  app.querySelectorAll('[data-l]').forEach(el => el.onchange = () => { s.nudges[+el.dataset.l].label = el.value; save(); });
  app.querySelectorAll('[data-n]').forEach(el => el.onclick = () => { const n = s.nudges[+el.dataset.n], d = +el.dataset.d; n.days = n.days.includes(d) ? n.days.filter(x => x !== d) : [...n.days, d]; save(); render(); });
  app.querySelectorAll('[data-del]').forEach(el => el.onclick = () => { s.nudges.splice(+el.dataset.del, 1); save(); render(); });
  $('#add').onclick = () => { s.nudges.push({ time: '12:00', days: [1, 2, 3, 4, 5], label: 'Dead time' }); save(); render(); };
  $('#test').onclick = async () => {
    if (!native) return toast('Notifications work in the Android app.');
    await notify.ensurePermission();
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const q = buildSession(BANK.filter(x => x.type === 'tf'), store.progress, COURSES, { n: 1 })[0];
    await LocalNotifications.schedule({ notifications: [{ id: 77, channelId: 'study', actionTypeId: 'nudge', title: 'Test nudge', body: q ? 'True or false: ' + q.question : 'It works.', schedule: { at: new Date(Date.now() + 10e3), allowWhileIdle: true }, extra: { qid: q?.id } }] });
    toast('Lock your phone — nudge in 10 s');
  };
  account();
  bindNav();
}

async function account() {
  const el = $('#acct'); if (!el) return;
  if (!sync.supa()) { el.innerHTML = 'Sync isn\'t set up in this build. Progress is saved on this device.'; return; }
  const s = await sync.session();
  if (s) {
    el.innerHTML = `Signed in as <b>${esc(s.user.email)}</b>. Progress syncs with the Claude study page.<div class="row" style="margin-top:10px"><button class="chip" id="now">Sync now</button><button class="chip" id="out">Sign out</button></div>`;
    $('#now').onclick = () => doSync(false);
    $('#out').onclick = async () => { await sync.signOut(); account(); };
  } else {
    el.innerHTML = `<label class="f">Email<input id="em" type="email" autocomplete="email"></label><label class="f">Password<input id="pw" type="password" autocomplete="current-password"></label>
      <div class="row"><button class="chip" id="in">Sign in</button><button class="chip" id="up">Create account</button></div>`;
    const go = async create => { try { await sync.signIn($('#em').value.trim(), $('#pw').value, create); toast(create ? 'Account created — check email if asked to confirm' : 'Signed in'); await doSync(false); account(); } catch (e) { toast(e.message); } };
    $('#in').onclick = () => go(false); $('#up').onclick = () => go(true);
  }
}

// ---------- shell ----------
function nav() {
  const t = [['home', 'Study'], ['stats', 'Progress'], ['settings', 'Settings']];
  return `<nav><div class="in">${t.map(([k, l]) => `<button data-v="${k}" ${view === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</div></nav>`;
}
function bindNav() { app.querySelectorAll('nav [data-v]').forEach(b => b.onclick = () => { view = b.dataset.v; render(); window.scrollTo(0, 0); }); }
function render() { ({ home, stats, settings, q: question }[view] || home)(); }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

(async function boot() {
  await loadBank();
  render();
  if (native) {
    notify.onTap(({ qid, mode, course: cid, quick }) => {
      if (mode === 'cram') start({ n: 15, mode: 'weak', courseIds: [cid] });
      else start({ n: quick ? 5 : store.settings.sessionSize, mode: 'mix' }, qid);
    });
    App.addListener('backButton', () => { if (view === 'q') finish(); else if (view !== 'home') { view = 'home'; render(); } else App.exitApp(); });
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) notify.reschedule(BANK, COURSES).catch(() => {});
      else { doSync(); if (view === 'home') render(); }
    });
    if (store.settings.notify && await notify.ensurePermission()) notify.reschedule(BANK, COURSES).catch(() => {});
  }
  doSync();
})();
