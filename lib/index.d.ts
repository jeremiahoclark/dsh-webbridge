/**
 * Model-facing Kimi WebBridge tools over its local HTTP service. The plugin
 * starts no browser or daemon and performs no browser automation itself.
 * @module dsh-webbridge
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { WebBridgeClient } from './client.ts';
export { WebBridgeClient, WebBridgeClientError } from './client.ts';
export type { WebBridgeAction, WebBridgeClientErrorKind, WebBridgeClientOptions, WebBridgeJsonValue } from './client.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "tool-webbridge";
/** Services required by the Kimi WebBridge tools. */
export declare const inject: string[];
/** Official Kimi WebBridge local HTTP service root. */
export declare const DEFAULT_WEBBRIDGE_BASE_URL = "http://127.0.0.1:10086";
/** Default per-request timeout in milliseconds. */
export declare const DEFAULT_WEBBRIDGE_TIMEOUT_MS = 60000;
/** Default maximum decoded response size in bytes. */
export declare const DEFAULT_WEBBRIDGE_MAX_RESPONSE_BYTES = 5000000;
/** Default prefix for daemon tab-group sessions derived from dsh sessions. */
export declare const DEFAULT_WEBBRIDGE_SESSION_PREFIX = "dsh";
/** Kimi WebBridge plugin configuration. */
export interface Config {
    /** Service root. Defaults to `DSH_WEBBRIDGE_BASE_URL`, then `http://127.0.0.1:10086`. */
    baseURL?: string;
    /** Per-request timeout in milliseconds. Defaults to 60000. */
    timeoutMs?: number;
    /** Maximum decoded HTTP response size in bytes. Defaults to 5000000. */
    maxResponseBytes?: number;
    /** Prefix for WebBridge sessions derived from dsh agent session ids. Defaults to `dsh`. */
    sessionPrefix?: string;
}
export declare const Config: z<Config>;
/** Complete configuration resolved before client creation. */
export interface ResolvedConfig {
    /** Normalized source value for the HTTP client. */
    baseURL: string;
    /** Per-request timeout in milliseconds. */
    timeoutMs: number;
    /** Maximum decoded response size in bytes. */
    maxResponseBytes: number;
    /** Prefix for automatically derived WebBridge sessions. */
    sessionPrefix: string;
}
/**
 * Resolve defaults and validate the deployment configuration.
 * @param config - Cordis plugin configuration after schema defaults.
 * @param environment - Process environment used for the base URL fallback.
 * @returns Complete client and session settings.
 */
export declare function resolveConfig(config: Config, environment?: NodeJS.ProcessEnv): ResolvedConfig;
/**
 * Create the complete model-facing tool set around one HTTP client.
 * @param client - Client connected lazily by each tool execution.
 * @param config - Resolved session and timeout settings.
 * @returns Registry-ready tool definitions.
 */
export declare function createWebBridgeTools(client: WebBridgeClient, config: ResolvedConfig): ToolDefinition[];
/**
 * Register the Kimi WebBridge tools. The plugin only creates an HTTP client;
 * each request reaches the user's separately managed daemon and browser.
 * @param ctx - Cordis context carrying the tool registry.
 * @param config - Endpoint, timeout, response cap, and session settings.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map