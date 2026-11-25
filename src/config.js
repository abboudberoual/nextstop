// Filled in at build time (GitHub Actions secrets) or left blank and set in the app's Settings.
export const CONFIG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
};
