import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** null when env vars are missing — views show a "not configured" banner instead of crashing. */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null
