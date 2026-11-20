import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outdir = 'lib'
mkdirSync(outdir, { recursive: true })

const common = { bundle: true, logLevel: 'info' }
await build({
  ...common,
  entryPoints: ['src/index.ts'],
  outfile: join(outdir, 'index.js'),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['@deepseek-ai/cordis', 'sherpa-onnx', 'sherpa-onnx-node', 'node:*'],
})
await build({
  ...common,
  entryPoints: ['src/word/index.ts'],
  outfile: join(outdir, 'word/index.js'),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['node:*'],
})
await build({
  ...common,
  entryPoints: ['src/host/sense-worker.ts'],
  outfile: join(outdir, 'sense-worker.mjs'),
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['sherpa-onnx', 'node:*'],
})
const worklet = await build({
  entryPoints: ['src/client/audio-worklet.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
})
await build({
  ...common,
  entryPoints: ['src/client/client.tsx'],
  outfile: join(outdir, 'client.js'),
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  define: { __AUDIO_WORKLET__: JSON.stringify(worklet.outputFiles[0].text) },
  banner: { js: `window.__ModuleLoader__.load({ id: 'dsh-meetscribe', factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
})
console.log('[dsh-meetscribe] Built host, worker and browser client.')
