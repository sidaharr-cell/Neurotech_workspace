import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Returns null when env vars aren't set (local dev without Supabase)
export const supabase = url && key ? createClient(url, key) : null
