import { readFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const manifestPath = path.resolve('.openai/hosting.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!manifest.project_id || manifest.static?.directory !== 'dist') {
  throw new Error('Expected this repository’s OpenAI Site ID and dist static directory in .openai/hosting.json.')
}

const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'openai-curated-remote', 'sites')
const versions = readdirSync(pluginRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort(compareVersions)
const workflow = versions
  .map(version => path.join(pluginRoot, version, 'scripts', 'site-workflow.mjs'))
  .find(candidate => {
    try { return readdirSync(path.dirname(candidate)).includes('site-workflow.mjs') } catch { return false }
  })
if (!workflow) throw new Error(`Could not find the installed Sites source helper under ${pluginRoot}.`)

process.stderr.write('Paste the Sites source credential JSON on this hidden stdin prompt. It will not be saved or printed.\n')
const credentialLine = await readOneLine()
let credential
try { credential = JSON.parse(credentialLine) } catch { throw new Error('Expected one JSON object returned by the Sites source credential tool.') }
if (!['http_extra_header', 'work_proxy'].includes(credential?.auth_mode)
  || typeof credential.remote_url !== 'string'
  || typeof credential.branch !== 'string') {
  throw new Error('The supplied object is not a valid Sites source credential result.')
}

const archivePath = path.join(os.tmpdir(), `openai-site-${manifest.project_id}.tar.gz`)
const input = {
  credential,
  commands: [['npm', 'run', 'build']],
  archivePath,
}
const child = spawn(process.execPath, [workflow, '--project-id', manifest.project_id], {
  cwd: process.cwd(),
  stdio: ['pipe', 'inherit', 'inherit'],
  env: process.env,
})
child.stdin.end(`${JSON.stringify(input)}\n`)
const status = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
if (status.code !== 0) process.exitCode = status.code ?? 1

function readOneLine() {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    let value = ''
    const wasTTY = input.isTTY
    const finish = (error) => {
      input.removeListener('data', onData)
      input.removeListener('end', onEnd)
      if (wasTTY) input.setRawMode(false)
      input.pause()
      error ? reject(error) : resolve(value.trim())
    }
    const onData = chunk => {
      value += chunk
      if (value.length > 65536) finish(new Error('Credential input exceeded the allowed size.'))
      else if (value.includes('\n') || value.includes('\r')) finish()
    }
    const onEnd = () => finish()
    if (wasTTY) input.setRawMode(true)
    input.setEncoding('utf8')
    input.on('data', onData)
    input.once('end', onEnd)
    input.resume()
  })
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference) return difference
  }
  return 0
}
