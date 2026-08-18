import { createServer, type IncomingMessage, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as ToolWebBridge from '../src/index.ts'

interface RecordedRequest {
  action: string
  args: Record<string, unknown>
  session: string
}

let server: Server
let baseURL: string
let requests: RecordedRequest[]
let context: Context
let fiber: Awaited<ReturnType<Context['plugin']>>
let callCounter = 0

beforeEach(async () => {
  requests = []
  server = createServer((request, response) => {
    if (request.url === '/status') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"running":true,"extensionConnected":true}')
      return
    }
    void readBody(request).then((body) => {
      const parsed = JSON.parse(body) as RecordedRequest
      requests.push(parsed)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ success: true, action: parsed.action, args: parsed.args }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  context = new Context()
  await context.plugin(SystemPrompt)
  await context.plugin(ToolRuntime)
  fiber = await context.plugin(ToolWebBridge, {
    baseURL,
    timeoutMs: 1_000,
    maxResponseBytes: 10_000,
    sessionPrefix: 'test',
  })
})

afterEach(async () => {
  await fiber.dispose()
  await context.fiber.dispose()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

function call(name: string, args: unknown): Promise<ToolExecutionResult> {
  const agent = { id: SessionId('agent-7') } as Agent
  return context.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`webbridge-${++callCounter}`),
    name,
    arguments: args,
    agent,
  })
}

describe('Kimi WebBridge tools', () => {
  it('registers the complete model-facing tool set and unregisters it on dispose', async () => {
    const names = context.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('webbridge_')).sort()
    expect(names).toEqual([
      'webbridge_click',
      'webbridge_close_tab',
      'webbridge_evaluate',
      'webbridge_fill',
      'webbridge_find_tab',
      'webbridge_list_tabs',
      'webbridge_navigate',
      'webbridge_press',
      'webbridge_screenshot',
      'webbridge_snapshot',
      'webbridge_status',
      'webbridge_type',
    ])
    await fiber.dispose()
    expect(context.tools.schemas().some(schema => schema.name.startsWith('webbridge_'))).toBe(false)
  })

  it('maps clean tool arguments to the documented WebBridge actions', async () => {
    const cases: Array<[string, Record<string, unknown>, string, Record<string, unknown>]> = [
      ['webbridge_navigate', { url: 'https://example.com', newTab: true, group_title: 'Research' }, 'navigate', { url: 'https://example.com', newTab: true, group_title: 'Research' }],
      ['webbridge_snapshot', {}, 'snapshot', {}],
      ['webbridge_click', { selector: '@e2' }, 'click', { selector: '@e2' }],
      ['webbridge_fill', { selector: '@e3', value: 'hello' }, 'fill', { selector: '@e3', value: 'hello' }],
      ['webbridge_type', { text: ' world' }, 'key_type', { text: ' world' }],
      ['webbridge_press', { keys: 'Enter', repeat: 2 }, 'send_keys', { keys: 'Enter', repeat: 2 }],
      ['webbridge_screenshot', { format: 'jpeg', quality: 80, selector: '@e4', path: '/tmp/page.jpg' }, 'screenshot', { format: 'jpeg', quality: 80, selector: '@e4', path: '/tmp/page.jpg' }],
      ['webbridge_evaluate', { code: 'document.title' }, 'evaluate', { code: 'document.title' }],
      ['webbridge_find_tab', { url: 'https://example.com', active: true }, 'find_tab', { url: 'https://example.com', active: true }],
      ['webbridge_list_tabs', {}, 'list_tabs', {}],
      ['webbridge_close_tab', {}, 'close_tab', {}],
    ]

    for (const [tool, args] of cases) {
      const result = await call(tool, args)
      expect(result.isError, tool).toBe(false)
    }
    expect(requests).toEqual(cases.map(([, , action, args]) => ({ action, args, session: 'test-agent-7' })))
  })

  it('returns structured reachability from webbridge_status', async () => {
    const result = await call('webbridge_status', {})
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({
      reachable: true,
      baseURL,
      status: { running: true, extensionConnected: true },
    })
  })

  it('validates keyboard repeats and screenshot quality before contacting the daemon', async () => {
    const badRepeat = await call('webbridge_press', { keys: 'Enter', repeat: 0 })
    const badQuality = await call('webbridge_screenshot', { format: 'jpeg', quality: 101 })
    expect(badRepeat.isError).toBe(true)
    expect(badQuality.isError).toBe(true)
    expect(requests).toEqual([])
  })

  it('rejects command execution without an owning agent session', async () => {
    const result = await context.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('webbridge-no-agent'),
      name: 'webbridge_snapshot',
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: 'Error: Kimi WebBridge commands require an owning dsh agent session' },
    ])
  })

  it('turns status failures into diagnostics but preserves cancellation', async () => {
    const signal = new AbortController().signal
    const exec = { signal } as ToolRunContext
    const config = ToolWebBridge.resolveConfig({})
    const failedClient = {
      baseURL: 'http://127.0.0.1:10086',
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Service clients may reject with any JavaScript value.
      status: () => Promise.reject('extension unavailable'),
    } as unknown as ToolWebBridge.WebBridgeClient
    const failedStatus = ToolWebBridge.createWebBridgeTools(failedClient, config)
      .find(tool => tool.name === 'webbridge_status')
    await expect(failedStatus?.execute({}, exec)).resolves.toEqual({
      reachable: false,
      baseURL: 'http://127.0.0.1:10086',
      error: 'extension unavailable',
    })

    const errorClient = {
      baseURL: 'http://127.0.0.1:10086',
      status: () => Promise.reject(new Error('daemon offline')),
    } as unknown as ToolWebBridge.WebBridgeClient
    const errorStatus = ToolWebBridge.createWebBridgeTools(errorClient, config)
      .find(tool => tool.name === 'webbridge_status')
    await expect(errorStatus?.execute({}, exec)).resolves.toEqual({
      reachable: false,
      baseURL: 'http://127.0.0.1:10086',
      error: 'daemon offline',
    })

    const cancelledClient = {
      baseURL: 'http://127.0.0.1:10086',
      status: () => Promise.reject(new ToolWebBridge.WebBridgeClientError('cancelled', 'cancelled')),
    } as unknown as ToolWebBridge.WebBridgeClient
    const cancelledStatus = ToolWebBridge.createWebBridgeTools(cancelledClient, config)
      .find(tool => tool.name === 'webbridge_status')
    await expect(cancelledStatus?.execute({}, exec)).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('uses the environment base URL only when plugin config omits it', () => {
    expect(ToolWebBridge.resolveConfig({}, { DSH_WEBBRIDGE_BASE_URL: 'http://127.0.0.1:20000' }).baseURL).toBe(
      'http://127.0.0.1:20000',
    )
    expect(ToolWebBridge.resolveConfig(
      { baseURL: 'http://127.0.0.1:30000' },
      { DSH_WEBBRIDGE_BASE_URL: 'http://127.0.0.1:20000' },
    ).baseURL).toBe('http://127.0.0.1:30000')
  })

  it('resolves defaults and rejects invalid deployment limits', () => {
    expect(ToolWebBridge.resolveConfig({}, {})).toEqual({
      baseURL: ToolWebBridge.DEFAULT_WEBBRIDGE_BASE_URL,
      timeoutMs: ToolWebBridge.DEFAULT_WEBBRIDGE_TIMEOUT_MS,
      maxResponseBytes: ToolWebBridge.DEFAULT_WEBBRIDGE_MAX_RESPONSE_BYTES,
      sessionPrefix: ToolWebBridge.DEFAULT_WEBBRIDGE_SESSION_PREFIX,
    })
    expect(() => ToolWebBridge.resolveConfig({ sessionPrefix: ' ' })).toThrow('sessionPrefix must not be empty')
    expect(() => ToolWebBridge.resolveConfig({ timeoutMs: 0 })).toThrow('timeoutMs must be a positive integer')
    expect(() => ToolWebBridge.resolveConfig({ maxResponseBytes: 1.5 })).toThrow(
      'maxResponseBytes must be a positive integer',
    )
  })
})

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
