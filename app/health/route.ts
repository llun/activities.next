// Unauthenticated liveness probe for load balancers and uptime monitors,
// mirroring Mastodon's GET /health. It deliberately touches no database and no
// config so it stays up even when the app is misconfigured, and skips
// traceApiRoute so high-frequency probes don't flood tracing. proxy.ts passes
// /health straight through (it only rewrites /@ paths).
//
// Mastodon itself replies text/plain "OK"; this server replies JSON
// {"status":"UP"} — probes should assert on the 200 status, not the body.
export const GET = () => Response.json({ status: 'UP' })
