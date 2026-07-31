// BNDR VoiceEngine 3.2.0 — authenticated, entitlement-gated BYOK AI gateway.
// Provider credentials are accepted only over HTTPS, used once, and never
// persisted or logged. Deploy with JWT verification disabled; this function
// validates the user token itself so errors remain structured and portable.

import { createClient } from 'npm:@supabase/supabase-js@2.110.5'
import { buildForensicRequest, type VoiceOperation } from './forensic.ts'

type Provider = 'anthropic' | 'deepseek' | 'openai'
type Message = { role: 'system' | 'user' | 'assistant'; content: string }
type GatewayBody = {
  provider: Provider
  key: string
  model: string
  max_tokens?: number
  operation: VoiceOperation
  payload: Record<string, unknown>
}

const MODELS: Record<Provider, Set<string>> = {
  anthropic: new Set(['claude-sonnet-5']),
  deepseek: new Set(['deepseek-v4-flash', 'deepseek-v4-pro']),
  openai: new Set(['gpt-5.6-luna']),
}
const UPSTREAM: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  deepseek: 'https://api.deepseek.com/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
}
const MAX_BODY_BYTES = 750_000
const MAX_MESSAGE_BYTES = 200_000

function configuredOrigins(): Set<string> {
  return new Set(
    (Deno.env.get('ALLOWED_ORIGINS') || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  )
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || ''
  const allowed = configuredOrigins()
  const allowOrigin = allowed.has(origin) ? origin : [...allowed][0] || 'https://voice.bndr.bot'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(req), 'Cache-Control': 'no-store' },
  })
}

function error(req: Request, code: string, message: string, status: number, correlationId: string): Response {
  return json(req, { error: { code, message, correlation_id: correlationId } }, status)
}

function validateBody(value: unknown): GatewayBody | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Partial<GatewayBody>
  if (!body.provider || !MODELS[body.provider] || !MODELS[body.provider].has(String(body.model))) return null
  if (typeof body.key !== 'string' || body.key.length < 8 || body.key.length > 512) return null
  if (!['analyze', 'compile', 'quality'].includes(String(body.operation))) return null
  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return null
  if (JSON.stringify(body.payload).length > MAX_MESSAGE_BYTES) return null
  return body as GatewayBody
}

async function callProvider(
  body: GatewayBody,
  prompt: { system: string; user: string; maxTokens: number },
): Promise<{ response: Response; extract: (data: any) => string }> {
  const maxTokens = Math.min(Math.max(prompt.maxTokens, 100), 8000)
  const messages: Message[] = [{ role: 'user', content: prompt.user }]

  if (body.provider === 'anthropic') {
    return {
      response: await fetch(UPSTREAM.anthropic, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': body.key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model: body.model, max_tokens: maxTokens, system: prompt.system, messages }),
        signal: AbortSignal.timeout(120_000),
      }),
      extract: data => data?.content?.find((part: any) => part?.type === 'text')?.text || '',
    }
  }

  const common = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.key}` },
    signal: AbortSignal.timeout(120_000),
  } as const
  const providerPayload = body.provider === 'openai'
    ? {
        model: body.model,
        max_completion_tokens: maxTokens,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: prompt.system }, ...messages],
      }
    : {
        model: body.model,
        max_tokens: maxTokens,
        stream: false,
        thinking: { type: 'enabled' },
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: prompt.system }, ...messages],
      }

  return {
    response: await fetch(UPSTREAM[body.provider], {
      ...common,
      body: JSON.stringify(providerPayload),
    }),
    extract: data => data?.choices?.[0]?.message?.content || '',
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const correlationId = crypto.randomUUID()
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return error(req, 'VE-METHOD', 'Method not allowed', 405, correlationId)

  const declaredSize = Number(req.headers.get('content-length') || 0)
  if (declaredSize > MAX_BODY_BYTES) {
    return error(req, 'VE-BODY_SIZE', 'Request body too large', 413, correlationId)
  }

  const authHeader = req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return error(req, 'VE-AUTH_REQUIRED', 'Sign in required', 401, correlationId)
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  if (!supabaseUrl || !publishableKey) {
    return error(req, 'VE-SERVER_CONFIG', 'AI gateway is not configured', 503, correlationId)
  }

  const client = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) {
    return error(req, 'VE-AUTH_INVALID', 'Session expired; sign in again', 401, correlationId)
  }

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return error(req, 'VE-BODY_JSON', 'Invalid JSON body', 400, correlationId)
  }
  const body = validateBody(parsed)
  if (!body) return error(req, 'VE-BODY_INVALID', 'Invalid AI request', 400, correlationId)

  const { data: entitlement, error: gateError } = await client
    .rpc('check_and_increment_usage', { p_user_id: user.id })
  const gate = Array.isArray(entitlement) ? entitlement[0] : entitlement
  if (gateError) {
    return error(req, 'VE-ENTITLEMENT', 'Could not verify plan access', 503, correlationId)
  }
  if (!gate?.allowed) {
    return json(req, {
      error: {
        code: 'VE-LIMIT',
        message: 'Daily analysis limit reached',
        correlation_id: correlationId,
      },
      entitlement: gate,
    }, 402)
  }

  try {
    const prompt = buildForensicRequest(body.operation, body.payload)
    const { response, extract } = await callProvider(body, prompt)
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const message = String(data?.error?.message || data?.error || `Provider error ${response.status}`)
        .slice(0, 500)
      return error(req, 'VE-PROVIDER', message, response.status, correlationId)
    }
    const content = extract(data)
    if (!content) return error(req, 'VE-PROVIDER_SHAPE', 'Provider returned no output', 502, correlationId)
    return json(req, {
      content,
      usage: {
        current_count: gate.current_count,
        daily_limit: gate.daily_limit,
        entitlement_status: gate.entitlement_status,
      },
      correlation_id: correlationId,
    })
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Provider unreachable'
    const timedOut = /timeout|timed out|abort/i.test(message)
    return error(
      req,
      timedOut ? 'VE-TIMEOUT' : 'VE-UPSTREAM',
      timedOut ? 'AI request timed out; try again' : 'AI provider is temporarily unreachable',
      timedOut ? 504 : 502,
      correlationId,
    )
  }
})
