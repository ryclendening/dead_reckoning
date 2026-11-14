import { useRef, useState } from 'react'
import type { OnlineCommand, OnlineEntry, OnlineResponse, OnlineSession, OnlineView } from '../online/protocol'

const API = '/api/online'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || `Online service returned ${response.status}`)
  return body
}

export function createOnlineMatch(token: string): Promise<OnlineEntry> {
  return request<OnlineEntry>(`${API}/matches`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
}

export function joinOnlineMatch(invite: string, token: string): Promise<{ session: OnlineSession; view: OnlineView }> {
  return request(`${API}/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite, token }),
  })
}

export function fetchOnlineMatch(session: OnlineSession): Promise<OnlineResponse> {
  return request(`${API}/matches/${encodeURIComponent(session.matchId)}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  })
}

export function sendOnlineCommand(session: OnlineSession, command: OnlineCommand): Promise<OnlineResponse> {
  return request(`${API}/matches/${encodeURIComponent(session.matchId)}/commands`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
}

export function OnlineMenu({ onCreate, onJoin }: { onCreate: (entry: OnlineEntry) => void; onJoin: (entry: { session: OnlineSession; view: OnlineView }) => void }) {
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestTokens = useRef<{ create?: string; join?: { invite: string; token: string } }>({})

  const newToken = () => {
    if (!globalThis.crypto?.getRandomValues) throw new Error('Secure token generation is unavailable in this browser context.')
    return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not connect to the online service.') }
    finally { setBusy(false) }
  }

  return <section className="online-menu" aria-labelledby="online-menu-title">
    <header><span className="online-kicker">LIVE MULTIPLAYER</span><h2 id="online-menu-title">PLAYER VS PLAYER</h2></header>
    <p>Share an invite code, deploy and plan together, then review the server resolved round.</p>
    <button type="button" className="online-create" disabled={busy} onClick={() => void run(async () => { const token = requestTokens.current.create ?? (requestTokens.current.create = newToken()); onCreate(await createOnlineMatch(token)) })}>{busy ? 'CONNECTING…' : 'CREATE MATCH'}</button>
    <div className="online-join"><label htmlFor="online-invite">INVITE CODE</label><div><input id="online-invite" autoComplete="off" value={invite} onChange={event => { setInvite(event.target.value); requestTokens.current.join = undefined }} placeholder="Paste code"/><button type="button" disabled={busy || !invite.trim()} onClick={() => void run(async () => { const entered = invite.trim(); const current = requestTokens.current.join; const token = current?.invite === entered ? current.token : newToken(); requestTokens.current.join = { invite: entered, token }; onJoin(await joinOnlineMatch(entered, token)) })}>JOIN</button></div></div>
    {error ? <p className="online-error" role="alert">{error}</p> : null}
  </section>
}
