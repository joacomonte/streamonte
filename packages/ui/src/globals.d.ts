// Tipos mínimos de Node para los *.test.ts (sin @types/node): solo lo que usan los tests. Sin `any`.
declare module 'node:test' {
  export function test(name: string, fn: () => unknown): void;
  export function afterEach(fn: () => unknown): void;
}
declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    rejects(fn: Promise<unknown> | (() => Promise<unknown>), expected?: unknown): Promise<void>;
  }
  const assert: Assert;
  export default assert;
}
declare module 'node:fs' {
  export function readdirSync(path: URL, opts: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  export function readFileSync(path: URL | string, enc: 'utf8'): string;
}
