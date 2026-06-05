// Test-environment stub for the `server-only` package. The real module throws
// when imported anywhere other than a React Server Components build; Vitest runs
// in plain Node, so vitest.config.ts aliases the import here.
export {};
