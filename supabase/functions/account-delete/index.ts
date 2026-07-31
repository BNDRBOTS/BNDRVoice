import Stripe from 'npm:stripe@14.21.0'
import { adminClient, serverConfigured, userClient } from '../_shared/supabase.ts'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') || 'https://voice.bndr.bot',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } })

async function subjectHash(userId: string): Promise<string> {
  const salt = Deno.env.get('AUDIT_HASH_SALT') || ''
  if (salt.length < 32) throw new Error('Account deletion audit is not configured')
  const bytes = new TextEncoder().encode(`${salt}:${userId}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function listExportPaths(admin: ReturnType<typeof adminClient>, prefix: string): Promise<string[]> {
  const paths: string[] = []
  const pending = [prefix]
  let inspected = 0
  while (pending.length) {
    const folder = pending.pop()!
    let offset = 0
    while (true) {
      const { data, error } = await admin.storage
        .from('voice-profile-exports')
        .list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new Error(`Could not enumerate stored exports: ${error.message}`)
      const entries = data || []
      inspected += entries.length
      if (inspected > 10_000) throw new Error('Stored export limit exceeded; account was not deleted')
      for (const entry of entries) {
        const path = `${folder}/${entry.name}`
        if (entry.id) paths.push(path)
        else pending.push(path)
      }
      if (entries.length < 100) break
      offset += entries.length
    }
  }
  return paths
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)
  if (!serverConfigured(true)) return reply({ error: 'Server configuration incomplete' }, 503)

  const authHeader = req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Unauthorized' }, 401)
  const client = userClient(authHeader)
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return reply({ error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => ({}))
  if (body?.confirmation !== 'DELETE') {
    return reply({ error: 'Type DELETE to confirm account deletion' }, 400)
  }

  const admin = adminClient()
  const auditHash = await subjectHash(user.id).catch(() => '')
  if (!auditHash) return reply({ error: 'Account deletion audit is not configured' }, 503)

  const { data: subscription, error: subscriptionError } = await admin.from('subscriptions')
    .select('stripe_subscription_id,status').eq('user_id', user.id).maybeSingle()
  if (subscriptionError) return reply({ error: 'Could not verify billing state' }, 503)

  let billingResult = 'none'
  if (subscription?.stripe_subscription_id && !['canceled', 'expired'].includes(subscription.status)) {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
    if (!stripeKey) return reply({ error: 'Billing cancellation is unavailable; account was not deleted' }, 503)
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })
    try {
      await stripe.subscriptions.cancel(subscription.stripe_subscription_id)
      billingResult = 'canceled'
    } catch {
      return reply({ error: 'Subscription cancellation failed; account was not deleted' }, 502)
    }
  }

  let paths: string[]
  try {
    paths = await listExportPaths(admin, user.id)
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await admin.storage.from('voice-profile-exports').remove(paths.slice(offset, offset + 100))
      if (error) throw error
    }
  } catch {
    return reply({ error: 'Stored export deletion failed; account was not deleted' }, 502)
  }

  const { error: scrubError } = await admin.rpc('scrub_account_for_deletion', {
    p_user_id: user.id,
    p_subject_hash: auditHash,
    p_billing_result: billingResult,
    p_storage_object_count: paths.length,
  })
  if (scrubError) return reply({ error: 'Account data scrub failed; account was not deleted' }, 500)

  await client.auth.signOut({ scope: 'global' }).catch(() => undefined)
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) return reply({ error: 'Account deletion failed' }, 500)
  return reply({ deleted: true })
})
