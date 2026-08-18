/**
 * Bounded HTTP client for the local Kimi WebBridge daemon.
 * @module dsh-webbridge/client
 */

/** A value accepted by JSON serialization. */
export type WebBridgeJsonValue =
  | null
  | boolean
  | number
  | string
  | WebBridgeJsonValue[]
  | { [key: string]: WebBridgeJsonValue }

/** WebBridge commands proxied by this package. */
export type WebBridgeAction =
  | 'navigate'
  | 'snapshot'
  | 'click'
  | 'fill'
  | 'key_type'
  | 'send_keys'
  | 'screenshot'
  | 'evaluate'
  | 'find_tab'
  | 'list_tabs'
  | 'close_tab'

/** Stable failure categories exposed by {@link WebBridgeClientError}. */
export type WebBridgeClientErrorKind = 'cancelled' | 'timeout' | 'network' | 'http' | 'protocol' | 'service'

/** An actionable failure from the WebBridge HTTP service. */
export class WebBridgeClientError extends Error {
  /** Stable failure category for callers that need to distinguish cancellation. */
  readonly kind: WebBridgeClientErrorKind

  /**
   * Create a WebBridge client failure.
   * @param kind - Stable failure category.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying error.
   */
  constructor(kind: WebBridgeClientErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WebBridgeClientError'
    this.kind = kind
  }
}

/** Construction options for {@link WebBridgeClient}. */
export interface WebBridgeClientOptions {
  /** Service root containing `/command` and `/status`. */
  baseURL: string
  /** Per-request timeout in milliseconds. */
  timeoutMs: number
  /** Maximum decoded HTTP response size in bytes. */
  maxResponseBytes: number
}

/** HTTP client for an already-running Kimi WebBridge daemon. */
export class WebBridgeClient {
  /** Normalized service root used by diagnostics. */
  readonly baseURL: string
  readonly #commandURL: URL
  readonly #statusURL: URL
  readonly #timeoutMs: number
  readonly #maxResponseBytes: number

  /**
   * Create a client without connecting to or starting the daemon.
   * @param options - Resolved endpoint and response limits.
   */
  constructor(options: WebBridgeClientOptions) {
    const root = normalizeBaseURL(options.baseURL)
    this.baseURL = root.href.replace(/\/$/, '')
    this.#commandURL = new URL('command', root)
    this.#statusURL = new URL('status', root)
    this.#timeoutMs = options.timeoutMs
    this.#maxResponseBytes = options.maxResponseBytes
  }

  /**
   * Forward one command to the daemon.
   * @param action - WebBridge action name.
   * @param args - Action-specific JSON arguments.
   * @param session - Stable WebBridge task/session name.
   * @param signal - Caller cancellation signal.
   * @returns The daemon's JSON result unchanged.
   */
  command(
    action: WebBridgeAction,
    args: Record<string, WebBridgeJsonValue>,
    session: string,
    signal: AbortSignal,
  ): Promise<WebBridgeJsonValue> {
    return this.#request(
      this.#commandURL,
      `command ${action}`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action, args, session }),
      },
      signal,
    )
  }

  /**
   * Read the daemon's status document.
   * @param signal - Caller cancellation signal.
   * @returns The daemon's JSON status unchanged.
   */
  status(signal: AbortSignal): Promise<WebBridgeJsonValue> {
    return this.#request(
      this.#statusURL,
      'status check',
      { headers: { accept: 'application/json' } },
      signal,
    )
  }

  async #request(url: URL, operation: string, init: RequestInit, callerSignal: AbortSignal): Promise<WebBridgeJsonValue> {
    const timeout = new AbortController()
    const timer = setTimeout(() => {
      timeout.abort(new Error(`timed out after ${this.#timeoutMs}ms`))
    }, this.#timeoutMs)
    const signal = AbortSignal.any([callerSignal, timeout.signal])

    try {
      const response = await fetch(url, { ...init, signal })
      const text = await readBoundedText(response, this.#maxResponseBytes)
      const value = parseJson(text, operation)
      if (!response.ok) {
        throw new WebBridgeClientError(
          'http',
          `Kimi WebBridge ${operation} failed with HTTP ${response.status}: ${errorDetail(value)}`,
        )
      }
      const serviceError = errorField(value)
      if (serviceError !== undefined) {
        throw new WebBridgeClientError('service', `Kimi WebBridge ${operation} failed: ${serviceError}`)
      }
      return value
    } catch (error) {
      if (error instanceof WebBridgeClientError) throw error
      if (callerSignal.aborted) {
        throw new WebBridgeClientError('cancelled', `Kimi WebBridge ${operation} was cancelled`, { cause: error })
      }
      if (timeout.signal.aborted) {
        throw new WebBridgeClientError(
          'timeout',
          `Kimi WebBridge ${operation} timed out after ${this.#timeoutMs}ms`,
          { cause: error },
        )
      }
      throw new WebBridgeClientError(
        'network',
        `Cannot reach Kimi WebBridge at ${this.baseURL} for ${operation}: ${errorMessage(error)}. Ensure the daemon is running and the browser extension is connected.`,
        { cause: error },
      )
    } finally {
      clearTimeout(timer)
    }
  }
}

function normalizeBaseURL(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error(`tool-webbridge: baseURL must be an absolute HTTP(S) URL: ${errorMessage(error)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`tool-webbridge: baseURL protocol must be http or https, received ${url.protocol}`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('tool-webbridge: baseURL must not contain credentials')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('tool-webbridge: baseURL must not contain a query string or fragment')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new WebBridgeClientError(
      'protocol',
      `Kimi WebBridge response exceeds maxResponseBytes (${declaredLength} > ${maxBytes})`,
    )
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      throw new WebBridgeClientError(
        'protocol',
        `Kimi WebBridge response exceeds maxResponseBytes (${bytes} > ${maxBytes})`,
      )
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}

function parseJson(text: string, operation: string): WebBridgeJsonValue {
  if (text.trim() === '') {
    throw new WebBridgeClientError('protocol', `Kimi WebBridge ${operation} returned an empty response`)
  }
  try {
    return JSON.parse(text) as WebBridgeJsonValue
  } catch (error) {
    throw new WebBridgeClientError(
      'protocol',
      `Kimi WebBridge ${operation} returned invalid JSON: ${errorMessage(error)}`,
      { cause: error },
    )
  }
}

function errorDetail(value: WebBridgeJsonValue): string {
  return errorField(value) ?? objectString(value, 'message') ?? JSON.stringify(value)
}

function errorField(value: WebBridgeJsonValue): string | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const error = value.error
  if (typeof error === 'string') return error
  return objectString(error, 'message')
}

function objectString(value: WebBridgeJsonValue | undefined, key: string): string | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const member = value[key]
  return typeof member === 'string' ? member : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
