/**
 * Test stub for the `server-only` package.
 *
 * Aliased in `vitest.config.ts`. The real package throws when imported outside
 * a server context; under the unit runner there is no such context, and the
 * modules being tested are pure functions with no server dependency at the
 * points under test.
 */
export {};
