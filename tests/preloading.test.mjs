import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.transpile(readFileSync(new URL('../src/panoramaPreloader.ts', import.meta.url), 'utf8'), {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
})

function harness(fetch, bytes = 24, entries = 3) {
  const revoked = []
  class TestURL extends URL {
    static createObjectURL() { return `blob:test-${Math.random()}` }
    static revokeObjectURL(url) { revoked.push(url) }
  }
  const context = vm.createContext({ exports: {}, URL: TestURL, document: { baseURI: 'https://tour.test/vr-panorama-tour/' },
    AbortController, setTimeout, clearTimeout, fetch, console })
  vm.runInContext(source, context)
  return { cache: new context.exports.PanoramaPreloader(bytes, entries), revoked }
}

const response = size => ({ ok: true, blob: async () => new Blob([new Uint8Array(size)]) })
const tick = () => new Promise(resolve => setImmediate(resolve))

test('absolute, relative, encoded and Unicode URLs share a download', async () => {
  let calls = 0
  const { cache } = harness(async () => { calls++; return response(4) })
  await cache.loadImage('panos/Büro_mobile.jpg')
  await cache.loadImage('https://tour.test/vr-panorama-tour/panos/B%C3%BCro_mobile.jpg')
  assert.equal(calls, 1)
  assert.equal(cache.isImagePreloaded('/vr-panorama-tour/panos/Büro_mobile.jpg'), true)
  cache.dispose()
})

test('byte and entry budgets evict least recently used images and revoke URLs', async () => {
  const { cache, revoked } = harness(async () => response(8), 16, 2)
  await cache.loadImage('a'); await cache.loadImage('b')
  const urlB = cache.getPreloadedImage('b')
  await cache.loadImage('a') // a is most recently used
  await cache.loadImage('c')
  assert.equal(cache.isImagePreloaded('a'), true)
  assert.equal(cache.isImagePreloaded('b'), false)
  assert.deepEqual(revoked, [urlB])
  assert.equal(cache.getCacheStats().bytes, 16)
  for (let i = 0; i < 50; i++) await cache.loadImage(`tour-${i}`)
  assert.equal(cache.getCacheStats().entries, 2)
  assert.equal(cache.getCacheStats().bytes, 16)
  cache.dispose()
  assert.equal(cache.getCacheStats().bytes, 0)
})

test('oversize and failed downloads are not cached; failed requests can retry', async () => {
  let fail = true
  const { cache } = harness(async url => {
    if (url.endsWith('large')) return response(40)
    if (fail) { fail = false; return { ok: false, status: 503 } }
    return response(4)
  })
  await cache.loadImage('large')
  assert.equal(cache.getCacheStats().entries, 0)
  await assert.rejects(cache.loadImage('retry'), /503/)
  await cache.loadImage('retry')
  assert.equal(cache.isImagePreloaded('retry'), true)
  cache.dispose()
})

test('prefetch is sequential, deduplicated and cancellable without stale callbacks', async () => {
  const pending = []
  const { cache } = harness((url, { signal }) => new Promise((resolve, reject) => {
    pending.push({ url, resolve, signal })
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
  }))
  let staleCompleted = false
  cache.startPreloading(['a', 'a', 'b'], '', undefined, () => { staleCompleted = true })
  assert.equal(pending.length, 1)
  cache.stopPreloading()
  await tick()
  assert.equal(pending[0].signal.aborted, true)
  assert.equal(staleCompleted, false)
  let completed = false
  cache.startPreloading(['c', 'c', 'd'], '', undefined, () => { completed = true })
  pending[1].resolve(response(4)); await tick()
  assert.equal(pending.length, 3)
  pending[2].resolve(response(4)); await tick()
  assert.equal(completed, true)
  assert.equal(cache.getPreloadProgress().loaded, 2)
  assert.equal(cache.getPreloadProgress().total, 2)
  assert.equal(cache.isImagePreloaded('a'), false)
  cache.dispose()
})

test('foreground cancellation and disposal abort outstanding transfers', async () => {
  const signals = []
  const { cache } = harness((_url, { signal }) => new Promise((_resolve, reject) => {
    signals.push(signal)
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
  }))
  const controller = new AbortController()
  const first = cache.loadImage('a', controller.signal)
  controller.abort()
  await assert.rejects(first, { name: 'AbortError' })
  const second = cache.loadImage('b')
  cache.dispose()
  await assert.rejects(second, { name: 'AbortError' })
  assert.ok(signals.every(signal => signal.aborted))
  await assert.rejects(cache.loadImage('c'), /disposed/)
})
