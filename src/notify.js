// Local notifications: commute nudges with a real question as the hook, exam countdowns, streak saver.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { store, today } from './store.js';
import { activeCourses, daysUntil, buildSession } from './srs.js';

const native = () => Capacitor.isNativePlatform();
const STREAK_ID = 9001;

export async function ensurePermission() {
  if (!native()) return false;
  let p = await LocalNotifications.checkPermissions();
  if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
  try { await LocalNotifications.createChannel({ id: 'study', name: 'Study nudges', importance: 4, vibration: true }); } catch {}
  try {
    await LocalNotifications.registerActionTypes({ types: [{ id: 'nudge', actions: [
      { id: 'quick5', title: 'Quick 5' }, { id: 'snooze', title: 'In 20 min' },
    ] }] });
  } catch {}
  return p.display === 'granted';
}

function at(dayOffset, hhmm, base = new Date()) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0);
  return d;
}

function inQuiet(d) {
  const mins = d.getHours() * 60 + d.getMinutes();
  const [qs, qe] = [store.settings.quietStart, store.settings.quietEnd].map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
  return qs > qe ? (mins >= qs || mins < qe) : (mins >= qs && mins < qe);
}

function teaser(q) {
  if (!q) return null;
  if (q.question.includes('$')) return `${q.topic}: a question is waiting for you.`;
  if (q.type === 'tf') return `True or false: ${q.question}`;
  const t = q.question.length > 140 ? q.question.slice(0, 137) + '…' : q.question;
  return t;
}

export async function reschedule(bank, courses) {
  if (!native() || !store.settings.notify) return;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });

  const live = activeCourses(courses);
  if (!live.length) return;
  const list = [];
  const now = new Date();
  let id = 100;
  // Pre-pick teaser questions: prefer T/F and short MCQ stems that fit in a notification.
  const plain = q => !q.question.includes('$') && (q.type === 'tf' || (q.type === 'mcq' && q.question.length < 160));
  let hooks = buildSession(bank.filter(plain), store.progress, courses, { n: 40 });
  if (!hooks.length) hooks = buildSession(bank, store.progress, courses, { n: 40 });
  let h = 0;

  for (let day = 0; day < 7 && list.length < 55; day++) {
    for (const nd of store.settings.nudges) {
      const when = at(day, nd.time, now);
      if (!nd.days.includes(when.getDay()) || when <= now || inQuiet(when)) continue;
      const next = live.filter(c => daysUntil(c.exam, when.getTime()) > 0).sort((a, b) => new Date(a.exam) - new Date(b.exam))[0];
      if (!next) continue;
      const days = Math.ceil(daysUntil(next.exam, when.getTime()));
      const q = hooks[h++ % Math.max(1, hooks.length)];
      list.push({
        id: id++, channelId: 'study', actionTypeId: 'nudge',
        title: `${next.code} final in ${days} day${days === 1 ? '' : 's'} · ${nd.label}`,
        body: teaser(q) || 'Five questions before your stop?',
        largeBody: teaser(q) || undefined,
        schedule: { at: when, allowWhileIdle: true },
        extra: { qid: q?.id || null },
      });
    }
    // Exam-eve heads-up.
    for (const c of live) {
      const eve = at(day, '19:30', now);
      const d = daysUntil(c.exam, eve.getTime());
      if (d > 0.5 && d < 1.5 && eve > now) list.push({
        id: id++, channelId: 'study', title: `${c.code} final tomorrow`,
        body: 'Run a 15-question cram on your weakest topics, then sleep.', schedule: { at: eve, allowWhileIdle: true }, extra: { mode: 'cram', course: c.id },
      });
    }
  }
  await scheduleStreak(list);
  if (list.length) await LocalNotifications.schedule({ notifications: list });
}

async function scheduleStreak(list) {
  const done = store.daily[today()]?.answered || 0;
  const goal = store.settings.dailyGoal;
  const when = at(0, store.settings.streakReminder);
  if (done < goal && when > new Date()) list.push({
    id: STREAK_ID, channelId: 'study', title: `${goal - done} questions left today`,
    body: done ? `You're at ${done}/${goal}. Finish it off before bed.` : 'Nothing logged today yet. Ten minutes keeps the streak alive.',
    schedule: { at: when, allowWhileIdle: true }, extra: { mode: 'quick' },
  });
}

export async function goalReached() {
  if (native()) try { await LocalNotifications.cancel({ notifications: [{ id: STREAK_ID }] }); } catch {}
}

export function onTap(handler) {
  if (!native()) return;
  LocalNotifications.addListener('localNotificationActionPerformed', async ev => {
    const extra = ev.notification.extra || {};
    if (ev.actionId === 'snooze') {
      await LocalNotifications.schedule({ notifications: [{ ...ev.notification, id: Math.floor(Math.random() * 1e6) + 20000, schedule: { at: new Date(Date.now() + 20 * 60e3) } }] });
      return;
    }
    handler({ ...extra, quick: ev.actionId === 'quick5' });
  });
}
