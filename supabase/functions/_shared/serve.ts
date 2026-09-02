export function serve(handler: (req: Request) => Response | Promise<Response>): void {
  const port = Number(Deno.env.get('LISTEN_PORT') || '')
  if (Number.isFinite(port) && port > 0) {
    Deno.serve({ port }, handler)
    return
  }
  Deno.serve(handler)
}
