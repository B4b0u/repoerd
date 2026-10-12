import { z } from 'zod'

// Zod probes `new Function('')` to compile faster parsers; the content security policy
// (script-src 'self') blocks it and Chrome reports a violation on every page.
z.config({ jitless: true })
