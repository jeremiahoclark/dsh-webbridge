import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebBridgeClient, WebBridgeClientError } from '../src/client.ts'

type Handler = (request: IncomingMessage, response: ServerResponse) => void

let server: Server
let baseURL: string
let handler: Handler

beforeEach(async () => {
  handler = (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"success":true}')
  }
  server = createServer((request, response) => { handler(request, response) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

function client(options: { timeoutMs?: number; maxResponseBytes?: number } = {}): WebBridgeClient {
  return new WebBridgeClient({
    baseURL,
    timeoutMs: options.timeoutMs ?? 1_000,
    maxResponseBytes: options.maxResponseBytes ?? 1_000,
  })
}

describe('WebBridgeClient', () => {
  it('posts the documented command envelope and returns the daemon JSON unchanged', async () => {
    const requestBody = new Promise<string>((resolve) => {
      handler = (request, response) => {
        const chunks: Buffer[] = []
        request.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        request.on('end', () => {
          resolve(Buffer.concat(chunks).toString('utf8'))
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end('{"success":true,"tabId":42}')
        })
      }
    })

    await expect(client().command(
      'navigate',
      { url: 'https://example.com', newTab: true },
      'dsh-session-1',
      new AbortController().signal,
    )).resolves.toEqual({ success: true, tabId: 42 })
    expect(JSON.parse(await requestBody)).toEqual({
      action: 'navigate',
      args: { url: 'https://example.com', newTab: true },
      session: 'dsh-session-1',
    })
  })

  it('preserves an actionable daemon error from a non-success response', async () => {
    handler = (_request, response) => {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end('{"ok":false,"error":{"code":"tool_error","message":"extension is not connected"}}')
    }
    const error = await client().status(new AbortController().signal).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(WebBridgeClientError)
    expect(error).toMatchObject({ kind: 'http' })
    expect(String(error)).toContain('HTTP 503: extension is not connected')
  })

  it('uses message and serialized response fallbacks for HTTP failures', async () => {
    handler = (_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end('{"message":"bad request"}')
    }
    await expect(client().status(new AbortController().signal)).rejects.toThrow('HTTP 400: bad request')

    handler = (_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end('42')
    }
    await expect(client().status(new AbortController().signal)).rejects.toThrow('HTTP 400: 42')

    handler = (_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end('{"error":{"code":"bad_request"}}')
    }
    await expect(client().status(new AbortController().signal)).rejects.toThrow(
      'HTTP 400: {"error":{"code":"bad_request"}}',
    )
  })

  it('rejects a successful HTTP response carrying a service error', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"error":"no current tab"}')
    }
    await expect(client().command('snapshot', {}, 'test', new AbortController().signal)).rejects.toMatchObject({
      kind: 'service',
      message: 'Kimi WebBridge command snapshot failed: no current tab',
    })
  })

  it('rejects invalid JSON and oversized responses at the HTTP boundary', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('not-json')
    }
    await expect(client().status(new AbortController().signal)).rejects.toMatchObject({ kind: 'protocol' })

    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"tree":"too large"}')
    }
    const oversized = await client({ maxResponseBytes: 5 }).status(new AbortController().signal).then(
      () => undefined,
      (reason: unknown) => reason,
    )
    expect(oversized).toMatchObject({ kind: 'protocol' })
    expect(String(oversized)).toContain('exceeds maxResponseBytes')
  })

  it('rejects declared oversized and empty responses', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' })
      response.end('{}')
    }
    await expect(client({ maxResponseBytes: 10 }).status(new AbortController().signal)).rejects.toMatchObject({
      kind: 'protocol',
    })

    handler = (_request, response) => {
      response.writeHead(204)
      response.end()
    }
    await expect(client().status(new AbortController().signal)).rejects.toThrow('returned an empty response')
  })

  it('distinguishes caller cancellation from its request timeout', async () => {
    handler = () => {}
    const controller = new AbortController()
    const cancelled = client().status(controller.signal)
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ kind: 'cancelled' })
    await expect(client({ timeoutMs: 10 }).status(new AbortController().signal)).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('reports network failures even when fetch rejects a non-Error value', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Fetch may reject with any JavaScript value.
    vi.stubGlobal('fetch', () => Promise.reject('socket unavailable'))
    const error: unknown = await client().status(new AbortController().signal).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(WebBridgeClientError)
    expect(error).toMatchObject({ kind: 'network' })
    expect(String(error)).toContain('socket unavailable')
  })

  it('rejects unsafe or malformed service roots at plugin load time', () => {
    expect(() => new WebBridgeClient({ baseURL: 'not a URL', timeoutMs: 1, maxResponseBytes: 1 })).toThrow(
      'baseURL must be an absolute HTTP(S) URL',
    )
    expect(() => new WebBridgeClient({ baseURL: 'ws://127.0.0.1:10086', timeoutMs: 1, maxResponseBytes: 1 })).toThrow(
      'baseURL protocol must be http or https',
    )
    expect(() => new WebBridgeClient({ baseURL: 'http://user:secret@127.0.0.1:10086', timeoutMs: 1, maxResponseBytes: 1 })).toThrow(
      'baseURL must not contain credentials',
    )
    expect(() => new WebBridgeClient({ baseURL: 'http://127.0.0.1:10086?token=x', timeoutMs: 1, maxResponseBytes: 1 })).toThrow(
      'baseURL must not contain a query string or fragment',
    )
  })

  it('preserves a configured path prefix when constructing endpoint URLs', async () => {
    const requestedPath = new Promise<string | undefined>((resolve) => {
      handler = (request, response) => {
        resolve(request.url)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{}')
      }
    })
    const pathClient = new WebBridgeClient({
      baseURL: `${baseURL}/bridge`,
      timeoutMs: 1_000,
      maxResponseBytes: 1_000,
    })
    await pathClient.status(new AbortController().signal)
    expect(await requestedPath).toBe('/bridge/status')
  })
})
