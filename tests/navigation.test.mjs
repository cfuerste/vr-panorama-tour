import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { Observable } from '@babylonjs/core/Misc/observable.js'

// Exercise the actual viewer methods with controllable texture completion.
// Constructor/DOM bootstrap are excluded; rendering is covered by headset QA.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const klass = ast.statements.find(ts.isClassDeclaration)
const constructor = klass.members.find(ts.isConstructorDeclaration)
const compiled = ts.transpile(klass.getText(ast)
  .replace(constructor.getText(ast), 'constructor() {}')
  .replaceAll('import.meta.env.BASE_URL', "'/vr-panorama-tour/'") + '\nglobalThis.Viewer = VRPanoramaViewer',
  { target: ts.ScriptTarget.ES2022 })
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness(vr = true) {
  const domes = [], requests = [], revoked = [], timers = new Map()
  let nextTimer = 0, peakBytes = 0
  class Dome {
    onLoadObservable = new Observable()
    onLoadErrorObservable = new Observable()
    ready = false
    disposed = false
    enabled = false
    rotation = { y: 1, copyFrom(other) { this.y = other.y } }
    material = { freeze() {}, backFaceCulling: false }
    mesh = { setEnabled: enabled => { this.enabled = enabled } }
    constructor(name) {
      this.name = name
      this.width = name.endsWith('_hq.jpg') ? 8192 : name.endsWith('_std.jpg') ? 4096 : 2048
      this.bytes = this.width * this.width * 2
      this.photoTexture = { isReady: () => this.ready, getSize: () => ({ width: this.width, height: this.width / 2 }) }
      domes.push(this)
      peakBytes = Math.max(peakBytes, domes.filter(d => !d.disposed).reduce((sum, d) => sum + d.bytes, 0))
    }
    finish() { this.ready = true; this.onLoadObservable.notifyObservers() }
    fail() { this.onLoadErrorObservable.notifyObservers('Decode failed') }
    dispose() { this.disposed = true; this.enabled = false }
  }
  class TestURL extends URL {
    static createObjectURL() { return `blob:${Math.random()}` }
    static revokeObjectURL(url) { revoked.push(url) }
  }
  const context = vm.createContext({ PhotoDome: Dome, URL: TestURL, AbortController, DOMException,
    navigator: { userAgent: 'Desktop' }, document: { hidden: false }, console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id },
    clearTimeout: id => timers.delete(id) })
  vm.runInContext(compiled, context)
  const viewer = new context.Viewer()
  viewer.isVRActive = vr
  viewer.panoramaData = Object.fromEntries(['old', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => [id,
    { image: `${id}.jpg`, links: [{ to: 'a' }, { to: 'b' }, { to: 'c' }] }]))
  viewer.preloader = {
    loadImage: async (url, signal) => { signal.throwIfAborted(); requests.push(url); return new Blob(['image']) },
    stopPreloading() {}, startPreloading: urls => { viewer.prefetched = urls }
  }
  let uiUpdates = 0
  for (const method of ['clearHotspots', 'createHotspots', 'updateFloorplan', 'updateVRCaption', 'updateInfoText']) {
    viewer[method] = () => { uiUpdates++ }
  }
  const old = new Dome('dome_old_mobile.jpg'); old.ready = true; old.enabled = true
  viewer.currentPanorama = 'old'; viewer.currentPhotoDome = old
  viewer.panoramaCache.set('/vr-panorama-tour/panos/optimized_natural/old_mobile.jpg',
    { photoDome: old, isActive: true, lastUsed: 0, bytes: old.bytes })
  return { viewer, domes, requests, revoked, timers, old,
    peakBytes: () => peakBytes, uiUpdates: () => uiUpdates,
    runPreload: () => { for (const [id, timer] of timers) if (timer.ms === 1500) { timers.delete(id); timer.fn() } }
  }
}

test('VR retains old view until preview is ready, then upgrades without moving the view or rebuilding UI', async () => {
  const h = harness()
  const loading = h.viewer.loadPanorama('a'); await tick()
  assert.equal(h.old.enabled, true)
  assert.equal(h.viewer.currentPanorama, 'old')
  const preview = h.domes.at(-1); assert.match(preview.name, /a_mobile.jpg$/)
  assert.equal(preview.enabled, false)
  preview.finish(); await loading; await tick()
  assert.equal(h.viewer.currentPanorama, 'a'); assert.equal(h.old.enabled, false)
  assert.equal(preview.enabled, true)
  preview.rotation.y = 0.75
  const updates = h.uiUpdates()
  const hq = h.domes.at(-1); assert.match(hq.name, /a_hq.jpg$/)
  hq.finish(); await tick()
  assert.equal(h.viewer.currentPhotoDome, hq)
  assert.equal(hq.rotation.y, 0.75)
  assert.equal(h.uiUpdates(), updates)
  assert.equal(h.revoked.length, 2)
  h.runPreload()
  assert.equal(h.viewer.prefetched.length, 2)
  assert.ok(h.viewer.prefetched.every(url => url.endsWith('_mobile.jpg')))
})

test('rapid navigation cancels an old texture upload and stale completion cannot replace the destination', async () => {
  const h = harness()
  const first = h.viewer.loadPanorama('a'); await tick()
  const stale = h.domes.at(-1)
  const second = h.viewer.loadPanorama('b'); await tick()
  assert.equal(stale.disposed, true)
  stale.finish(); await first
  assert.equal(h.viewer.currentPanorama, 'old')
  h.domes.at(-1).finish(); await second; await tick()
  h.domes.at(-1).finish(); await tick()
  assert.equal(h.viewer.currentPanorama, 'b')
  assert.ok(h.domes.filter(d => d.enabled).every(d => d.name.includes('b_hq')))
})

test('failed HQ keeps usable preview; failed preview falls back to HQ; total failure preserves prior view', async () => {
  const h = harness()
  const first = h.viewer.loadPanorama('a'); await tick()
  const preview = h.domes.at(-1); preview.finish(); await first; await tick()
  h.domes.at(-1).fail(); await tick()
  assert.equal(h.viewer.currentPhotoDome, preview)
  assert.equal(preview.enabled, true)
  const second = h.viewer.loadPanorama('b'); await tick()
  h.domes.at(-1).fail(); await tick()
  assert.match(h.domes.at(-1).name, /b_hq.jpg$/)
  h.domes.at(-1).fail(); await second
  assert.equal(h.viewer.currentPhotoDome, preview)
  const third = h.viewer.loadPanorama('c'); await tick()
  h.domes.at(-1).fail(); await tick()
  const full = h.domes.at(-1); full.finish(); await third
  assert.equal(h.viewer.currentPhotoDome, full)
  assert.equal(h.viewer.currentPanorama, 'c')
})

test('long VR tour respects texture byte and entry caps, including pending upload', async () => {
  const h = harness()
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const loading = h.viewer.loadPanorama(id); await tick()
    h.domes.at(-1).finish(); await loading; await tick()
    h.domes.at(-1).finish(); await tick()
    assert.ok(h.viewer.panoramaCache.size <= 6)
    assert.ok([...h.viewer.panoramaCache.values()].reduce((sum, e) => sum + e.bytes, 0) <= 256 * 1024 * 1024)
  }
  assert.ok(h.peakBytes() <= 256 * 1024 * 1024)
  const requests = h.requests.length
  await h.viewer.loadPanorama('h')
  assert.equal(h.requests.length, requests)
  assert.equal(h.viewer.currentPhotoDome.disposed, false)
})

test('desktop keeps standard quality and old scene during load; mode change cancels HQ', async () => {
  const h = harness(false)
  const loading = h.viewer.loadPanorama('a'); await tick()
  assert.match(h.domes.at(-1).name, /a_std.jpg$/)
  assert.equal(h.old.enabled, true)
  const standard = h.domes.at(-1); standard.finish(); await loading
  h.viewer.isVRActive = true
  await h.viewer.loadPanorama('a'); await tick()
  const hq = h.domes.at(-1); assert.match(hq.name, /a_hq.jpg$/)
  assert.equal(h.viewer.currentPhotoDome, standard)
  assert.equal(h.requests.some(url => url.endsWith('a_mobile.jpg')), false)
  h.viewer.isVRActive = false
  await h.viewer.loadPanorama('a'); await tick()
  hq.finish(); await tick()
  assert.equal(hq.disposed, true)
  assert.equal(h.viewer.currentPhotoDome, standard)
  h.runPreload()
  assert.ok(h.viewer.prefetched.every(url => url.endsWith('_std.jpg')))
})

test('texture timeout retains the old scene and releases failed resources', async () => {
  const h = harness(false)
  const loading = h.viewer.loadPanorama('a'); await tick()
  const pending = h.domes.at(-1)
  for (const timer of h.timers.values()) if (timer.ms === 30000) timer.fn()
  await loading
  assert.equal(pending.disposed, true)
  assert.equal(h.viewer.currentPhotoDome, h.old)
  assert.equal(h.revoked.length, 1)
})

test('failed network request preserves the scene, and a late aborted fetch cannot create a dome', async () => {
  const h = harness(false)
  const waiting = []
  h.viewer.preloader.loadImage = () => new Promise((resolve, reject) => waiting.push({ resolve, reject }))
  const first = h.viewer.loadPanorama('a')
  const second = h.viewer.loadPanorama('b')
  waiting[0].resolve(new Blob(['stale']))
  await first
  assert.equal(h.domes.length, 1)
  waiting[1].reject(new Error('Offline'))
  await second
  assert.equal(h.viewer.currentPhotoDome, h.old)
  assert.equal(h.old.enabled, true)
  assert.equal(h.viewer.loadController, null)
})

test('prefetch waits for HQ completion and continues after more than four visited locations', async () => {
  const h = harness()
  const loading = h.viewer.loadPanorama('a'); await tick()
  h.domes.at(-1).finish(); await loading; await tick()
  h.viewer.schedulePreloading(); h.runPreload()
  assert.equal(h.viewer.prefetched, undefined)
  h.domes.at(-1).finish(); await tick()
  h.runPreload()
  assert.equal(h.viewer.prefetched.length, 2)
  h.viewer.isVRActive = false
  for (const id of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const next = h.viewer.loadPanorama(id); await tick()
    h.domes.at(-1).finish(); await next
  }
  assert.ok(h.viewer.panoramaCache.size <= 6)
  h.viewer.prefetched = undefined
  h.runPreload()
  assert.equal(h.viewer.prefetched.length, 3)
})

test('navigating away during an HQ upgrade cancels it while retaining the visible preview', async () => {
  const h = harness()
  const first = h.viewer.loadPanorama('a'); await tick()
  const preview = h.domes.at(-1); preview.finish(); await first; await tick()
  const oldHQ = h.domes.at(-1)
  const second = h.viewer.loadPanorama('b'); await tick()
  assert.equal(oldHQ.disposed, true)
  assert.equal(preview.enabled, true)
  oldHQ.finish(); await tick()
  assert.equal(h.viewer.currentPhotoDome, preview)
  h.domes.at(-1).finish(); await second; await tick()
  h.domes.at(-1).finish(); await tick()
  assert.equal(h.viewer.currentPanorama, 'b')
})
