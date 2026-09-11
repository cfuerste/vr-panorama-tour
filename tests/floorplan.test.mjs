import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { Control, Rectangle } from '@babylonjs/gui/index.js'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js'
import { Tools } from '@babylonjs/core/Misc/tools.js'
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js'
import { Measure } from '@babylonjs/gui/2D/measure.js'

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
const klass = ast.statements.find(ts.isClassDeclaration)
const names = ['positionViewDirectionIndicator', 'updateViewAngle', 'adjustCoordinatesForAspectRatio']
const methods = klass.members.filter(m => names.includes(m.name?.getText(ast))).map(m => m.getText(ast)).join('\n')
const code = ts.transpile(`class MapLayout { ${methods} }`, { target: ts.ScriptTarget.ES2022 })
const Layout = new Function('Control', 'UniversalCamera', 'Tools', `${code}; return MapLayout`)(Control, UniversalCamera, Tools)

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

test('turning the VR panel upright preserves the world direction of both rays', () => {
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
      assert.ok(Vector3.Distance(oldDirection, newDirection) < 1e-8)
      assert.equal(ray.transformCenterY, 1)
    }
  }
  left.dispose(); right.dispose()
})
