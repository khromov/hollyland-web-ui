// Static file server for the prebuilt Mic Console web UI (cli/dist/web), used by `npx mic-console`.
//
//  - node:http only, bound by the caller to 127.0.0.1
//  - GET and HEAD; files only (no directory listings, no dotfiles, nothing outside the root,
//    symlinks included); "/" and "<dir>/" serve that directory's index.html
//  - hashed files under /assets/ are cached for a year, everything else is revalidated
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
}

/** Content-Type for a file name (application/octet-stream when unknown). */
export function mimeType(file) {
  return MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
}

/**
 * Map a request URL to a file path under `root`, or null when it must not be served (outside the
 * root, a dotfile segment, a NUL byte, a malformed escape).
 */
export function resolveRequestPath(root, url) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(url || '/', 'http://localhost').pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null
  if (pathname.split('/').some((seg) => seg.startsWith('.'))) return null
  if (pathname.endsWith('/')) pathname += 'index.html'
  const base = resolve(root)
  const file = resolve(base, `.${pathname}`)
  if (file !== base && !file.startsWith(base + sep)) return null
  return file
}

/**
 * Create (not start) an HTTP server for the files in `root`.
 * @param {{ root: string, log?: (line: string) => void }} options
 */
export function createStaticServer({ root, log }) {
  const base = resolve(root)
  let realBase = null

  function send(res, status, text, extra = {}) {
    res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
    res.end(res.req.method === 'HEAD' ? undefined : `${text}\n`)
  }

  return createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' })
        return
      }
      const file = resolveRequestPath(base, req.url)
      if (!file) {
        send(res, 404, 'Not found')
        return
      }
      let st
      let real
      try {
        realBase ??= await realpath(base)
        real = await realpath(file)
        st = await stat(real)
      } catch {
        send(res, 404, 'Not found')
        return
      }
      // No directory listings, and nothing a symlink would pull in from outside the root.
      if (!st.isFile() || (real !== realBase && !real.startsWith(realBase + sep))) {
        send(res, 404, 'Not found')
        return
      }
      const pathname = new URL(req.url || '/', 'http://localhost').pathname
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
      const headers = {
        ...BASE_HEADERS,
        'Content-Type': mimeType(real),
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        ETag: etag,
        'Last-Modified': st.mtime.toUTCString(),
      }
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers).end()
        return
      }
      res.writeHead(200, { ...headers, 'Content-Length': st.size })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      const stream = createReadStream(real)
      stream.on('error', (e) => {
        log?.(`could not read ${real}: ${e.message}`)
        res.destroy(e)
      })
      stream.pipe(res)
    } catch (e) {
      log?.(`request ${req.url} failed: ${e instanceof Error ? e.message : String(e)}`)
      if (!res.headersSent) send(res, 500, 'Internal error')
      else res.destroy()
    }
  })
}
