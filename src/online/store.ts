import type { MatchStore } from './api'
import type { OnlineMatch } from './match'

export interface Statement {
  bind(...values: (string | number | ArrayBuffer)[]): Statement
  first<T>(): Promise<T | null>
  run(): Promise<{ meta: { changes: number } }>
}

export interface MatchDatabase {
  prepare(sql: string): Statement
}

async function pack(game: OnlineMatch) {
  const body = new Blob([JSON.stringify(game)])
  return new Response(body.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
}

async function unpack(row: { state: ArrayBuffer | number[] } | null) {
  if (!row) return undefined
  const bytes = Array.isArray(row.state) ? new Uint8Array(row.state) : row.state
  const body = new Blob([bytes])
  const result = await new Response(body.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  return JSON.parse(result) as OnlineMatch
}

/** A single versioned row atomically publishes both seat views and the resolution. */
export function databaseMatchStore(db: MatchDatabase): MatchStore {
  return {
    async get(id) {
      return unpack(await db.prepare('SELECT state FROM online_matches WHERE id = ?').bind(id).first())
    },
    async findByInvite(invite) {
      return unpack(await db.prepare('SELECT state FROM online_matches WHERE invite = ?').bind(invite).first())
    },
    async create(game) {
      const result = await db.prepare('INSERT OR IGNORE INTO online_matches (id, invite, version, state) VALUES (?, ?, ?, ?)')
        .bind(game.id, game.invite, game.version, await pack(game)).run()
      return result.meta.changes === 1
    },
    async replace(game, expectedVersion) {
      const result = await db.prepare('UPDATE online_matches SET version = ?, state = ? WHERE id = ? AND version = ?')
        .bind(game.version, await pack(game), game.id, expectedVersion).run()
      return result.meta.changes === 1
    },
  }
}
