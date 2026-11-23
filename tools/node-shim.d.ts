// The one thing the tools take from Node that TypeScript has to be told about: the project has no @types/node
// (tools/pacing.ts declares `process` for itself in the same way).
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
}
