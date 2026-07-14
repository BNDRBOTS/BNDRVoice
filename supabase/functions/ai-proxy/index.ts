// ══════════════════════════════════════════════════════════════
// APEX Voice Engine — AI Proxy Edge Function
// Routes DeepSeek calls server-side to bypass browser CORS.
// The user's API key is forwarded over HTTPS and never stored.
//
// Deploy:
//   supabase functions deploy ai-proxy --no-verify-jwt
//   (JWT is verified manually below for finer error control)
//
// Required env vars (set in Supabase Dashboard → Edge Functions):
//   SUPABASE_URL        — auto-set by Supabase runtime
//   SUPABASE_ANON_KEY   — auto-set by Supabase runtime
// ══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ProxyRequestBody {
  provider: 'deepseek'
  key: string
  model: string
  max_tokens: number
  messages: Array<{ role: string; content: string }>
}

serve(async (req: Request): Promise<Response> => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405)
  }

  // ── 1. Authenticate the caller ──────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonError('Missing or malformed Authorization header', 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return jsonError('Unauthorized — valid Supabase session required', 401)
  }

  // ── 2. Parse + validate request body ────────────────────────
  let body: ProxyRequestBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const { provider, key, model, max_tokens, messages } = body

  if (provider !== 'deepseek') {
    return jsonError(`Unsupported provider: ${provider}. Only 'deepseek' is proxied.`, 400)
  }
  if (!key || typeof key !== 'string' || key.length < 8) {
    return jsonError('Missing or invalid API key', 400)
  }
  if (!model || typeof model !== 'string') {
    return jsonError('Missing model', 400)
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError('messages must be a non-empty array', 400)
  }
  const safeMaxTokens = Math.min(Math.max(Number(max_tokens) || 2000, 100), 8000)

  // ── 3. Forward to DeepSeek ───────────────────────────────────
  let upstream: Response
  try {
    upstream = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: safeMaxTokens,
        stream: false,
        messages,
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return jsonError(`DeepSeek upstream unreachable: ${msg}`, 502)
  }

  // ── 4. Return upstream response verbatim ────────────────────
  const upstreamData = await upstream.json().catch(() => null)

  if (!upstream.ok) {
    const errMsg = upstreamData?.error?.message
      || upstreamData?.error
      || `DeepSeek API error ${upstream.status}`
    return jsonError(errMsg, upstream.status)
  }

  return new Response(JSON.stringify(upstreamData), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
})

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
