import { serverConfigured, userClient } from '../_shared/supabase.ts'

const appOrigin = Deno.env.get('APP_ORIGIN') || 'https://voice.bndr.bot'
const cors = {
  'Access-Control-Allow-Origin': appOrigin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('authorization') || ''
  if (!serverConfigured()) return reply({ error: 'Server configuration incomplete' }, 503)
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Unauthorized' }, 401)
  const client = userClient(authHeader)
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return reply({ error: 'Unauthorized' }, 401)

  const input = await req.json().catch(() => null)
  if (!input || !/^VE-[A-Z0-9_]{2,40}$/.test(String(input.error_code || ''))) {
    return reply({ error: 'Invalid report' }, 400)
  }
  const report = {
    user_id: user.id,
    correlation_id: String(input.correlation_id || crypto.randomUUID()),
    error_code: String(input.error_code),
    message: String(input.message || '').slice(0, 2000),
    route: String(input.route || '').slice(0, 500),
    app_version: String(input.app_version || 'unknown').slice(0, 40),
    provider: String(input.provider || '').slice(0, 40) || null,
    browser_context: typeof input.browser_context === 'object' ? input.browser_context : {},
  }
  const { error } = await client.from('error_reports').insert(report)
  if (error) return reply({ error: 'Could not store report' }, 500)

  const resendKey = Deno.env.get('RESEND_API_KEY')
  const reportTo = Deno.env.get('ERROR_REPORT_TO')
  if (resendKey && reportTo) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'VoiceEngine Errors <errors@bndr.bot>',
        to: [reportTo],
        subject: `[${report.error_code}] VoiceEngine ${report.correlation_id}`,
        text: JSON.stringify(report, null, 2),
      }),
    }).catch(() => null)
  }
  return reply({ accepted: true, correlation_id: report.correlation_id })
})
