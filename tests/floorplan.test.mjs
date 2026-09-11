import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { Control, Rectangle, Button, TextBlock } from '@babylonjs/gui/index.js'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js'
import { Scene } from '@babylonjs/core/scene.js'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js'
import { Tools } from '@babylonjs/core/Misc/tools.js'
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js'
import { Measure } from '@babylonjs/gui/2D/measure.js'

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const klass = ast.statements.find(ts.isClassDeclaration)
const names = ['positionViewDirectionIndicator', 'updateViewAngle', 'adjustCoordinatesForAspectRatio',
  'setupVRFloorButtons', 'addFloorSwitchButtons', 'createFloorplanPositionMarkerWithBlending', 'createViewDirectionIndicator']
const methods = klass.members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast)).join('\n')
const code = ts.transpile(`class MapLayout { ${methods} }`, { target: ts.ScriptTarget.ES2022 })
const fakeTexture = { CreateForMesh: () => ({ addControl() {} }) }
const Layout = new Function('Control', 'UniversalCamera', 'Tools', 'MeshBuilder', 'AdvancedDynamicTexture', 'Rectangle', 'Button', 'TextBlock',
  `${code}; return MapLayout`)(Control, UniversalCamera, Tools, MeshBuilder, fakeTexture, Rectangle, Button, TextBlock)

test('both ray pivots coincide with marker center across coordinates and texture scales', () => {
  const layout = new Layout(); layout.isVRActive = true
  for (const [width, height, scale] of [[320, 640 / 3, 1], [960, 640, 3]]) {
    for (const [x, y] of [[0, 0], [.2, .8], [.5, .5], [1, 1]]) {
      const coords = layout.adjustCoordinatesForAspectRatio(x, y)
      const ray = new Rectangle()
      layout.positionViewDirectionIndicator(ray, coords)
      // Run Babylon's actual alignment math with resolved logical dimensions.
      ray._currentMeasure = new Measure(0, 0, 2 * scale, 25 * scale)
      ray._computeAlignment(new Measure(0, 0, width, height), {})
      const m = ray._currentMeasure
      assert.ok(Math.abs(m.left + m.width / 2 - coords.x * width) < 1e-8)
      assert.ok(Math.abs(m.top + m.height - coords.y * height) < 1e-8)
      assert.equal(ray.isHitTestVisible, false)
      ray.dispose()
    }
  }
})

test('VR rays point opposite the reported backward heading without changing turning behavior', () => {
  const layout = new Layout(); layout.isVRActive = true
  const left = new Rectangle(), right = new Rectangle()
  left.metadata = { viewAngle: 60 }
  layout.xrHelper = null
  const setup = klass.members.find(m => m.name?.getText(ast) === 'setupFloorplanUI').getText(ast)
  const yMatch = setup.match(/floorplanPlane\.rotation\.y = ([^\n]+)/)
  const zMatch = setup.match(/floorplanPlane\.rotation\.z = ([^\n]+)/)
  const yaw = new Function(`return ${yMatch[1]}`)()
  const roll = new Function(`return ${zMatch[1]}`)()
  assert.equal(roll, Math.PI)
  const before = Matrix.RotationYawPitchRoll(yaw, 0, 0)
  const after = Matrix.RotationYawPitchRoll(yaw, 0, roll)
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, .37]) {
    layout.scene = { activeCamera: { getForwardRay: () => ({ direction: { x: Math.sin(heading), z: Math.cos(heading) } }) } }
    layout.updateViewAngle(left, right)
    for (const [ray, side] of [[left, -1], [right, 1]]) {
      const oldAngle = heading - Math.PI / 2 + side * Math.PI / 6
      // GUI Y points down, whereas plane Y points up.
      const oldDirection = Vector3.TransformNormal(new Vector3(Math.sin(oldAngle), Math.cos(oldAngle), 0), before)
      const newDirection = Vector3.TransformNormal(new Vector3(Math.sin(ray.rotation), Math.cos(ray.rotation), 0), after)
      assert.ok(Vector3.Distance(oldDirection.negate(), newDirection) < 1e-8)
      assert.equal(ray.transformCenterY, 1)
    }
  }
  left.dispose(); right.dispose()
})

test('desktop markers center on the image, accounting for real panel aspect ratio and border', () => {
  const layout = new Layout()
  layout.isVRActive = false
  layout.currentPanorama = 'current'
  layout.floorplanPositionMarkers = []
  const panel = new Rectangle(); panel.widthInPixels = 320; panel.heightInPixels = 250; panel.thickness = 2
  layout.desktopFloorplanPanel = panel
  const width = 316, height = 246, imageHeight = width * 751 / 1000
  for (const [x, y] of [[.1, .1], [.5, .5], [.9, .9]]) {
    const coords = layout.adjustCoordinatesForAspectRatio(x, y)
    assert.ok(Math.abs(coords.y * height - ((height - imageHeight) / 2 + y * imageHeight)) < 1e-8)
    layout.createFloorplanPositionMarkerWithBlending(panel, 'current', { map: { x, y }, floor: 'EG' }, 'EG')
    const marker = layout.floorplanPositionMarkers.at(-1)
    marker._currentMeasure = new Measure(0, 0, 13, 13)
    marker._computeAlignment(new Measure(0, 0, width, height), {})
    const m = marker._currentMeasure
    assert.ok(Math.abs(m.left + m.width / 2 - x * width) < 1e-8)
    assert.ok(Math.abs(m.top + m.height / 2 - coords.y * height) < 1e-8)
  }
  panel.dispose()
})

test('desktop creates the view indicator and follows the desktop camera even after an XR session', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  const camera = new UniversalCamera('desktop', Vector3.Zero(), scene)
  scene.activeCamera = camera
  const layout = new Layout()
  layout.scene = scene; layout.camera = camera; layout.isVRActive = false
  layout.currentPanorama = 'current'
  layout.panoramaData = { current: { map: { x: .25, y: .7 } } }
  layout.xrHelper = { baseExperience: { camera: { getForwardRay() { throw new Error('Inactive XR camera used') } } } }
  const panel = new Rectangle()
  layout.createViewDirectionIndicator(panel)
  const left = layout.floorplanViewDirectionIndicator
  const right = left.metadata.rightIndicator
  assert.equal(panel.children.length, 2)
  for (const yaw of [0, .5, -1, Math.PI]) {
    camera.rotation.y = yaw
    layout.updateViewAngle(left, right)
    assert.ok(Math.abs(left.rotation - (yaw - Math.PI / 2 - Math.PI / 6)) < 1e-6)
    assert.ok(Math.abs(right.rotation - (yaw - Math.PI / 2 + Math.PI / 6)) < 1e-6)
  }
  const coords = layout.adjustCoordinatesForAspectRatio(.25, .7)
  for (const ray of [left, right]) {
    ray._currentMeasure = new Measure(0, 0, 2, 25)
    ray._computeAlignment(new Measure(0, 0, 316, 246), {})
    assert.ok(Math.abs(ray._currentMeasure.top + 25 - coords.y * 246) < 1e-8)
    assert.equal(ray.isHitTestVisible, false)
  }
  panel.dispose(); scene.dispose(); engine.dispose()
})

test('VR floor buttons occupy a separate plane above the unchanged map and remain clickable', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  const layout = new Layout(); layout.scene = scene; layout.isVRActive = true
  layout.selectedFloor = 'EG'; layout.floorSwitchButtons = []
  let selected
  layout.switchToFloor = floor => { selected = floor }
  const map = MeshBuilder.CreatePlane('floorplan', { width: .6, height: .4 }, scene)
  layout.setupVRFloorButtons(map, .6, .4)
  const row = scene.getMeshByName('floor_buttons')
  assert.equal(row.parent, map)
  const rowHalfHeight = row.getBoundingInfo().boundingBox.extendSize.y
  assert.ok(row.position.y - rowHalfHeight > .2)
  assert.equal(layout.floorSwitchButtons.length, 4)
  for (const button of layout.floorSwitchButtons) {
    assert.equal(button.parent.name, 'floor_buttons_background')
    assert.ok(button.topInPixels >= 0 && button.topInPixels + button.heightInPixels <= 50)
    assert.ok(button.leftInPixels >= 0 && button.leftInPixels + button.widthInPixels <= 320)
    button.onPointerClickObservable.notifyObservers({})
    assert.equal(selected, button.name.replace('floor_button_', ''))
    button.dispose()
  }
  scene.dispose(); engine.dispose()
})

test('desktop and VR use the same forward heading at all four compass directions', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  const camera = new UniversalCamera('desktop', Vector3.Zero(), scene)
  scene.activeCamera = camera
  const layout = new Layout(); layout.scene = scene
  const left = new Rectangle(), right = new Rectangle()
  left.metadata = { viewAngle: 60 }
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    camera.rotation.y = yaw
    layout.isVRActive = false
    layout.updateViewAngle(left, right)
    const desktopHeading = (left.rotation + right.rotation) / 2
    const expected = yaw - Math.PI / 2
    assert.ok(Math.abs(Math.sin(desktopHeading) - Math.sin(expected)) < 1e-6)
    assert.ok(Math.abs(Math.cos(desktopHeading) - Math.cos(expected)) < 1e-6)
    layout.isVRActive = true
    layout.xrHelper = { baseExperience: { camera: {
      getForwardRay: () => ({ direction: { x: Math.sin(yaw), z: Math.cos(yaw) } })
    } } }
    layout.updateViewAngle(left, right)
    const vrHeading = (left.rotation + right.rotation) / 2
    assert.ok(Math.abs(Math.sin(vrHeading) - Math.sin(desktopHeading)) < 1e-6)
    assert.ok(Math.abs(Math.cos(vrHeading) - Math.cos(desktopHeading)) < 1e-6)
  }
  left.dispose(); right.dispose(); scene.dispose(); engine.dispose()
})
