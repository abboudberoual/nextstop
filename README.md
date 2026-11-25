# Next Stop: study in your dead time

Android app (Capacitor) plus a Claude study page that share one question bank. Progress syncs both ways through Supabase.

## Features
- **Mixed sessions:** questions from all four courses are interleaved, weighted toward the nearest exam and the biggest final weight. A course drops out once its exam starts.
- **Spaced repetition:** compressed Leitner boxes (10 min → 12 h → 1 d → 2 d → 4 d → 7 d), capped so every card comes back before its final. Missed cards return a few questions later in the same session.
- **Question types:** MCQ (choices shuffled each time), true/false, and short answer (reveal the answer, then grade yourself Missed / Partly / Got it). An "I guessed" button marks lucky right answers as weak.
- **Notifications:** commute and dead-time nudges that carry a real question as the hook, with Quick 5 and snooze-20-min actions. Also an exam-eve cram reminder and a streak saver at 9 pm if the daily goal isn't met. Quiet hours are respected.
- **Modes:** Mixed, Weak spots, New only, Next exam (cram), Quick 5, and "Only this" filters per course.
- **Progress:** 14-day activity, per-topic mastery, and a streak that combines all your devices.
- Works offline. LaTeX math (`$...$`) renders with bundled KaTeX.

## Question format (`public/bank.json`)
```json
{ "id": "m361-l15-03", "course": "mech361", "topic": "Pipe flow", "type": "mcq",
  "question": "…", "choices": ["…","…","…","…"], "answer": 0,
  "explanation": "…", "source": "Lecture 15 - Viscous Flow in Pipes, slide 12" }
```
`type` is `mcq` (answer = index), `tf` (answer = true/false) or `short` (answer = text, optional `keywords`). Run `npm run validate` to check the bank.

## Build
Every push to `main` runs GitHub Actions, which builds `NextStop.apk` and attaches it to the **latest** release.

Signing: create a keystore once (`keytool -genkeypair -keystore release.keystore -alias finals -keyalg RSA -keysize 2048 -validity 10000`). Add it as repo secret `KEYSTORE_B64` (base64 of the file), plus its password as `KEYSTORE_PASSWORD`. Never commit the keystore. Keeping the same key means each new APK installs over the previous one.

New semester: replace `courses` and `questions` in `public/bank.json` (or push new rows to the Supabase `questions` table). Past courses drop out of the mix automatically after their exam date. Repo secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` bake the sync server into the app. Without them, you can enter the server in Settings.

## Sync setup
The sync server is the Supabase project `nextstop` (ca-central-1); `supabase/schema.sql` matches what's applied. After pushing new questions, run `select public.import_bank();` (Claude can do this through the Supabase connector) and every device picks them up on its next sync, no reinstall needed. Create your account in the app under Settings → Sync.

## Claude study page
The same app is published as a Claude page: https://claude.ai/artifact/QVPV6E4BNkk7ho6Mttokxc
`VITE_TARGET=claude npm run build` → `dist-claude/index.html` (single file, fonts inlined) + `bank.json`. On claude.ai a page can't reach Supabase directly, so `src/sync-claude.js` syncs through the viewer's Supabase connector (`execute_sql`) and links to the phone account by email. The page declares `mcp: Supabase/execute_sql`.
