import { z } from 'zod'

// Zod probes `new Function('')` the first time it builds a schema, to decide
// whether it may JIT-compile parsers. The production CSP has no 'unsafe-eval',
// so the probe is blocked and the browser reports a securitypolicyviolation
// even though zod catches the throw. jitless skips the probe; parsing is the
// same. lib/client.ts imports this first, before the modules that build
// schemas at load time (fitnessCalendar, fitnessRoutes).
z.config({ jitless: true })
