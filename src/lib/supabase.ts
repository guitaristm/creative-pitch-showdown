import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// tolerate the common paste mistake of copying the REST endpoint instead of the project URL
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** null when env vars are missing — views show a "not configured" banner instead of crashing. */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null
