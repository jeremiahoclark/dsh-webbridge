/**
 * Package-owned invariant companion for `dsh-webbridge`.
 * @module dsh-webbridge/invariant
 */
const PACKAGE_NAME = 'dsh-webbridge';
/** Cordis companion plugin name. */
export const name = 'tool-webbridge-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: this HTTP tool adapter owns no independent lifecycle stream. */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//# sourceMappingURL=invariant.js.map