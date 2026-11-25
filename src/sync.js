// Two-way sync with Supabase. Last-writer-wins per question (by state.updated).
import { createClient } from '@supabase/supabase-js';
import { store } from './store.js';
import { CONFIG } from './config.js';

let client = null;

export function supa() {
  const url = store.settings.supabaseUrl || CONFIG.supabaseUrl;
  const key = store.settings.supabaseKey || CONFIG.supabaseKey;
  if (!url || !key) return null;
  if (!client || client.supabaseUrl !== url) client = createClient(url, key, { auth: { persistSession: true, storageKey: 'fs.auth' } });
  return client;
}

export async function session() {
  const c = supa(); if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}

export async function signIn(email, password, create = false) {
  const c = supa(); if (!c) throw new Error('Sync is not configured yet.');
  const fn = create ? c.auth.signUp.bind(c.auth) : c.auth.signInWithPassword.bind(c.auth);
  const { data, error } = await fn({ email, password });
  if (error) throw error;
  return data.session;
}

export async function signOut() { const c = supa(); if (c) await c.auth.signOut(); }

/** Course list and sketches (a new semester only needs a new bank.json import). */
export async function pullMeta() {
  const c = supa(); if (!c) return null;
  const since = new Date(store.meta.metaPulled || 0).toISOString();
  const { data, error } = await c.from('bank_meta').select('key,value,updated_at').gt('updated_at', since);
  if (error || !data?.length) return null;
  const out = {};
  for (const r of data) { out[r.key] = r.value; store.meta.metaPulled = Math.max(store.meta.metaPulled || 0, new Date(r.updated_at).getTime()); }
  store.saveMeta();
  return out;
}

/** Pull newer questions from the shared bank. Returns merged bank or null. */
export async function pullBank(bank) {
  const c = supa(); if (!c) return null;
  const since = new Date(store.meta.bankPulled || 0).toISOString();
  const { data, error } = await c.from('questions').select('id,course,topic,type,data,retired,updated_at').gt('updated_at', since).limit(5000);
  if (error || !data?.length) return null;
  const map = new Map(bank.map(q => [q.id, q]));
  let max = store.meta.bankPulled || 0;
  for (const r of data) {
    map.set(r.id, { ...r.data, id: r.id, course: r.course, topic: r.topic, type: r.type, retired: r.retired });
    max = Math.max(max, new Date(r.updated_at).getTime());
  }
  store.meta.bankPulled = max; store.saveMeta();
  return [...map.values()];
}

/** Push dirty progress, pull remote changes, merge. */
export async function syncProgress() {
  const c = supa(); if (!c) return { ok: false, reason: 'not configured' };
  const s = await session(); if (!s) return { ok: false, reason: 'signed out' };
  const uid = s.user.id;

  const ids = [...store.dirty].filter(id => id !== '__daily');
  if (ids.length) {
    const rows = ids.filter(id => store.progress[id]).map(id => ({
      user_id: uid, qid: id, state: store.progress[id], updated_at: new Date(store.progress[id].updated || Date.now()).toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await c.from('progress').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,qid' });
      if (error) return { ok: false, reason: error.message };
    }
  }
  if (store.dirty.has('__daily')) {
    const rows = Object.entries(store.daily).map(([day, r]) => ({ user_id: uid, device: store.device, day, answered: r.answered, correct: r.correct }));
    const { error } = await c.from('daily').upsert(rows, { onConflict: 'user_id,device,day' });
    if (error) return { ok: false, reason: error.message };
  }
  store.dirty.clear(); store.saveProgress();

  const since = new Date(store.meta.lastPull || 0).toISOString();
  const { data, error } = await c.from('progress').select('qid,state,updated_at').eq('user_id', uid).gt('updated_at', since).limit(10000);
  if (error) return { ok: false, reason: error.message };
  let max = store.meta.lastPull || 0, merged = 0;
  for (const r of data || []) {
    const local = store.progress[r.qid];
    if (!local || (r.state.updated || 0) > (local.updated || 0)) { store.progress[r.qid] = r.state; merged++; }
    max = Math.max(max, new Date(r.updated_at).getTime());
  }
  store.meta.lastPull = max; store.saveMeta(); store.saveProgress();

  // Other devices' daily counts, for a shared streak.
  const { data: days } = await c.from('daily').select('device,day,answered,correct').eq('user_id', uid).neq('device', store.device);
  store.remoteDaily = {};
  for (const r of days || []) {
    const d = store.remoteDaily[r.day] || { answered: 0, correct: 0 };
    d.answered += r.answered; d.correct += r.correct; store.remoteDaily[r.day] = d;
  }
  return { ok: true, merged, pushed: ids.length };
}
