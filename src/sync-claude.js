// Sync adapter for the Claude-page build (VITE_TARGET=claude). A claude.ai page can't reach Supabase directly,
// so it goes through the viewer's Supabase connector (execute_sql) via the page's `mcp` capability.
// Same exports as sync.js, so main.js doesn't care which one it gets.
import { store } from './store.js';

export const mode = 'claude';
const PROJECT = 'koezutepgxjcmcbicahu';
const SERVER = 'Supabase';
let mcpP = null;
const mcp = () => (mcpP ||= (window.claude?.use ? window.claude.use('mcp') : Promise.resolve(null)));

// Dollar-quote a value for SQL with a tag that can't appear inside it.
function lit(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  let tag = 'q'; while (s.includes(`$${tag}$`)) tag += 'q';
  return `$${tag}$${s}$${tag}$`;
}

async function sql(query) {
  const m = await mcp();
  if (!m) throw new Error('Open this page in Claude with the Supabase connector to sync.');
  const res = await m.callTool(SERVER, 'execute_sql', { project_id: PROJECT, query });
  let p = res?.payload ?? res;
  if (p && typeof p === 'object' && !Array.isArray(p)) p = p.result ?? p.text ?? p.content ?? p;
  if (Array.isArray(p) && p[0]?.text) p = p[0].text;
  if (Array.isArray(p)) return p;
  const text = String(p ?? '');
  const inner = text.match(/<untrusted-data-[^>]+>\s*([\s\S]*?)\s*<\/untrusted-data/);
  try { return JSON.parse(inner ? inner[1] : text); } catch { throw new Error('Unexpected reply from the Supabase connector.'); }
}

export function supa() { return true; }

export async function session() {
  const a = store.settings.claudeAccount;
  return a ? { user: a } : null;
}

// Link this page to the account created in the phone app (no password: the connector already has project access).
export async function signIn(email) {
  const rows = await sql(`select id, email from auth.users where lower(email) = lower(${lit(email.trim())}) limit 1`);
  if (!rows.length) throw new Error('No Next Stop account with that email yet. Create it once in the phone app (Settings → Sync).');
  store.settings.claudeAccount = { id: rows[0].id, email: rows[0].email };
  store.saveSettings();
  return session();
}
export async function signOut() { delete store.settings.claudeAccount; store.saveSettings(); }

export async function pullMeta() {
  const since = new Date(store.meta.metaPulled || 0).toISOString();
  const rows = await sql(`select key, value, updated_at from public.bank_meta where updated_at > ${lit(since)}::timestamptz`);
  if (!rows.length) return null;
  const out = {};
  for (const r of rows) { out[r.key] = r.value; store.meta.metaPulled = Math.max(store.meta.metaPulled || 0, new Date(r.updated_at).getTime()); }
  store.saveMeta();
  return out;
}

export async function pullBank(bank) {
  const since = new Date(store.meta.bankPulled || 0).toISOString();
  const rows = await sql(`select id, course, topic, type, data, retired, updated_at from public.questions where updated_at > ${lit(since)}::timestamptz order by updated_at limit 2000`);
  if (!rows.length) return null;
  const map = new Map(bank.map(q => [q.id, q]));
  let max = store.meta.bankPulled || 0;
  for (const r of rows) {
    map.set(r.id, { ...r.data, id: r.id, course: r.course, topic: r.topic, type: r.type, retired: r.retired });
    max = Math.max(max, new Date(r.updated_at).getTime());
  }
  store.meta.bankPulled = max; store.saveMeta();
  return [...map.values()];
}

export async function syncProgress() {
  const s = await session(); if (!s) return { ok: false, reason: 'not linked' };
  const uid = s.user.id;
  const ids = [...store.dirty].filter(id => id !== '__daily' && store.progress[id]);
  for (let i = 0; i < ids.length; i += 200) {
    const vals = ids.slice(i, i + 200).map(id => `(${lit(uid)}::uuid, ${lit(id)}, ${lit(store.progress[id])}::jsonb)`).join(',');
    await sql(`insert into public.progress (user_id, qid, state) values ${vals}
      on conflict (user_id, qid) do update set state = excluded.state
      where coalesce((public.progress.state->>'updated')::bigint, 0) <= coalesce((excluded.state->>'updated')::bigint, 0)`);
  }
  if (store.dirty.has('__daily')) {
    const vals = Object.entries(store.daily).map(([d, r]) => `(${lit(uid)}::uuid, ${lit(store.device)}, ${lit(d)}::date, ${+r.answered || 0}, ${+r.correct || 0})`).join(',');
    if (vals) await sql(`insert into public.daily (user_id, device, day, answered, correct) values ${vals}
      on conflict (user_id, device, day) do update set answered = excluded.answered, correct = excluded.correct`);
  }
  store.dirty.clear(); store.saveProgress();

  const since = new Date(store.meta.lastPull || 0).toISOString();
  const rows = await sql(`select qid, state, updated_at from public.progress where user_id = ${lit(uid)}::uuid and updated_at > ${lit(since)}::timestamptz`);
  let max = store.meta.lastPull || 0, merged = 0;
  for (const r of rows) {
    const local = store.progress[r.qid];
    if (!local || (r.state.updated || 0) > (local.updated || 0)) { store.progress[r.qid] = r.state; merged++; }
    max = Math.max(max, new Date(r.updated_at).getTime());
  }
  store.meta.lastPull = max; store.saveMeta(); store.saveProgress();

  const days = await sql(`select day::text as day, sum(answered)::int as answered, sum(correct)::int as correct from public.daily
    where user_id = ${lit(uid)}::uuid and device <> ${lit(store.device)} group by day`);
  store.remoteDaily = Object.fromEntries(days.map(r => [r.day, { answered: r.answered, correct: r.correct }]));
  return { ok: true, merged, pushed: ids.length };
}
