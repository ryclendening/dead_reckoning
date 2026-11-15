import { useRef, useState } from 'react'
import type { OnlineCommand, OnlineEntry, OnlineResponse, OnlineSession, OnlineView } from '../online/protocol'

const API = '/api/online'

export class OnlineRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      throw new OnlineRequestError(body.error || `Online service returned ${response.status}`, response.status)
    }
    return await response.json() as T
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The game server took too long to respond. Try again.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
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

export async function copyInviteCode(input: HTMLInputElement): Promise<boolean> {
  const page = input.ownerDocument
  try {
    const clipboard = page.defaultView?.navigator.clipboard
    if (clipboard?.writeText) {
      await clipboard.writeText(input.value)
      return true
    }
  } catch {
    // The browser can deny clipboard access even on a secure origin.
  }

  // On a LAN HTTP origin this runs within the original click gesture.
  input.focus({ preventScroll: true })
  input.select()
  input.setSelectionRange(0, input.value.length)
  try {
    return page.execCommand?.('copy') === true
  } catch {
    return false
  }
}

export function OnlineInviteCode({ code }: { code: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'manual'>('idle')

  async function copy() {
    if (input.current) setCopyStatus(await copyInviteCode(input.current) ? 'copied' : 'manual')
  }

  return <div>
    <div className="online-invite">
      <span>Invite code</span>
      <input ref={input} aria-label="One-use invite code" readOnly value={code} onFocus={event => event.currentTarget.select()}/>
      <button type="button" onClick={() => void copy()}>{copyStatus === 'copied' ? 'Copied' : 'Copy'}</button>
    </div>
    {copyStatus === 'manual' ? <p className="online-invite-help" role="status">Use your device’s Copy action on the selected code.</p> : null}
  </div>
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
    <div className="online-join"><label htmlFor="online-invite">INVITE CODE</label><div><input id="online-invite" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={invite} onChange={event => { setInvite(event.target.value); requestTokens.current.join = undefined }} placeholder="Enter or paste code"/><button type="button" disabled={busy || !invite.trim()} onClick={() => void run(async () => { const entered = invite.trim(); const current = requestTokens.current.join; const token = current?.invite === entered ? current.token : newToken(); requestTokens.current.join = { invite: entered, token }; onJoin(await joinOnlineMatch(entered, token)) })}>JOIN</button></div></div>
    {error ? <p className="online-error" role="alert">{error}</p> : null}
  </section>
}
