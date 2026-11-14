import { handleOnlineRequest } from './api'
import { databaseMatchStore, type MatchDatabase } from './store'

interface Env {
  DB?: MatchDatabase
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    if (new URL(request.url).pathname.startsWith('/api/online/')) {
      if (env.DB) return handleOnlineRequest(request, databaseMatchStore(env.DB))
      return Response.json({ error: 'Online match storage is unavailable.' }, { status: 503 })
    }
    return env.ASSETS?.fetch(request) ?? new Response('Client assets are unavailable.', { status: 503 })
  },
}
