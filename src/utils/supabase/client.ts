
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getAuth } from 'firebase/auth';

export const createClient = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Missing Supabase configuration.');
  }

  return createSupabaseClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      accessToken: async () => {
        const auth = getAuth();
        await auth.authStateReady();
        return (await auth.currentUser?.getIdToken()) ?? null;
      },
    }
  );
};
