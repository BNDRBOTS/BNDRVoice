export function correlationId(): string {
  return crypto.randomUUID()
}

export function publicCode(area: string, status: number | string, correlation: string): string {
  const hash = correlation.replace(/-/g, '').slice(0, 4).toUpperCase() || '0000'
  const cleanArea = area.replace(/[^A-Z0-9]/gi, '').slice(0, 12).toUpperCase() || 'APP'
  return `${cleanArea}-${status}-${hash}`
}

export function jsonError(
  headers: Record<string, string>,
  area: string,
  status: number,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  const correlation = correlationId()
  const code = publicCode(area, status, correlation)
  return Response.json({
    error: message,
    error_code: code,
    correlation_id: correlation,
    ...extra,
  }, { status, headers: { ...headers, 'Cache-Control': 'no-store' } })
}
