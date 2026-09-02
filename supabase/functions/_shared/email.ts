export type EmailPayload = { to: string; subject: string; text: string }

export async function sendTransactionalEmail(payload: EmailPayload): Promise<'sent' | 'captured'> {
  const key = Deno.env.get('RESEND_API_KEY') || ''
  if (!key) {
    console.log(JSON.stringify({ transport: 'capture', channel: 'email', ...payload }))
    return 'captured'
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VoiceEngine Errors <errors@bndr.bot>',
      to: [payload.to],
      subject: payload.subject,
      text: payload.text,
    }),
  }).catch(() => null)
  if (!response?.ok) {
    console.log(JSON.stringify({ transport: 'capture', channel: 'email', fallback: true, ...payload }))
    return 'captured'
  }
  return 'sent'
}
