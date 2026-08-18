/**
 * Bounded HTTP client for the local Kimi WebBridge daemon.
 * @module dsh-webbridge/client
 */
/** A value accepted by JSON serialization. */
export type WebBridgeJsonValue = null | boolean | number | string | WebBridgeJsonValue[] | {
    [key: string]: WebBridgeJsonValue;
};
/** WebBridge commands proxied by this package. */
export type WebBridgeAction = 'navigate' | 'snapshot' | 'click' | 'fill' | 'key_type' | 'send_keys' | 'screenshot' | 'evaluate' | 'find_tab' | 'list_tabs' | 'close_tab';
/** Stable failure categories exposed by {@link WebBridgeClientError}. */
export type WebBridgeClientErrorKind = 'cancelled' | 'timeout' | 'network' | 'http' | 'protocol' | 'service';
/** An actionable failure from the WebBridge HTTP service. */
export declare class WebBridgeClientError extends Error {
    /** Stable failure category for callers that need to distinguish cancellation. */
    readonly kind: WebBridgeClientErrorKind;
    /**
     * Create a WebBridge client failure.
     * @param kind - Stable failure category.
     * @param message - Human-readable diagnostic.
     * @param options - Optional underlying error.
     */
    constructor(kind: WebBridgeClientErrorKind, message: string, options?: ErrorOptions);
}
/** Construction options for {@link WebBridgeClient}. */
export interface WebBridgeClientOptions {
    /** Service root containing `/command` and `/status`. */
    baseURL: string;
    /** Per-request timeout in milliseconds. */
    timeoutMs: number;
    /** Maximum decoded HTTP response size in bytes. */
    maxResponseBytes: number;
}
/** HTTP client for an already-running Kimi WebBridge daemon. */
export declare class WebBridgeClient {
    #private;
    /** Normalized service root used by diagnostics. */
    readonly baseURL: string;
    /**
     * Create a client without connecting to or starting the daemon.
     * @param options - Resolved endpoint and response limits.
     */
    constructor(options: WebBridgeClientOptions);
    /**
     * Forward one command to the daemon.
     * @param action - WebBridge action name.
     * @param args - Action-specific JSON arguments.
     * @param session - Stable WebBridge task/session name.
     * @param signal - Caller cancellation signal.
     * @returns The daemon's JSON result unchanged.
     */
    command(action: WebBridgeAction, args: Record<string, WebBridgeJsonValue>, session: string, signal: AbortSignal): Promise<WebBridgeJsonValue>;
    /**
     * Read the daemon's status document.
     * @param signal - Caller cancellation signal.
     * @returns The daemon's JSON status unchanged.
     */
    status(signal: AbortSignal): Promise<WebBridgeJsonValue>;
}
//# sourceMappingURL=client.d.ts.map