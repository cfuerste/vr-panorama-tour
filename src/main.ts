// Import core modules
import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { PhotoDome } from '@babylonjs/core/Helpers/photoDome'
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience'
import '@babylonjs/core/XR/features/WebXRHandTracking' // Hand-Tracking-Feature laden
// Import BackgroundMaterial and its dependencies
import { Effect } from '@babylonjs/core/Materials/effect'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'

// Configure shader store for local development
Effect.ShadersStore = ShaderStore.ShadersStore

import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture'
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle'
import { Ellipse } from '@babylonjs/gui/2D/controls/ellipse'
import { Image } from '@babylonjs/gui/2D/controls/image'
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock'

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement

// Add debugging
console.log('🎬 VR Tour Starting...')
console.log('Canvas found:', !!canvas)

if (!canvas) {
  console.error('❌ Canvas element not found!')
  document.body.innerHTML = '<div style="color: white; font-size: 24px; text-align: center; padding: 50px;">❌ Canvas element not found! Check console for details.</div>'
  throw new Error('Canvas element not found')
}

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  disableWebGL2Support: false,
  powerPreference: "high-performance", // Use discrete GPU if available
  antialias: false, // Disable for Quest 3 performance
  adaptToDeviceRatio: false, // Control scaling manually
  doNotHandleContextLost: true
})

console.log('🚀 Babylon.js Engine initialized')

const scene = new Scene(engine)

console.log('🎭 Scene created')

// Optimize scene for Quest 3 performance
scene.skipPointerMovePicking = true
scene.autoClear = false // Manual clearing for performance
scene.autoClearDepthAndStencil = false

// Set target framerate for Quest 3
engine.setHardwareScalingLevel(1.0) // Full resolution

// Configure scene for better shader loading
scene.preventDefaultOnPointerDown = false
scene.preventDefaultOnPointerUp = false

// Enable more detailed error logging
engine.enableOfflineSupport = false
scene.getEngine().disableManifestCheck = true

// --- Kamera (am Ursprung, im Inneren der Kuppel) ---
const camera = new UniversalCamera('cam', new Vector3(0, 0, 0), scene)
camera.minZ = 0.1
// Eingangsrotation der Kamera
camera.rotation.y = Math.PI
camera.attachControl(canvas, true)

// --- Tour-Knoten (Beispiel) ---
type NodeLink = { to: string; yaw: number; pitch: number; label?: string }
type Node = { name: string; image: string; links: NodeLink[]; map: { x: number; y: number }; floor: string } 

/* 
 * MAP POSITIONING GUIDE:
 * - x,y coordinates are percentages (0-100)
 * - x: 0 = left edge, 50 = center, 100 = right edge
 * - y: 0 = top edge, 50 = center, 100 = bottom edge
 * 
 * Examples:
 * { x: 0, y: 0 }     = top-left corner
 * { x: 50, y: 50 }   = center of map
 * { x: 100, y: 100 } = bottom-right corner
 * { x: 25, y: 75 }   = left side, lower area
 */

// NODES will be loaded from JSON file
let NODES: Record<string, Node> = {}

// Function to load and process node data from JSON
async function loadNodesFromJSON(): Promise<Record<string, Node>> {
  try {
    const response = await fetch('./json/Panoramane_Standorte.json')
    if (!response.ok) {
      throw new Error(`Failed to load JSON: ${response.status} ${response.statusText}`)
    }
    
    const rawData = await response.json()
    const processedNodes: Record<string, Node> = {}
    
    // Process each node to convert coordinate format and add image path prefix
    Object.entries(rawData).forEach(([nodeId, rawNode]: [string, any]) => {
      processedNodes[nodeId] = {
        name: rawNode.name,
        image: `./panos/${rawNode.image}`, // Add ./panos/ prefix for relative paths
        links: rawNode.links, // Links are already in the correct format
        map: {
          x: rawNode.map.x * 100, // Convert from 0-1 to 0-100 percentage
          y: rawNode.map.y * 100  // Convert from 0-1 to 0-100 percentage
        },
        floor: rawNode.floor
      }
    })
    
    console.log(`Loaded ${Object.keys(processedNodes).length} nodes from JSON`)
    return processedNodes
  } catch (error) {
    console.error('Failed to load nodes from JSON:', error)
    // Return empty object, will cause fallback to be used
    return {}
  }
}

const SPHERE_RADIUS = 16
const HOTSPOT_SIZE = 1
const MAP_TEX_SIZE = 512

// Fallback-Bild (existiert laut Ordner-Inhalt) – wird genutzt falls ein Panorama fehlt
const FALLBACK_IMAGE = './panos/pano_a.jpg'

// Start auf ein vorhandenes Bild ändern (vorher Panorama_Werkstatt_001 -> Datei fehlt)
let currentId = 'Panorama_Außenanlagen_001'
let domes: Record<string, PhotoDome> = {}
let hotspotMeshes: Record<string, Mesh[]> = {}
let mapADT: AdvancedDynamicTexture
let mapPlane: Mesh
let overlayADT: AdvancedDynamicTexture | null = null
let overlayMapContainer: Rectangle | null = null
let currentFloorImage: Image | null = null
let floorRibbons: Rectangle[] = []
let loadingScreenADT: AdvancedDynamicTexture | null = null
let loadingContainer: Rectangle | null = null
let loadingProgressBar: Rectangle | null = null
let loadingText: TextBlock | null = null
let isInitialized = false
let isTransitioning = false
let xrExperience: any = null
let leftController: any = null

// Transition settings
const TRANSITION_DURATION = 1000 // milliseconds

// Memory management settings
const MAX_LOADED_TEXTURES = 8 // Limit concurrent loaded textures
const PRELOAD_RADIUS = 2 // Only preload immediate neighbors
const MAX_MEMORY_MB = 200 // Conservative memory limit for Quest 3

// Texture Memory Manager Class
class TextureMemoryManager {
  private loadedTextures = new Map<string, PhotoDome>()
  private currentMemoryUsage = 0
  private loadingPromises = new Map<string, Promise<PhotoDome>>()
  
  async loadTexture(nodeId: string, highQuality = false): Promise<PhotoDome> {
    // Return existing texture if already loaded
    if (this.loadedTextures.has(nodeId)) {
      return this.loadedTextures.get(nodeId)!
    }
    
    // Return existing loading promise if already in progress
    if (this.loadingPromises.has(nodeId)) {
      return this.loadingPromises.get(nodeId)!
    }
    
    // Check memory before loading
    if (this.loadedTextures.size >= MAX_LOADED_TEXTURES) {
      await this.freeOldestTextures(2)
    }
    
    const loadingPromise = this.createTexture(nodeId, highQuality)
    this.loadingPromises.set(nodeId, loadingPromise)
    
    try {
      const texture = await loadingPromise
      this.loadedTextures.set(nodeId, texture)
      this.currentMemoryUsage += this.estimateTextureSize()
      console.log(`📸 Loaded texture ${nodeId}, memory usage: ${this.currentMemoryUsage}MB`)
      return texture
    } finally {
      this.loadingPromises.delete(nodeId)
    }
  }
  
  private async createTexture(nodeId: string, highQuality: boolean): Promise<PhotoDome> {
    const node = NODES[nodeId]
    if (!node) {
      throw new Error(`Node ${nodeId} not found`)
    }
    
    return new Promise((resolve, reject) => {
      try {
        const dome = new PhotoDome(nodeId, node.image, {
          resolution: highQuality ? 128 : 64, // Lower resolution for background loading
          size: SPHERE_RADIUS,
          useDirectMapping: false // Better performance on mobile
        }, scene)
        
        dome.setEnabled(false) // Start disabled
        
        // Wait for texture to load
        const checkLoaded = () => {
          if (dome.photoTexture && dome.photoTexture.isReady()) {
            resolve(dome)
          } else {
            setTimeout(checkLoaded, 50)
          }
        }
        checkLoaded()
        
      } catch (error) {
        console.error(`Failed to create texture for ${nodeId}:`, error)
        reject(error)
      }
    })
  }
  
  async freeOldestTextures(count: number): Promise<void> {
    const texturesToFree = Array.from(this.loadedTextures.keys())
      .filter(id => id !== currentId) // Never free current texture
      .slice(0, count)
    
    for (const nodeId of texturesToFree) {
      this.disposeTexture(nodeId)
    }
  }
  
  disposeTexture(nodeId: string): void {
    const texture = this.loadedTextures.get(nodeId)
    if (texture) {
      console.log(`🗑️ Disposing texture ${nodeId}`)
      texture.dispose()
      this.loadedTextures.delete(nodeId)
      this.currentMemoryUsage -= this.estimateTextureSize()
      
      // Also remove from global domes object
      if (domes[nodeId]) {
        delete domes[nodeId]
      }
    }
  }
  
  private estimateTextureSize(): number {
    return 25 // MB per texture (rough estimate for 4K)
  }
  
  getMemoryUsage(): number {
    return this.currentMemoryUsage
  }
  
  getLoadedCount(): number {
    return this.loadedTextures.size
  }
  
  isLoaded(nodeId: string): boolean {
    return this.loadedTextures.has(nodeId)
  }
}

// Global texture manager instance
const textureManager = new TextureMemoryManager()

// Performance monitoring class
class PerformanceMonitor {
  private frameCount = 0
  private lastTime = performance.now()
  private fps = 0
  private memoryCheckInterval: number | null = null
  
  start() {
    // Monitor FPS
    const updateFPS = () => {
      this.frameCount++
      const now = performance.now()
      
      if (now - this.lastTime >= 1000) {
        this.fps = Math.round((this.frameCount * 1000) / (now - this.lastTime))
        this.frameCount = 0
        this.lastTime = now
        
        // Log performance stats periodically
        if (this.frameCount % 30 === 0) { // Every 30 seconds roughly
          this.logPerformanceStats()
        }
      }
      
      requestAnimationFrame(updateFPS)
    }
    updateFPS()
    
    // Monitor memory usage
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryPressure()
    }, 5000) // Check every 5 seconds
  }
  
  stop() {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval)
      this.memoryCheckInterval = null
    }
  }
  
  getFPS(): number {
    return this.fps
  }
  
  private logPerformanceStats() {
    const memoryUsage = textureManager.getMemoryUsage()
    const loadedTextures = textureManager.getLoadedCount()
    
    console.log(`📊 Performance Stats: ${this.fps} FPS | Memory: ${memoryUsage}MB | Textures: ${loadedTextures}`)
    
    // Warn if performance is poor
    if (this.fps < 45) {
      console.warn(`⚠️ Low FPS detected: ${this.fps}. Consider reducing texture quality.`)
    }
    
    if (memoryUsage > 150) {
      console.warn(`⚠️ High memory usage: ${memoryUsage}MB. Consider unloading textures.`)
    }
  }
  
  private checkMemoryPressure() {
    const memoryUsage = textureManager.getMemoryUsage()
    
    if (memoryUsage > MAX_MEMORY_MB * 0.8) {
      console.warn(`🔥 Memory pressure detected: ${memoryUsage}MB. Triggering cleanup.`)
      // Trigger aggressive cleanup
      textureManager.freeOldestTextures(3).catch(console.error)
    }
  }
}

// Adaptive loading screen manager
class LoadingScreenManager {
  private loadingTimeout: number | null = null
  private isVisible = false
  
  showLoadingWithDelay(delayMs = 300) {
    if (this.isVisible) return
    
    this.loadingTimeout = setTimeout(() => {
      this.showImmediate()
    }, delayMs)
  }
  
  hideLoadingImmediate() {
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout)
      this.loadingTimeout = null
    }
    
    if (this.isVisible) {
      hideLoadingScreen().then(() => {
        this.isVisible = false
      }).catch(console.error)
    }
  }
  
  private showImmediate() {
    if (!this.isVisible) {
      createLoadingScreen()
      this.isVisible = true
    }
  }
}

// Global instances
const performanceMonitor = new PerformanceMonitor()
const loadingScreenManager = new LoadingScreenManager()


// Grad -> Radiant
const deg = (d: number) => d * Math.PI / 180

const DEBUG_INVERT_YAW = false

// DEBUG MODE: Set to true for instant layout preview (no loading screen)
const LAYOUT_MODE = false  // Change to false for production

// Function to add compass overlay texture to a PhotoDome
/*
function addCompassOverlayToDome(dome: PhotoDome, nodeId: string) {
  // Access the underlying mesh material
  const originalMaterial = dome.mesh.material as StandardMaterial
  
  if (!originalMaterial) {
    console.warn(`No material found for dome ${nodeId}`)
    return
  }
  
  // Create a new StandardMaterial with multi-texturing
  const dualTextureMaterial = new StandardMaterial(`dualTexMat_${nodeId}`, scene)
  
  // Copy the original diffuse texture (main panorama)
  dualTextureMaterial.diffuseTexture = originalMaterial.diffuseTexture
  
  // Load compass texture
  const compassTexture = new Texture('/panos/Windrose.png', scene)
  compassTexture.hasAlpha = true
  
  // Fix orientation - flip V coordinate for proper bottom positioning
  compassTexture.vOffset = 1  // Shift texture to correct position
  compassTexture.uOffset = 0.25 // Center horizontally
  compassTexture.vScale = -1    // Flip vertically to correct orientation

  // Use as opacity texture with low intensity for subtle overlay
  dualTextureMaterial.opacityTexture = compassTexture
  dualTextureMaterial.opacityTexture.hasAlpha = true
  dualTextureMaterial.emissiveColor = new Color3(1, 1, 1) // Very subtle
  
  // Enable proper alpha blending
  dualTextureMaterial.useAlphaFromDiffuseTexture = true
  
  // Keep the original properties
  dualTextureMaterial.alpha = originalMaterial.alpha || 1
  dualTextureMaterial.backFaceCulling = originalMaterial.backFaceCulling
  
  // Apply the new material to the dome mesh
  dome.mesh.material = dualTextureMaterial
  
  console.log(`Added compass overlay to dome ${nodeId}`)
}
*/

// Floor plan definitions
const FLOORS = [
  { id: 'UG', name: 'UG', image: './ui/floorplan_UG.png' },
  { id: 'EG', name: 'EG', image: './ui/floorplan_EG.png' },
  { id: 'OG', name: 'OG', image: './ui/floorplan_OG.png' },
  { id: 'DA', name: 'DA', image: './ui/floorplan_DA.png' }
]

let currentFloor = 'EG' // Default floor

// Loading screen functions
function createLoadingScreen() {
  if (!loadingScreenADT) {
    loadingScreenADT = AdvancedDynamicTexture.CreateFullscreenUI("loadingScreenUI")
  }
  
  // Create main container
  loadingContainer = new Rectangle("loadingContainer")
  loadingContainer.width = "100%"
  loadingContainer.height = "100%"
  loadingContainer.background = "rgba(0, 0, 0, 0.9)"
  loadingScreenADT.addControl(loadingContainer)
  
  // Create title text
  const titleText = new TextBlock("titleText")
  titleText.text = "VR Panorama Tour"
  titleText.color = "white"
  titleText.fontSize = 48
  titleText.fontWeight = "bold"
  titleText.verticalAlignment = 0 // Center
  titleText.top = "-100px"
  loadingContainer.addControl(titleText)
  
  // Create loading text
  loadingText = new TextBlock("loadingText")
  loadingText.text = "Loading panoramas..."
  loadingText.color = "white"
  loadingText.fontSize = 24
  loadingText.verticalAlignment = 0 // Center
  loadingText.top = "-20px"
  loadingContainer.addControl(loadingText)
  
  // Create progress bar background
  const progressBg = new Rectangle("progressBg")
  progressBg.width = "400px"
  progressBg.height = "20px"
  progressBg.color = "white"
  progressBg.thickness = 2
  progressBg.background = "rgba(255, 255, 255, 0.1)"
  progressBg.verticalAlignment = 0 // Center
  progressBg.top = "40px"
  loadingContainer.addControl(progressBg)
  
  // Create progress bar fill
  loadingProgressBar = new Rectangle("progressBar")
  loadingProgressBar.width = "0px"
  loadingProgressBar.height = "16px"
  loadingProgressBar.background = "rgba(0, 150, 255, 0.8)"
  loadingProgressBar.horizontalAlignment = 0 // Left
  loadingProgressBar.left = "2px"
  progressBg.addControl(loadingProgressBar)
  
  console.log('Loading screen created')
}

function updateLoadingProgress(loaded: number, total: number) {
  if (!loadingProgressBar || !loadingText) return
  
  const percentage = Math.round((loaded / total) * 100)
  const progressWidth = Math.max(0, (loaded / total) * 396) // 400px - 4px padding
  
  loadingProgressBar.width = `${progressWidth}px`
  
  if (loadingText) {
    loadingText.text = `Loading panoramas... ${percentage}% (${loaded}/${total})`
  }
  
  console.log(`Loading progress: ${loaded}/${total} (${percentage}%)`)
}

async function hideLoadingScreen() {
  if (!loadingContainer) return
  
  console.log('Hiding loading screen with fade animation')
  
  return new Promise<void>((resolve) => {
    const startTime = Date.now()
    const fadeOutDuration = 1000 // 1 second fade out
    
    const fadeAnimation = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / fadeOutDuration, 1)
      
      // Ease out curve for smooth fade
      const easeProgress = 1 - Math.pow(1 - progress, 3)
      const alpha = 1 - easeProgress
      
      if (loadingContainer) {
        loadingContainer.alpha = alpha
      }
      
      if (progress < 1) {
        requestAnimationFrame(fadeAnimation)
      } else {
        // Remove loading screen completely
        if (loadingScreenADT && loadingContainer) {
          loadingScreenADT.removeControl(loadingContainer)
          loadingContainer.dispose()
          loadingContainer = null
          loadingProgressBar = null
          loadingText = null
        }
        console.log('Loading screen hidden')
        resolve()
      }
    }
    
    fadeAnimation()
  })
}

// Position an Innenwand der Kuppel
function sphericalToCartesian(yawDeg: number, pitchDeg: number, r = SPHERE_RADIUS) {
  // Your data seems to use yaw like compass degrees (0 = forward). Adjust if needed.
  let yaw = deg(yawDeg)
  if (DEBUG_INVERT_YAW) yaw = -yaw
  const pitch = deg(pitchDeg)
  const x = r * Math.sin(yaw) * Math.cos(pitch)
  const y = r * Math.sin(pitch)
  const z = r * Math.cos(yaw) * Math.cos(pitch)
  return new Vector3(x, y, z)
}

// Dynamic node loading with memory management
async function initializeAllNodes() {
  console.log('Loading nodes from JSON...')
  
  // Load nodes from JSON file
  NODES = await loadNodesFromJSON()
  
  if (Object.keys(NODES).length === 0) {
    console.error('Failed to load nodes from JSON, cannot initialize tour')
    return
  }
  
  console.log(`📍 Loaded ${Object.keys(NODES).length} nodes from JSON`)
  
  // Only load the initial node and its immediate neighbors
  await loadNodeOnDemand(currentId, true) // High quality for current node
  await preloadAdjacentNodes(currentId)
  
  isInitialized = true
  console.log('🎯 Dynamic loading system initialized')
}

// Load a specific node on demand with texture manager
async function loadNodeOnDemand(nodeId: string, highQuality = false): Promise<void> {
  if (!NODES[nodeId]) {
    console.warn(`Node ${nodeId} not found in NODES`)
    return
  }
  
  if (textureManager.isLoaded(nodeId)) {
    console.log(`📸 Node ${nodeId} already loaded`)
    return
  }
  
  try {
    console.log(`⏳ Loading node ${nodeId} (${highQuality ? 'high' : 'standard'} quality)`)
    
    const dome = await textureManager.loadTexture(nodeId, highQuality)
    domes[nodeId] = dome
    
    // Store camera's initial rotation for consistent coordinate system
    const initialCameraRotation = camera.rotation.clone()
    dome.mesh.renderingGroupId = 0
    dome.mesh.rotation = initialCameraRotation.clone()
    
    // Create hotspots for this node
    await createHotspotsForNode(nodeId)
    
    console.log(`✅ Successfully loaded node ${nodeId}`)
    
  } catch (error) {
    console.error(`❌ Failed to load node ${nodeId}:`, error)
    // Create fallback dome
    await createFallbackDome(nodeId)
  }
}

// Create hotspots for a specific node
async function createHotspotsForNode(nodeId: string): Promise<void> {
  const node = NODES[nodeId]
  if (!node) return
  
  hotspotMeshes[nodeId] = []
  
  node.links.forEach(link => {
    const pos = sphericalToCartesian(-link.yaw, link.pitch, SPHERE_RADIUS - 0.05)
    const plane = MeshBuilder.CreatePlane(`hs_${nodeId}_${link.to}`, { size: HOTSPOT_SIZE }, scene)
    plane.position = pos
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL
    plane.isPickable = true
    plane.renderingGroupId = 2
    plane.setEnabled(false) // Hide initially
    
    // Add GUI to hotspot
    const adt = AdvancedDynamicTexture.CreateForMesh(plane, 256, 256)
    const rect = new Rectangle(); rect.thickness = 0; adt.addControl(rect)
    const circle = new Ellipse()
    circle.width = '80%'; circle.height = '80%'
    circle.background = 'rgba(255, 255, 255, 0.5)'
    rect.addControl(circle)
    
    rect.onPointerUpObservable.add(() => switchNode(link.to))
    
    const mat: any = plane.material
    if (mat) {
      mat.disableDepthWrite = true
      mat.backFaceCulling = false
    }
    
    hotspotMeshes[nodeId].push(plane)
  })
}

// Create fallback dome for failed loads
async function createFallbackDome(nodeId: string): Promise<void> {
  console.warn(`🔄 Creating fallback dome for ${nodeId}`)
  const initialCameraRotation = camera.rotation.clone()
  
  const dome = new PhotoDome(`dome_${nodeId}`, FALLBACK_IMAGE, { 
    size: SPHERE_RADIUS * 2,
    resolution: 64 // Lower resolution for fallback
  }, scene)
  
  dome.mesh.renderingGroupId = 0
  dome.mesh.rotation = initialCameraRotation.clone()
  dome.setEnabled(false)
  domes[nodeId] = dome
  
  hotspotMeshes[nodeId] = []
}

// Preload adjacent nodes based on links
async function preloadAdjacentNodes(nodeId: string): Promise<void> {
  const node = NODES[nodeId]
  if (!node) return
  
  console.log(`🔄 Preloading adjacent nodes for ${nodeId}`)
  
  const adjacentPromises = node.links.map(async (link) => {
    if (!textureManager.isLoaded(link.to)) {
      await loadNodeOnDemand(link.to, false) // Standard quality for adjacent nodes
    }
  })
  
  await Promise.all(adjacentPromises)
  console.log(`✅ Preloaded ${node.links.length} adjacent nodes for ${nodeId}`)
}

// Unload distant nodes to free memory
async function unloadDistantNodes(keepNodeId: string): Promise<void> {
  const keepNode = NODES[keepNodeId]
  if (!keepNode) return
  
  // Get list of nodes that should be kept (current + adjacent)
  const keepNodes = new Set([keepNodeId])
  keepNode.links.forEach(link => keepNodes.add(link.to))
  
  // Dispose nodes not in keep list
  const disposalPromises = Object.keys(domes).map(async (nodeId) => {
    if (!keepNodes.has(nodeId)) {
      console.log(`🗑️ Unloading distant node: ${nodeId}`)
      
      // Dispose hotspots
      if (hotspotMeshes[nodeId]) {
        hotspotMeshes[nodeId].forEach(mesh => mesh.dispose())
        delete hotspotMeshes[nodeId]
      }
      
      // Dispose texture through manager
      textureManager.disposeTexture(nodeId)
    }
  })
  
  await Promise.all(disposalPromises)
}

// Switch to a specific node with smooth crossfade and zoom transition
async function switchToNode(nodeId: string) {
  if (!isInitialized) {
    console.warn('Nodes not yet initialized')
    return
  }
  
  if (nodeId === currentId) {
    return // Already at this node
  }
  
  if (isTransitioning) {
    return // Prevent multiple transitions
  }
  
  isTransitioning = true
  
  try {
    // Load target node if not already loaded
    if (!textureManager.isLoaded(nodeId)) {
      console.log(`⏳ Loading target node ${nodeId} for transition`)
      loadingScreenManager.showLoadingWithDelay(200) // Show loading after 200ms if still loading
      await loadNodeOnDemand(nodeId, true) // High quality for target
      loadingScreenManager.hideLoadingImmediate()
    }
    
    // Get the link info for camera rotation if available
    const currentNode = NODES[currentId]
    const linkToTarget = currentNode?.links.find(link => link.to === nodeId)
    
    const oldNodeId = currentId
    currentId = nodeId
    
    // Enable the new node but make it transparent initially
    if (domes[currentId]) {
      domes[currentId].setEnabled(true)
      const newMaterial = domes[currentId].mesh.material as any
      if (newMaterial) {
        newMaterial.alpha = 0
      }
    }
    
    // Hide old hotspots and show new ones
    if (hotspotMeshes[oldNodeId]) {
      hotspotMeshes[oldNodeId].forEach(mesh => mesh.setEnabled(false))
    }
    if (hotspotMeshes[currentId]) {
      hotspotMeshes[currentId].forEach(mesh => mesh.setEnabled(true))
    }
    
    // Perform crossfade with zoom effect
    await Promise.all([
      crossfadeDomes(oldNodeId, currentId),
      linkToTarget ? rotateCameraToTarget(linkToTarget.yaw, linkToTarget.pitch) : Promise.resolve()
    ])
    
    // Hide the old node completely
    if (domes[oldNodeId]) {
      domes[oldNodeId].setEnabled(false)
    }
    
    // Preload adjacent nodes for the new current node
    preloadAdjacentNodes(currentId).catch(error => {
      console.warn('Failed to preload adjacent nodes:', error)
    })
    
    // Unload distant nodes to free memory
    unloadDistantNodes(currentId).catch(error => {
      console.warn('Failed to unload distant nodes:', error)
    })
    
    updateMapSelection()
    console.log(`✅ Switched to node: ${currentId} (Memory: ${textureManager.getMemoryUsage()}MB, Loaded: ${textureManager.getLoadedCount()})`)
  } finally {
    isTransitioning = false
    rebuildMapNodes()
  }
}

// Crossfade between two domes with subtle zoom effect
function crossfadeDomes(fromNodeId: string, toNodeId: string): Promise<void> {
  return new Promise((resolve) => {
    const fromDome = domes[fromNodeId]
    const toDome = domes[toNodeId]
    
    if (!fromDome || !toDome) {
      resolve()
      return
    }
    
    // Access the mesh materials directly
    const fromMaterial = fromDome.mesh.material as any
    const toMaterial = toDome.mesh.material as any
    
    if (!fromMaterial || !toMaterial) {
      resolve()
      return
    }
    
    // Store initial values
    const startTime = Date.now()
    const initialFromAlpha = fromMaterial.alpha || 1
    const initialScale = fromDome.mesh.scaling.clone()
    const targetScale = initialScale.clone().scaleInPlace(1.05) // Subtle zoom out
    
    // Set initial state for new dome
    toMaterial.alpha = 0
    
    const crossfadeAnimation = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / TRANSITION_DURATION, 1)
      
      // Use ease-in-out curve for smooth transition
      const easeProgress = progress < 0.5 
        ? 2 * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 2) / 2
      
      // Crossfade the alpha values
      fromMaterial.alpha = initialFromAlpha * (1 - easeProgress)
      toMaterial.alpha = easeProgress
      
      // Subtle zoom effect on the outgoing dome
      const currentScale = Vector3.Lerp(initialScale, targetScale, easeProgress * 0.5) // Subtle effect
      fromDome.mesh.scaling = currentScale
      
      // Zoom in effect on the incoming dome (starts zoomed out slightly)
      const incomingScale = Vector3.Lerp(
        initialScale.clone().scaleInPlace(1.02), // Start slightly zoomed in
        initialScale, // End at normal scale
        easeProgress
      )
      toDome.mesh.scaling = incomingScale
      
      if (progress < 1) {
        requestAnimationFrame(crossfadeAnimation)
      } else {
        // Ensure final state
        fromMaterial.alpha = 0
        toMaterial.alpha = 1
        fromDome.mesh.scaling = initialScale
        toDome.mesh.scaling = initialScale
        resolve()
      }
    }
    
    crossfadeAnimation()
  })
}

// Smoothly rotate camera towards target direction
function rotateCameraToTarget(yaw: number, pitch: number): Promise<void> {
  return new Promise((resolve) => {
    // Convert yaw/pitch to camera rotation
    const targetYaw = deg(-yaw) // Invert for camera
    const targetPitch = deg(-pitch) // Invert for camera
    
    const startRotationY = camera.rotation.y
    const startRotationX = camera.rotation.x
    
    // Calculate shortest path for yaw rotation
    let deltaY = targetYaw - startRotationY
    if (deltaY > Math.PI) deltaY -= 2 * Math.PI
    if (deltaY < -Math.PI) deltaY += 2 * Math.PI
    
    const targetRotationY = startRotationY + deltaY
    const targetRotationX = startRotationX + (targetPitch - startRotationX) * 0.3 // Subtle pitch adjustment
    
    const startTime = Date.now()
    const rotationDuration = TRANSITION_DURATION * 0.7 // Slightly shorter than full transition
    
    const rotateAnimation = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / rotationDuration, 1)
      
      // Use ease-in-out curve for smooth animation
      const easeProgress = progress < 0.5 
        ? 2 * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 2) / 2
      
      camera.rotation.y = startRotationY + (targetRotationY - startRotationY) * easeProgress
      camera.rotation.x = startRotationX + (targetRotationX - startRotationX) * easeProgress
      
      if (progress < 1) {
        requestAnimationFrame(rotateAnimation)
      } else {
        resolve()
      }
    }
    
    rotateAnimation()
  })
}

function buildMap() {
  if (leftController) {
    // Build 3D map for VR controller
    buildControllerMap()
  } else {
    // Build 2D overlay map for desktop/no controller
    buildOverlayMap()
  }
  
  // Update position after creation
  updateMapPosition()
}

function buildControllerMap() {
  // Create map plane for VR controller attachment
  const mapSize = 0.3
  const mapHeight = 0.225
  
  mapPlane = MeshBuilder.CreatePlane('map', { width: mapSize, height: mapHeight }, scene)
  mapPlane.billboardMode = Mesh.BILLBOARDMODE_NONE

  mapADT = AdvancedDynamicTexture.CreateForMesh(mapPlane, MAP_TEX_SIZE, Math.floor(MAP_TEX_SIZE * 0.75), true)
  
  // Use current floor image
  const currentFloorData = FLOORS.find(f => f.id === currentFloor)
  const floorImagePath = currentFloorData ? currentFloorData.image : './ui/floorplan_EG.png'
  const img = new Image('floor', floorImagePath); img.stretch = Image.STRETCH_UNIFORM
  // Ensure the floor image stays in the background
  img.zIndex = -1
  mapADT.addControl(img)

  Object.entries(NODES).forEach(([id, n]) => {
    const m = new Ellipse()
    m.width = '16px'; m.height = '16px'; m.thickness = 3; m.color = (id === currentId) ? 'blue' : 'white'
    m.background = 'rgba(0,0,0,0.35)'
    
    // Convert percentage position to pixel position for controller map
    // Map texture is MAP_TEX_SIZE wide and MAP_TEX_SIZE * 0.75 tall
    const mapWidth = MAP_TEX_SIZE
    const mapHeight = MAP_TEX_SIZE * 0.75
    const pixelX = (n.map.x / 100) * mapWidth
    const pixelY = (n.map.y / 100) * mapHeight
    
    m.left = (pixelX - mapWidth / 2) + 'px'
    m.top = (pixelY - mapHeight / 2) + 'px'
    
    // Ensure nodes appear above the floor image
    m.zIndex = 10
    
    m.onPointerUpObservable.add(() => switchToNode(id))
    mapADT.addControl(m)
  })
}

function buildOverlay() {
  if (!overlayADT) {
    overlayADT = AdvancedDynamicTexture.CreateFullscreenUI("overlayUI")
    addLogoToOverlay(overlayADT);
  }
  return overlayADT;
}

function addLogoToOverlay(adt: AdvancedDynamicTexture) {
  const logo = new Image('logo', './ipro-logo.svg')
  logo.width = '180px'
  logo.height = '50px'
  logo.horizontalAlignment = 1 // Right
  logo.verticalAlignment = 1 // Bottom
  logo.left = '-20px'
  logo.top = '-20px'
  // add as clickthrough to avoid blocking map interaction
  logo.isPointerBlocker = false
  adt.addControl(logo)
}

function buildOverlayMap() {
  // Create fullscreen overlay if it doesn't exist
  overlayADT = buildOverlay()

  // Create map container (made taller to accommodate ribbons)
  overlayMapContainer = new Rectangle("mapContainer")
  overlayMapContainer.width = "280px"
  overlayMapContainer.height = "250px" // Increased height for ribbons
  overlayMapContainer.cornerRadius = 10
  overlayMapContainer.color = "white"
  overlayMapContainer.background = "rgba(0, 0, 0, 0.8)"
  overlayMapContainer.horizontalAlignment = 0 // Left
  overlayMapContainer.verticalAlignment = 0 // Top
  overlayMapContainer.left = "20px"
  overlayMapContainer.top = "20px"
  overlayADT.addControl(overlayMapContainer)
  
  // Create floor selection ribbons
  createFloorRibbons()
  
  // Add current floor image
  updateFloorImage()
  
  // Add node markers
  Object.entries(NODES).forEach(([id, n]) => {
    const m = new Ellipse()
    m.width = "12px"
    m.height = "12px"
    m.thickness = 2
    m.color = (id === currentId) ? 'cyan' : 'white'
    m.background = (id === currentId) ? 'rgba(0, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.5)'
    
    // Convert percentage position to overlay container coordinates
    // Map area is 280x190 pixels (reduced height for ribbons)
    const containerWidth = 280
    const containerHeight = 190
    const pixelX = (n.map.x / 100) * containerWidth
    const pixelY = (n.map.y / 100) * containerHeight
    
    m.left = (pixelX - containerWidth / 2) + "px" // Center around container
    m.top = (pixelY - containerHeight / 2 + 25) + "px" // Offset down for ribbons
    
    // Ensure nodes appear above the floor image
    m.zIndex = 10
    
    m.onPointerUpObservable.add(() => switchToNode(id))
    if (overlayMapContainer) {
      overlayMapContainer.addControl(m)
    }
  })
  
  // Add layout mode indicator if in layout mode
  if (LAYOUT_MODE && overlayMapContainer) {
    const layoutIndicator = new TextBlock("layoutIndicator")
    layoutIndicator.text = "🎨 LAYOUT MODE"
    layoutIndicator.color = "yellow"
    layoutIndicator.fontSize = 14
    layoutIndicator.fontWeight = "bold"
    layoutIndicator.verticalAlignment = 1 // Bottom
    layoutIndicator.top = "-5px"
    overlayMapContainer.addControl(layoutIndicator)
  }
}

function createFloorRibbons() {
  if (!overlayMapContainer) return
  
  // Clear existing ribbons
  floorRibbons.forEach(ribbon => {
    if (overlayMapContainer) {
      overlayMapContainer.removeControl(ribbon)
    }
    ribbon.dispose()
  })
  floorRibbons = []
  
  // Create ribbon container
  const ribbonContainer = new Rectangle("ribbonContainer")
  ribbonContainer.width = "280px"
  ribbonContainer.height = "30px"
  ribbonContainer.verticalAlignment = 0 // Top
  ribbonContainer.thickness = 0
  overlayMapContainer.addControl(ribbonContainer)
  
  // Create individual floor ribbons
  FLOORS.forEach((floor, index) => {
    const ribbon = new Rectangle(`ribbon_${floor.id}`)
    ribbon.width = "70px" // 280px / 4 floors = 70px each
    ribbon.height = "30px"
    ribbon.left = (index * 70 - 105) + "px" // Center the 4 ribbons
    ribbon.cornerRadiusW = 5
    ribbon.cornerRadiusZ = 5
    ribbon.thickness = 1
    
    // Style based on whether this is the active floor
    if (floor.id === currentFloor) {
      ribbon.background = "rgba(0, 150, 255, 0.9)" // Active blue
      ribbon.color = "white"
    } else {
      ribbon.background = "rgba(255, 255, 255, 0.2)" // Inactive transparent
      ribbon.color = "rgba(255, 255, 255, 0.7)"
    }
    
    // Add floor label
    const label = new TextBlock(`label_${floor.id}`)
    label.text = floor.name
    label.color = floor.id === currentFloor ? "white" : "rgba(255, 255, 255, 0.8)"
    label.fontSize = 14
    label.fontWeight = "bold"
    ribbon.addControl(label)
    
    // Add click handler
    ribbon.onPointerUpObservable.add(() => {
      switchFloor(floor.id)
    })
    
    // Add hover effects (only for inactive ribbons)
    if (floor.id !== currentFloor) {
      ribbon.onPointerEnterObservable.add(() => {
        ribbon.background = "rgba(255, 255, 255, 0.4)" // Brighter on hover
      })
      ribbon.onPointerOutObservable.add(() => {
        ribbon.background = "rgba(255, 255, 255, 0.2)" // Back to normal
      })
    }
    
    ribbonContainer.addControl(ribbon)
    floorRibbons.push(ribbon)
  })
}

function updateFloorImage() {
  if (!overlayMapContainer) return
  
  // Remove existing floor image
  if (currentFloorImage) {
    overlayMapContainer.removeControl(currentFloorImage)
    currentFloorImage.dispose()
  }
  
  // Find current floor data
  const currentFloorData = FLOORS.find(f => f.id === currentFloor)
  if (!currentFloorData) return
  
  // Create new floor image
  currentFloorImage = new Image('overlayFloor', currentFloorData.image)
  currentFloorImage.stretch = Image.STRETCH_UNIFORM
  currentFloorImage.width = "280px"
  currentFloorImage.height = "190px" // Reduced height to make room for ribbons
  currentFloorImage.top = "15px" // Offset down to make room for ribbons
  // Ensure the floor image stays in the background by setting zIndex
  currentFloorImage.zIndex = -1
  overlayMapContainer.addControl(currentFloorImage)
}

function rebuildMapNodes() {
  if (!overlayMapContainer) return
  
  // Remove existing node markers (find all ellipses that are node markers)
  const controlsToRemove: any[] = []
  overlayMapContainer.children.forEach(child => {
    if (child instanceof Ellipse && child.name !== 'ribbonContainer') {
      controlsToRemove.push(child)
    }
  })
  
  controlsToRemove.forEach(control => {
    if (overlayMapContainer) {
      overlayMapContainer.removeControl(control)
    }
    control.dispose()
  })
  
  // Re-add node markers with proper z-index
  Object.entries(NODES).forEach(([id, n]) => {
    const m = new Ellipse()
    m.width = "12px"
    m.height = "12px"
    m.thickness = 2
    m.color = (id === currentId) ? 'cyan' : 'white'
    m.background = (id === currentId) ? 'rgba(0, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.5)'
    
    // Convert percentage position to overlay container coordinates
    // Map area is 260x190 pixels (reduced height for ribbons)
    const containerWidth = 260
    const containerHeight = 190
    const pixelX = (n.map.x / 100) * containerWidth + 10
    const pixelY = (n.map.y / 100) * containerHeight - 5
    
    if (n.floor !== currentFloor) {
      // Skip nodes not on the current floor
      return      
    }

    m.left = (pixelX - containerWidth / 2) + "px" // Center around container
    m.top = (pixelY - containerHeight / 2 + 25) + "px" // Offset down for ribbons
    
    // Ensure nodes appear above the floor image
    m.zIndex = 10
    
    m.onPointerUpObservable.add(() => switchToNode(id))
    if (overlayMapContainer) {
      overlayMapContainer.addControl(m)
    }
  })
}

function switchFloor(floorId: string) {
  if (floorId === currentFloor) return // Already on this floor
  
  console.log(`🏢 Switching to floor: ${floorId}`)
  currentFloor = floorId
  
  // Update ribbons and floor image
  createFloorRibbons() // Refresh ribbon states
  updateFloorImage()
  
  // Rebuild nodes to ensure proper z-index ordering
  rebuildMapNodes()
  
  // In layout mode, also log for debugging
  if (LAYOUT_MODE) {
    console.log(`🎨 LAYOUT MODE: Floor switched to ${floorId}`)
  }
}

// Global functions for layout mode (accessible from browser console)
function switchToFloorUG() { switchFloor('UG') }
function switchToFloorEG() { switchFloor('EG') }
function switchToFloorOG() { switchFloor('OG') }
function switchToFloorDA() { switchFloor('DA') }

// Make functions globally accessible for layout mode
if (LAYOUT_MODE) {
  (window as any).switchToFloorUG = switchToFloorUG;
  (window as any).switchToFloorEG = switchToFloorEG;
  (window as any).switchToFloorOG = switchToFloorOG;
  (window as any).switchToFloorDA = switchToFloorDA;
  (window as any).switchFloor = switchFloor;
  (window as any).currentFloor = () => currentFloor;
}

function updateMapPosition() {
  if (leftController && leftController.grip && mapPlane) {
    console.log('Attaching map to left controller')
    
    // Hide overlay map if it exists
    if (overlayMapContainer) {
      overlayMapContainer.isVisible = false
    }
    
    // Attach to left controller
    mapPlane.parent = leftController.grip
    
    // Position relative to controller (above and slightly forward)
    mapPlane.position = new Vector3(0, 0.15, 0.1)
    mapPlane.rotation = new Vector3(-Math.PI / 4, 0, 0) // Tilt towards user
    mapPlane.billboardMode = Mesh.BILLBOARDMODE_NONE
    
    // Reduce renderingGroupId to ensure it renders on top
    mapPlane.renderingGroupId = 3
    mapPlane.setEnabled(true)
  } else {
    console.log('Using overlay map (no controller available)')
    
    // Hide 3D map if it exists
    if (mapPlane) {
      mapPlane.setEnabled(false)
      mapPlane.parent = null
    }
    
    // Show overlay map
    if (overlayMapContainer) {
      overlayMapContainer.isVisible = true
    }
  }
}

function updateMapSelection() {
  // Clean up existing maps
  if (mapADT) {
    mapADT.dispose()
    mapADT = null as any
  }
  if (mapPlane) {
    mapPlane.dispose()
    mapPlane = null as any
  }
  if (overlayMapContainer) {
    if (overlayADT) {
      overlayADT.removeControl(overlayMapContainer)
    }
    overlayMapContainer.dispose()
    overlayMapContainer = null
  }
  
  // Rebuild map with current configuration
  buildMap()
}

async function enableXR() {
  // Enhanced WebXR experience with Quest 3 optimizations
  xrExperience = await WebXRDefaultExperience.CreateAsync(scene, {
    disableTeleportation: true, // In PhotoDomes unnatürlich – wir springen zwischen Knoten
    pointerSelectionOptions: { 
      enablePointerSelectionOnAllControllers: true,
      maxPointerDistance: 10 // Limit ray distance for performance
    }
  })
  
  // Add WebXR state management for Meta menu transitions
  if (xrExperience.baseExperience) {
    xrExperience.baseExperience.onStateChangedObservable.add((state: any) => {
      console.log(`🥽 XR State changed: ${state}`)
      
      if (state === 'IN_XR') {
        // Ensure render loop is active when entering XR
        if (!engine.runRenderLoop) {
          engine.runRenderLoop(() => {
            if (scene.activeCamera) {
              scene.render()
            }
          })
        }
        
        // Re-trigger any pending transitions after XR mode activation
        if (isTransitioning) {
          console.log('🔄 Resetting transition state after XR activation')
          setTimeout(() => {
            isTransitioning = false // Reset transition lock
            rebuildMapNodes() // Refresh UI
          }, 100)
        }
        
        // Force update map position
        setTimeout(() => updateMapPosition(), 500)
        
        // Apply Quest 3 specific optimizations
        applyQuest3Optimizations()
      }
    })
    
    // Handle session interruption and restoration
    xrExperience.baseExperience.sessionManager?.onXRSessionInit?.add(() => {
      console.log('🟢 XR Session initialized')
      
      // Ensure proper engine state
      engine.setHardwareScalingLevel(1.0)
    })
    
    xrExperience.baseExperience.sessionManager?.onXRSessionEnded?.add(() => {
      console.log('🔴 XR Session ended')
      
      // Clean up any stuck states
      isTransitioning = false
      
      // Reset map position for non-VR mode
      updateMapPosition()
    })
  }
  
  // Apply Quest 3 optimizations
  applyQuest3Optimizations()
  
  // Set up controller tracking
  if (xrExperience.input) {
    xrExperience.input.onControllerAddedObservable.add((controller: any) => {
      console.log(`Controller added: ${controller.inputSource.handedness}`)
      
      if (controller.inputSource.handedness === 'left') {
        leftController = controller
        console.log('Left controller detected, will attach map')
        updateMapPosition()
      }
    })
    
    xrExperience.input.onControllerRemovedObservable.add((controller: any) => {
      if (controller.inputSource.handedness === 'left') {
        leftController = null
        console.log('Left controller removed, map will fallback to viewport')
        updateMapPosition()
      }
    })
  }
  
  // Update map position when entering/exiting XR
  if (xrExperience.baseExperience) {
    xrExperience.baseExperience.onStateChangedObservable.add(() => {
      setTimeout(() => updateMapPosition(), 500) // Small delay to ensure controllers are initialized
    })
  }
}

// Quest 3 specific optimizations
function applyQuest3Optimizations() {
  console.log('🎯 Applying Meta Quest 3 optimizations')
  
  // Set optimal render settings for Quest 3
  if (xrExperience?.baseExperience?.sessionManager?.session) {
    const session = xrExperience.baseExperience.sessionManager.session
    
    // Try to set preferred framerate (90Hz for Quest 3)
    if (session.updateRenderState) {
      try {
        session.updateRenderState({
          baseLayer: session.renderState.baseLayer
        })
      } catch (error) {
        console.warn('Could not update render state:', error)
      }
    }
  }
  
  // Optimize scene for VR performance
  scene.freezeActiveMeshes() // Freeze culling calculations when possible
  scene.skipFrustumClipping = true // Skip frustum clipping for spherical environments
  
  // Optimize rendering pipeline
  const engineCaps = scene.getEngine().getCaps()
  if (engineCaps.maxAnisotropy) {
    engineCaps.maxAnisotropy = 1 // Reduce anisotropic filtering for performance
  }
  
  console.log('✅ Quest 3 optimizations applied')
}

async function switchNode(targetId: string) {
  if (!isInitialized) {
    console.warn('Nodes not yet initialized')
    return
  }
  
  if (LAYOUT_MODE) {
    // In layout mode, just update the map selection and show feedback
    console.log(`🎯 LAYOUT MODE: Selected node "${targetId}"`)
    currentId = targetId
    updateMapSelection()
    return
  }
  
  await switchToNode(targetId)
}

// Function to show initial node without transitions
function showInitialNode(nodeId: string) {
  if (!isInitialized) {
    console.warn('Nodes not yet initialized')
    return
  }
  
  console.log(`Attempting to show initial node: ${nodeId}`)
  console.log(`Available domes:`, Object.keys(domes))
  console.log(`Current dome:`, domes[nodeId])
  
  // Show initial node's dome and hotspots immediately
  currentId = nodeId
  if (domes[currentId]) {
    domes[currentId].setEnabled(true)
    // Ensure the material is fully opaque for initial display
    const material = domes[currentId].mesh.material as any
    if (material) {
      material.alpha = 1
    }
    console.log(`Dome enabled for ${currentId}`)
  } else {
    console.error(`No dome found for ${currentId}`)
  }
  
  if (hotspotMeshes[currentId]) {
    hotspotMeshes[currentId].forEach(mesh => mesh.setEnabled(true))
    console.log(`Enabled ${hotspotMeshes[currentId].length} hotspots for ${currentId}`)
  }
  
  console.log(`Showing initial node: ${currentId}`)
}

// --- Init ---
if (LAYOUT_MODE) {
  // LAYOUT MODE: Quick setup for positioning nodes
  console.log('🎨 LAYOUT MODE: Quick preview for positioning nodes')
  
  // Load nodes from JSON first
  loadNodesFromJSON().then((loadedNodes) => {
    NODES = loadedNodes
    
    if (Object.keys(NODES).length === 0) {
      console.error('Failed to load nodes from JSON in layout mode')
      return
    }
    
    // Create a simple dome immediately for layout preview
    const layoutDome = new PhotoDome('layoutDome', FALLBACK_IMAGE, { size: SPHERE_RADIUS * 2 }, scene)
    layoutDome.mesh.renderingGroupId = 0
    console.log('Layout dome created with fallback image')
    
    // Add compass overlay to layout dome
    // addCompassOverlayToDome(layoutDome, 'layout')
    
    // Show map immediately without loading all nodes
    isInitialized = true // Mark as initialized to allow map interactions
    buildMap()
    
    console.log('🗺️  Map visible! Adjust node positions in JSON file to see them move.')
    console.log('🎯 Click nodes on map to see selection change (no panorama switching)')
    console.log('✏️  Edit map: { x: 0-1, y: 0-1 } values in JSON to position nodes')
    console.log('💡 Set LAYOUT_MODE = false for production mode with full loading.')
    console.log('🎯 Yellow "LAYOUT MODE" indicator shows on map when active')
    console.log('🏢 Press 1-4 keys to switch floors: 1=UG, 2=EG, 3=OG, 4=DA')
    console.log('💻 Console functions: switchToFloorUG(), switchToFloorEG(), switchToFloorOG(), switchToFloorDA()')
    
    // Add keyboard shortcuts for floor switching in layout mode
    document.addEventListener('keydown', (event) => {
      if (!LAYOUT_MODE) return // Only work in layout mode
      
      switch(event.key) {
        case '1':
          switchFloor('UG')
          console.log('⌨️  Keyboard: Switched to UG (key 1)')
          break
        case '2':
          switchFloor('EG')
          console.log('⌨️  Keyboard: Switched to EG (key 2)')
          break
        case '3':
          switchFloor('OG')
          console.log('⌨️  Keyboard: Switched to OG (key 3)')
          break
        case '4':
          switchFloor('DA')
          console.log('⌨️  Keyboard: Switched to DA (key 4)')
          break
      }
    })
  }).catch(error => {
    console.error('Failed to load JSON in layout mode:', error)
  })
  
} else {
  // PRODUCTION MODE: Full loading experience
  console.log('🚀 PRODUCTION MODE: Full loading experience')
  
  // Create and show loading screen immediately
  createLoadingScreen()

  // Initialize all nodes, then show the first one
  initializeAllNodes().then(async () => {
    // Small delay to show 100% for a moment
    setTimeout(async () => {
      // Hide loading screen with smooth fade
      await hideLoadingScreen()
      
      // Show the initial node and map
      showInitialNode(currentId)
      buildMap()
      rebuildMapNodes()
    }, 500)
  })
}

enableXR().catch(console.error)

// Start performance monitoring
performanceMonitor.start()
console.log('📊 Performance monitoring started')

engine.runRenderLoop(() => scene.render())
addEventListener('resize', () => engine.resize())
