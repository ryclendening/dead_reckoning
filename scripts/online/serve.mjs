import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import worker from '../../dist/server/index.js'

const root = resolve('dist')
const databasePath = resolve(process.env.ONLINE_DB_PATH ?? '.online/matches.sqlite')
await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 })
const sqlite = new DatabaseSync(databasePath)
sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
sqlite.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
const db = {
  prepare(sql) {
    const statement = sqlite.prepare(sql)
    return {
      bind(...bound) {
        const values = bound.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value)
        return {
          async first() {
            const row = statement.get(...values)
            return row ? { state: Array.from(row.state) } : null
          },
          async run() {
            return { meta: { changes: Number(statement.run(...values).changes) } }
          },
        }
      },
    }
  },
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
}

const assets = {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    if (pathname !== '/' && pathname !== '/index.html' && !pathname.startsWith('/assets/')) {
      return new Response(null, { status: 404 })
    }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (file !== resolve(root, 'index.html') && !file.startsWith(resolve(root, 'assets') + sep)) {
      return new Response(null, { status: 404 })
    }
    const info = await stat(file).catch(() => undefined)
    if (!info?.isFile()) return new Response(null, { status: 404 })
    return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file)), {
      headers: { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'content-length': String(info.size) },
    })
  },
}

const host = process.env.ONLINE_HOST ?? '0.0.0.0'
const port = Number(process.env.ONLINE_PORT ?? 4173)
createServer(async (incoming, outgoing) => {
  try {
    const request = new Request('http://localhost' + incoming.url, {
      method: incoming.method,
      headers: new Headers(incoming.headers),
      ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
    })
    const result = await worker.fetch(request, { DB: db, ASSETS: assets })
    outgoing.writeHead(result.status, Object.fromEntries(result.headers))
    if (result.body) Readable.fromWeb(result.body).pipe(outgoing)
    else outgoing.end()
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500)
    outgoing.end()
  }
}).listen(port, host, () => console.log(`Dead Reckoning is listening on ${host}:${port}`))
