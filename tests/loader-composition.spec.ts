import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolWebBridge from '../src/index.ts'

let root: string | undefined
let context: Context | undefined
let server: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  if (server !== undefined) await new Promise<void>(resolve => server?.close(() => { resolve() }))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  context = undefined
  server = undefined
  root = undefined
})

describe('tool-webbridge real Loader composition', () => {
  it('boots cordis.yml, applies endpoint config, and executes through ctx.tools', async () => {
    server = createServer((request, response) => {
      expect(request.method).toBe('GET')
      expect(request.url).toBe('/status')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"running":true}')
    })
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
    const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    root = await mkdtemp(join(tmpdir(), 'dsh-webbridge-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-tool-webbridge'",
      '  config:',
      `    baseURL: ${baseURL}`,
      '    timeoutMs: 1000',
      '    maxResponseBytes: 1000',
      '    sessionPrefix: loader',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-tool-webbridge', ToolWebBridge],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    expect(context.tools.schemas().map(schema => schema.name)).toContain('webbridge_status')
    const result = await context.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('loader-status'),
      name: 'webbridge_status',
      arguments: {},
    })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ reachable: true, baseURL, status: { running: true } })
  })
})
