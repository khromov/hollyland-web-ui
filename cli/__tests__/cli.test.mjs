// `npx hollyland-web-ui`: option parsing, the static file server and the CLI's help/usage paths.
// (The sudo + USB bridge path needs a terminal and hardware; see the report in the PR.)
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_BRIDGE_PORT, DEFAULT_PORT, HOSTED_ORIGIN, HOSTED_URL, bridgeByDefault, helpText, parseOptions, UsageError } from '../lib/options.mjs'
import { createStaticServer, mimeType, resolveRequestPath } from '../lib/static-server.mjs'

const CLI = fileURLToPath(new URL('../hollyland-web-ui.mjs', import.meta.url))

describe('parseOptions', () => {
  it('defaults: bridge only on macOS', () => {
    expect(parseOptions([], 'darwin')).toMatchObject({ port: DEFAULT_PORT, bridgePort: DEFAULT_BRIDGE_PORT, bridge: true, open: true })
    expect(parseOptions([], 'linux').bridge).toBe(false)
    expect(parseOptions([], 'win32').bridge).toBe(false)
    expect(bridgeByDefault('darwin')).toBe(true)
  })

  it('reads ports in both spellings and the switches', () => {
    expect(parseOptions(['--port', '5000', '--bridge-port=5001', '--no-open', '--verbose'], 'darwin')).toMatchObject({
      port: 5000, bridgePort: 5001, open: false, verbose: true,
    })
    expect(parseOptions(['-p', '6000'], 'darwin').port).toBe(6000)
    expect(parseOptions(['--no-bridge'], 'darwin').bridge).toBe(false)
    expect(parseOptions(['--bridge'], 'linux').bridge).toBe(true)
    expect(parseOptions(['--help'], 'darwin').help).toBe(true)
    expect(parseOptions(['-v'], 'darwin').version).toBe(true)
  })

  it('--bridge-only starts the bridge and opens nothing', () => {
    expect(parseOptions(['--bridge-only'], 'linux')).toMatchObject({ bridgeOnly: true, bridge: true, open: false })
    expect(() => parseOptions(['--bridge-only', '--no-bridge'], 'darwin')).toThrow(UsageError)
    // The origin --bridge-only passes to the bridge as --allow-origin: scheme and host, no path.
    expect(HOSTED_ORIGIN).toBe('https://khromov.github.io')
    expect(HOSTED_URL.startsWith(`${HOSTED_ORIGIN}/`)).toBe(true)
  })

  it('rejects bad input with a usage error', () => {
    for (const argv of [['--port'], ['--port', 'abc'], ['--port', '70000'], ['--port', '0'], ['--nope'], ['extra'], ['--no-open=1']]) {
      expect(() => parseOptions(argv, 'darwin'), argv.join(' ')).toThrow(UsageError)
    }
    expect(() => parseOptions(['--port', '47321'], 'darwin')).toThrow(/must differ/)
    expect(parseOptions(['--port', '47321', '--no-bridge'], 'darwin').port).toBe(47321)
  })

  it('help names every option', () => {
    const help = helpText('1.2.3')
    for (const flag of ['--port', '--bridge-port', '--no-bridge', '--bridge ', '--bridge-only', '--no-open', '--verbose', '--version', '--help']) {
      expect(help).toContain(flag)
    }
    expect(help).toContain('Hollyland Web UI 1.2.3')
  })
})

describe('static server', () => {
  let root
  let outside
  let port
  let server

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mc-web-'))
    outside = await mkdtemp(join(tmpdir(), 'mc-outside-'))
    await mkdir(join(root, 'assets'))
    await mkdir(join(root, 'empty'))
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Hollyland Web UI</title>')
    await writeFile(join(root, 'assets', 'app-abc.js'), 'export {}')
    await writeFile(join(root, 'assets', 'font.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]))
    await writeFile(join(root, 'assets', 'mod.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]))
    await writeFile(join(root, '.secret'), 'nope')
    await writeFile(join(outside, 'private.txt'), 'private')
    await symlink(join(outside, 'private.txt'), join(root, 'leak.txt'))
    server = createStaticServer({ root })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = server.address().port
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  /** Raw request (no URL normalization, so ../ reaches the server as typed). */
  function fetchRaw(path, method = 'GET', headers = {}) {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
      })
      req.on('error', reject)
      req.end()
    })
  }

  it('serves index.html at / (query strings ignored) with no-cache', async () => {
    const r = await fetchRaw('/?bridge=auto')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(r.headers['cache-control']).toBe('no-cache')
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.body).toContain('Hollyland Web UI')
  })

  it('sends the right MIME types and caches hashed assets', async () => {
    const js = await fetchRaw('/assets/app-abc.js')
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(js.headers['cache-control']).toContain('immutable')
    expect((await fetchRaw('/assets/font.woff2')).headers['content-type']).toBe('font/woff2')
    expect((await fetchRaw('/assets/mod.wasm')).headers['content-type']).toBe('application/wasm')
    expect(mimeType('a.css')).toBe('text/css; charset=utf-8')
    expect(mimeType('a.svg')).toBe('image/svg+xml')
    expect(mimeType('a.json')).toBe('application/json; charset=utf-8')
    expect(mimeType('a.unknown')).toBe('application/octet-stream')
  })

  it('answers HEAD without a body and revalidates with ETag', async () => {
    const head = await fetchRaw('/index.html', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body).toBe('')
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0)
    const again = await fetchRaw('/index.html', 'GET', { 'If-None-Match': head.headers.etag })
    expect(again.status).toBe(304)
  })

  it('lists no directories and leaks nothing outside the root', async () => {
    expect((await fetchRaw('/assets/')).status).toBe(404)
    expect((await fetchRaw('/assets')).status).toBe(404)
    expect((await fetchRaw('/empty/')).status).toBe(404)
    expect((await fetchRaw('/../package.json')).status).toBe(404)
    expect((await fetchRaw('/assets/%2e%2e/%2e%2e/etc/passwd')).status).toBe(404)
    expect((await fetchRaw('/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).status).toBe(404)
    expect((await fetchRaw('/.secret')).status).toBe(404)
    expect((await fetchRaw('/leak.txt')).status).toBe(404)
    expect((await fetchRaw('/%E0%A4%A')).status).toBe(404)
    expect((await fetchRaw('/missing.js')).status).toBe(404)
  })

  it('refuses other methods', async () => {
    const r = await fetchRaw('/', 'POST')
    expect(r.status).toBe(405)
    expect(r.headers.allow).toBe('GET, HEAD')
  })

  it('resolveRequestPath keeps paths inside the root', () => {
    expect(resolveRequestPath('/srv/web', '/')).toBe('/srv/web/index.html')
    expect(resolveRequestPath('/srv/web', '/a/b.js?x=1')).toBe('/srv/web/a/b.js')
    expect(resolveRequestPath('/srv/web', '/a/../../x')).toBe('/srv/web/x') // the URL parser drops the ../ itself
    expect(resolveRequestPath('/srv/web', '/a/%2e%2e%2f%2e%2e%2fx')).toBe(null)
    expect(resolveRequestPath('/srv/web', '/a%00b')).toBe(null)
    expect(resolveRequestPath('/srv/web', '/a%5c..%5cb')).toBe(null)
  })
})

describe('hollyland-web-ui command', () => {
  function run(args) {
    return new Promise((resolve) => {
      execFile(process.execPath, [CLI, ...args], { env: { ...process.env, NO_COLOR: '1' }, timeout: 10_000 }, (error, stdout, stderr) =>
        resolve({ code: error ? error.code : 0, stdout, stderr }),
      )
    })
  }

  it('--help and --version', async () => {
    const help = await run(['--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('Usage: npx hollyland-web-ui [options]')
    const version = await run(['--version'])
    expect(version.code).toBe(0)
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('exits with 2 and a hint on a bad option', async () => {
    const r = await run(['--frobnicate'])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('unknown option --frobnicate')
    expect(r.stderr).toContain('npx hollyland-web-ui --help')
  })
})
