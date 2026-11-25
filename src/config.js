// Sync server. The anon key is designed to be public: row-level security limits each signed-in user to their own progress.
// Build-time env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) override these, e.g. for a fork with its own project.
export const CONFIG = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://koezutepgxjcmcbicahu.supabase.co',
  supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvZXp1dGVwZ3hqY21jYmljYWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1NzM2MTYsImV4cCI6MjExMTE0OTYxNn0.GYl5gRYZoHD8oX5qrIP8u_VAEqbd7DPvvu0ooAwRiCA',
};
