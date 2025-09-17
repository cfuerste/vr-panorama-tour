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
  disableWebGL2Support: false
})

console.log('🚀 Babylon.js Engine initialized')

const scene = new Scene(engine)

console.log('🎭 Scene created')

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

// Utility function to check if we're currently in VR mode
function isInVRMode(): boolean {
  return xrExperience && 
         xrExperience.baseExperience && 
         xrExperience.baseExperience.state === 4 // IN_XR state
}

// Force a comprehensive dome refresh for WebXR compatibility
function forceWebXRDomeRefresh(nodeId: string): void {
  if (!isInVRMode() || !domes[nodeId]) {
    return
  }
  
  const dome = domes[nodeId]
  if (!dome || !dome.mesh || !dome.mesh.material) {
    return
  }
  
  const material = dome.mesh.material as any
  
  try {
    // Force texture refresh for WebXR
    if (material.diffuseTexture) {
      material.diffuseTexture.wrapU = material.diffuseTexture.wrapU
      material.diffuseTexture.wrapV = material.diffuseTexture.wrapV
      if (material.diffuseTexture._prepareRowForTextureGeneration) {
        material.diffuseTexture._prepareRowForTextureGeneration()
      }
    }
    
    // Mark material and mesh as dirty
    if (material.markDirty) {
      material.markDirty()
    }
    material.markAsDirty()
    dome.mesh.markAsDirty()
    
    // Force WebXR scene refresh
    if (scene) {
      scene.markAllMaterialsAsDirty(1) // Texture flag
      scene.render()
    }
    
    console.log(`Forced WebXR refresh for dome: ${nodeId}`)
  } catch (error) {
    console.warn(`Error during WebXR dome refresh for ${nodeId}:`, error)
  }
}



// Grad -> Radiant
const deg = (d: number) => d * Math.PI / 180

const DEBUG_INVERT_YAW = false

// DEBUG MODE: Set to true for instant layout preview (no loading screen)
const LAYOUT_MODE = false  // Change to false for production

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
    // Update text based on loading phase
    if (total <= PRELOAD_CONFIG.IMMEDIATE_LOAD_COUNT) {
      loadingText.text = `Loading essential panoramas... ${percentage}% (${loaded}/${total})`
    } else {
      loadingText.text = `Loading panoramas... ${percentage}% (${loaded}/${total})`
    }
  }
  
  console.log(`Loading progress: ${loaded}/${total} (${percentage}%)`)
}

// Show temporary loading indicator for on-demand loading
function showQuickLoadingIndicator(nodeName: string) {
  if (!overlayADT) return
  
  const indicator = new Rectangle("quickLoading")
  indicator.width = "200px"
  indicator.height = "60px"
  indicator.cornerRadius = 10
  indicator.color = "white"
  indicator.background = "rgba(0, 0, 0, 0.8)"
  indicator.horizontalAlignment = 1 // Center
  indicator.verticalAlignment = 1 // Center
  
  const loadingText = new TextBlock("quickLoadingText")
  loadingText.text = `Loading ${nodeName}...`
  loadingText.color = "white"
  loadingText.fontSize = 16
  indicator.addControl(loadingText)
  
  overlayADT.addControl(indicator)
  
  // Auto-remove after 3 seconds (fallback)
  setTimeout(() => {
    try {
      if (overlayADT && indicator.parent) {
        overlayADT.removeControl(indicator)
        indicator.dispose()
      }
    } catch (error) {
      // Ignore disposal errors
    }
  }, 3000)
  
  return indicator
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

// Preload configuration
const PRELOAD_CONFIG = {
  // Load immediately: current node + directly connected nodes
  IMMEDIATE_LOAD_COUNT: 3,
  // Use optimized textures for faster loading
  USE_OPTIMIZED_TEXTURES: true,
  // Background loading batch size
  BACKGROUND_BATCH_SIZE: 2,
  // Background loading delay between batches (ms)
  BACKGROUND_DELAY: 500,
  // Texture sampling mode - use high quality for VR
  TEXTURE_SAMPLING_MODE: Texture.TRILINEAR_SAMPLINGMODE, // Better quality for VR
  // Show performance info in console
  SHOW_PERFORMANCE_INFO: true
}

// Track loading state
let backgroundLoadingActive = false
let loadedNodeIds = new Set<string>()
let loadingQueue: string[] = []

// Get optimized texture path if available
function getOptimizedTexturePath(originalPath: string): string {
  if (!PRELOAD_CONFIG.USE_OPTIMIZED_TEXTURES) {
    return originalPath
  }
  
  // Check if optimized version exists
  const optimizedPath = originalPath.replace('./panos/', './panos/optimized_natural/')
  return optimizedPath
}

// Get the original texture path for a node ID
function getOriginalTexturePath(nodeId: string): string {
  const node = NODES[nodeId]
  if (!node) {
    return FALLBACK_IMAGE
  }
  
  // Try optimized first, then fallback to original
  return getOptimizedTexturePath(node.image)
}

// Preload only essential nodes for fast startup
async function initializeEssentialNodes() {
  console.log('Loading essential nodes for fast startup...')
  
  // Load nodes from JSON file
  NODES = await loadNodesFromJSON()
  
  if (Object.keys(NODES).length === 0) {
    console.error('Failed to load nodes from JSON, cannot initialize tour')
    return
  }
  
  // Determine essential nodes to load immediately
  const essentialNodeIds = getEssentialNodeIds()
  
  console.log(`Loading ${essentialNodeIds.length} essential nodes immediately...`)
  
  // Store camera's initial rotation for consistent coordinate system
  const initialCameraRotation = camera.rotation.clone()
  
  const promises = essentialNodeIds.map((nodeId, index) => {
    return loadSingleNode(nodeId, NODES[nodeId], initialCameraRotation, index, essentialNodeIds.length)
  })
  
  await Promise.all(promises)
  
  // Mark remaining nodes for background loading
  const remainingNodeIds = Object.keys(NODES).filter(id => !essentialNodeIds.includes(id))
  loadingQueue = remainingNodeIds
  
  isInitialized = true
  console.log(`Essential nodes loaded! ${remainingNodeIds.length} nodes queued for background loading.`)
  
  // Start background loading
  startBackgroundLoading()
}

// Get list of node IDs that should be loaded immediately
function getEssentialNodeIds(): string[] {
  const currentNode = NODES[currentId]
  if (!currentNode) {
    // Fallback to first available node
    const firstNodeId = Object.keys(NODES)[0]
    currentId = firstNodeId
    return [firstNodeId]
  }
  
  const essentialIds = new Set<string>()
  
  // 1. Always load the starting node
  essentialIds.add(currentId)
  
  // 2. Load directly connected nodes (hotspot destinations)
  currentNode.links.forEach(link => {
    if (NODES[link.to]) {
      essentialIds.add(link.to)
    }
  })
  
  // 3. Limit to configuration maximum
  const idsArray = Array.from(essentialIds)
  return idsArray.slice(0, PRELOAD_CONFIG.IMMEDIATE_LOAD_COUNT)
}

// Load a single node (dome + hotspots)
async function loadSingleNode(
  nodeId: string, 
  node: Node, 
  initialCameraRotation: Vector3, 
  index: number, 
  total: number
): Promise<void> {
  return new Promise<void>((resolve) => {
    const startTime = performance.now()
    
    // Try optimized texture first, fallback to original
    const texturePath = getOptimizedTexturePath(node.image)
    
    console.log(`Loading node ${nodeId} (${index + 1}/${total}): ${texturePath}`)
    
    // Use appropriate sampling mode for good quality
    const samplingMode = PRELOAD_CONFIG.TEXTURE_SAMPLING_MODE
    
    new Texture(texturePath, scene, true, false, samplingMode,
      () => {
        const loadTime = performance.now() - startTime
        if (PRELOAD_CONFIG.SHOW_PERFORMANCE_INFO) {
          console.log(`✅ Successfully loaded texture for ${nodeId} in ${loadTime.toFixed(1)}ms`)
        }
        createDomeAndHotspots(nodeId, texturePath, node, initialCameraRotation)
        loadedNodeIds.add(nodeId)
        updateLoadingProgress(index + 1, total)
        resolve()
      },
      () => {
        console.warn(`⚠️ Optimized texture failed for ${nodeId}, trying original...`)
        // Fallback to original texture
        new Texture(node.image, scene, true, false, samplingMode,
          () => {
            const loadTime = performance.now() - startTime
            if (PRELOAD_CONFIG.SHOW_PERFORMANCE_INFO) {
              console.log(`✅ Successfully loaded original texture for ${nodeId} in ${loadTime.toFixed(1)}ms`)
            }
            createDomeAndHotspots(nodeId, node.image, node, initialCameraRotation)
            loadedNodeIds.add(nodeId)
            updateLoadingProgress(index + 1, total)
            resolve()
          },
          () => {
            const loadTime = performance.now() - startTime
            console.warn(`❌ Failed to load ${node.image}, using fallback for ${nodeId} (${loadTime.toFixed(1)}ms)`)
            createDomeAndHotspots(nodeId, FALLBACK_IMAGE, node, initialCameraRotation)
            loadedNodeIds.add(nodeId)
            updateLoadingProgress(index + 1, total)
            resolve()
          }
        )
      }
    )
  })
}

// Create dome and hotspots for a node
function createDomeAndHotspots(nodeId: string, texturePath: string, node: Node, initialCameraRotation: Vector3) {
  // Create PhotoDome
  const dome = new PhotoDome(`dome_${nodeId}`, texturePath, { size: SPHERE_RADIUS * 2 }, scene)
  dome.mesh.renderingGroupId = 0
  dome.mesh.rotation = initialCameraRotation.clone()
  dome.setEnabled(false) // Hide initially
  domes[nodeId] = dome
  
  // Create hotspots for this node
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

// Start background loading of remaining nodes
async function startBackgroundLoading() {
  if (backgroundLoadingActive || loadingQueue.length === 0) {
    return
  }
  
  backgroundLoadingActive = true
  console.log(`🔄 Starting background loading of ${loadingQueue.length} remaining nodes...`)
  
  const initialCameraRotation = camera.rotation.clone()
  const startTime = performance.now()
  
  while (loadingQueue.length > 0) {
    // Check if we're in VR mode - use smaller batches and longer delays for VR
    const isInVR = isInVRMode()
    const batchSize = isInVR ? 1 : PRELOAD_CONFIG.BACKGROUND_BATCH_SIZE
    const delay = isInVR ? PRELOAD_CONFIG.BACKGROUND_DELAY * 2 : PRELOAD_CONFIG.BACKGROUND_DELAY
    
    // Process batch
    const batch = loadingQueue.splice(0, batchSize)
    
    const batchPromises = batch.map(nodeId => {
      const node = NODES[nodeId]
      if (!node) return Promise.resolve()
      
      return loadSingleNode(nodeId, node, initialCameraRotation, 0, 1)
        .catch(error => {
          console.warn(`Background loading failed for ${nodeId}:`, error)
        })
    })
    
    await Promise.all(batchPromises)
    
    // Longer delay between batches in VR to keep the app responsive
    if (loadingQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  const totalTime = performance.now() - startTime
  backgroundLoadingActive = false
  
  if (PRELOAD_CONFIG.SHOW_PERFORMANCE_INFO) {
    console.log(`✅ All nodes loaded in background! Total time: ${(totalTime / 1000).toFixed(1)}s`)
  }
}

// Utility function to get loading statistics
function getLoadingStats() {
  const totalNodes = Object.keys(NODES).length
  const loadedCount = loadedNodeIds.size
  const queuedCount = loadingQueue.length
  
  return {
    total: totalNodes,
    loaded: loadedCount,
    queued: queuedCount,
    percentage: Math.round((loadedCount / totalNodes) * 100)
  }
}

// Load node on demand if not already loaded
async function ensureNodeLoaded(nodeId: string): Promise<boolean> {
  if (loadedNodeIds.has(nodeId)) {
    return true // Already loaded
  }
  
  const node = NODES[nodeId]
  if (!node) {
    console.warn(`Node ${nodeId} not found in NODES`)
    return false
  }
  
  console.log(`⚡ Loading node on demand: ${nodeId}`)
  
  // Show quick loading indicator
  const loadingIndicator = showQuickLoadingIndicator(node.name || nodeId)
  
  try {
    const initialCameraRotation = camera.rotation.clone()
    await loadSingleNode(nodeId, node, initialCameraRotation, 0, 1)
    
    // Hide loading indicator
    if (loadingIndicator && overlayADT) {
      try {
        overlayADT.removeControl(loadingIndicator)
        loadingIndicator.dispose()
      } catch (error) {
        // Ignore disposal errors
      }
    }
    
    // Also prioritize loading connected nodes
    const connectedNodes = node.links
      .map(link => link.to)
      .filter(id => NODES[id] && !loadedNodeIds.has(id))
      .slice(0, 2) // Load up to 2 connected nodes
    
    if (connectedNodes.length > 0) {
      console.log(`🔗 Also loading ${connectedNodes.length} connected nodes...`)
      const connectedPromises = connectedNodes.map(id => 
        loadSingleNode(id, NODES[id], initialCameraRotation, 0, 1)
          .catch(error => console.warn(`Failed to load connected node ${id}:`, error))
      )
      // Don't await these - load in background
      Promise.all(connectedPromises)
    }
    
    return true
  } catch (error) {
    console.error(`Failed to load node ${nodeId}:`, error)
    
    // Hide loading indicator on error
    if (loadingIndicator && overlayADT) {
      try {
        overlayADT.removeControl(loadingIndicator)
        loadingIndicator.dispose()
      } catch (error) {
        // Ignore disposal errors
      }
    }
    
    return false
  }
}

// Switch to a specific node with smart loading
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
  
  // Ensure target node is loaded
  const isLoaded = await ensureNodeLoaded(nodeId)
  if (!isLoaded) {
    console.error(`Failed to load target node: ${nodeId}`)
    return
  }
  
  isTransitioning = true
  
  try {
    // Get the link info for camera rotation if available
    const currentNode = NODES[currentId]
    const linkToTarget = currentNode?.links.find(link => link.to === nodeId)
    
    const oldNodeId = currentId
    currentId = nodeId
    
    // Check if we're in VR mode
    const isInVR = isInVRMode()
    
    console.log(`Switching from ${oldNodeId} to ${currentId}, VR mode: ${isInVR}`)
    
    // Hide old hotspots and show new ones FIRST
    if (hotspotMeshes[oldNodeId]) {
      hotspotMeshes[oldNodeId].forEach(mesh => {
        mesh.setEnabled(false)
        // In VR mode, ensure proper cleanup
        if (isInVR && mesh.material) {
          const material = mesh.material as any
          if (material && material.markDirty) {
            material.markDirty()
          }
        }
      })
    }
    if (hotspotMeshes[currentId]) {
      hotspotMeshes[currentId].forEach(mesh => {
        mesh.setEnabled(true)
        // In VR mode, ensure proper material refresh
        if (isInVR && mesh.material) {
          const material = mesh.material as any
          if (material && material.markDirty) {
            material.markDirty()
          }
        }
      })
    }
    
    if (isInVR) {
      // In VR mode, use complete dome recreation for WebXR compatibility
      console.log('VR mode detected, using complete dome recreation for WebXR')
      
      // Hide old dome immediately
      if (domes[oldNodeId]) {
        domes[oldNodeId].setEnabled(false)
        console.log(`Disabled dome: ${oldNodeId}`)
      }
      
      // For WebXR, we need to completely recreate the dome to ensure proper texture binding
      if (domes[currentId]) {
        const existingDome = domes[currentId]
        const texturePath = getOriginalTexturePath(currentId)
        
        console.log(`Recreating dome for WebXR: ${currentId} with texture: ${texturePath}`)
        
        // Dispose the existing dome
        existingDome.dispose()
        delete domes[currentId]
        
        // Create a new dome with fresh material and texture
        const newDome = new PhotoDome(`dome_${currentId}_vr`, texturePath, { size: SPHERE_RADIUS * 2 }, scene)
        newDome.mesh.renderingGroupId = 0
        newDome.mesh.rotation = camera.rotation.clone()
        
        // Store the new dome
        domes[currentId] = newDome
        
        // Enable immediately
        newDome.setEnabled(true)
        
        // Force WebXR refresh
        if (scene) {
          scene.markAllMaterialsAsDirty(1)
          scene.render()
          setTimeout(() => scene.render(), 16)
        }
        
        console.log(`✅ VR dome recreated for ${currentId}`)
      }
      
      // Still do camera rotation if available
      if (linkToTarget) {
        await rotateCameraToTarget(linkToTarget.yaw, linkToTarget.pitch)
      }
    } else {
      // Desktop mode: use smooth crossfade
      console.log('Desktop mode, using smooth crossfade')
      
      // Enable the new node but make it transparent initially
      if (domes[currentId]) {
        domes[currentId].setEnabled(true)
        const newMaterial = domes[currentId].mesh.material as any
        if (newMaterial) {
          newMaterial.alpha = 0
        }
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
    }
    
    updateMapSelection()
    console.log(`Switched to node: ${currentId}`)
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
      console.warn(`Missing dome for crossfade: from=${!!fromDome}, to=${!!toDome}`)
      resolve()
      return
    }
    
    // Access the mesh materials directly
    const fromMaterial = fromDome.mesh.material as any
    const toMaterial = toDome.mesh.material as any
    
    if (!fromMaterial || !toMaterial) {
      console.warn(`Missing materials for crossfade: from=${!!fromMaterial}, to=${!!toMaterial}`)
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
    
    console.log(`Starting crossfade from ${fromNodeId} to ${toNodeId}`)
    
    const crossfadeAnimation = () => {
      const elapsed = Date.now() - startTime
      let progress = Math.min(elapsed / TRANSITION_DURATION, 1)
      
      // Use ease-in-out curve for smooth transition
      const easeProgress = progress < 0.5 
        ? 2 * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 2) / 2
      
      try {
        // Crossfade the alpha values with safety checks
        if (fromMaterial && typeof fromMaterial.alpha === 'number') {
          fromMaterial.alpha = initialFromAlpha * (1 - easeProgress)
        }
        if (toMaterial && typeof toMaterial.alpha === 'number') {
          toMaterial.alpha = easeProgress
        }
        
        // Subtle zoom effect on the outgoing dome
        if (fromDome && fromDome.mesh && fromDome.mesh.scaling) {
          const currentScale = Vector3.Lerp(initialScale, targetScale, easeProgress * 0.5) // Subtle effect
          fromDome.mesh.scaling = currentScale
        }
        
        // Zoom in effect on the incoming dome (starts zoomed out slightly)
        if (toDome && toDome.mesh && toDome.mesh.scaling) {
          const incomingScale = Vector3.Lerp(
            initialScale.clone().scaleInPlace(1.02), // Start slightly zoomed in
            initialScale, // End at normal scale
            easeProgress
          )
          toDome.mesh.scaling = incomingScale
        }
      } catch (error) {
        console.warn('Error during crossfade animation:', error)
        // Force completion
        progress = 1
      }
      
      if (progress < 1) {
        requestAnimationFrame(crossfadeAnimation)
      } else {
        // Ensure final state with safety checks
        try {
          if (fromMaterial) fromMaterial.alpha = 0
          if (toMaterial) toMaterial.alpha = 1
          if (fromDome && fromDome.mesh) fromDome.mesh.scaling = initialScale
          if (toDome && toDome.mesh) toDome.mesh.scaling = initialScale
        } catch (error) {
          console.warn('Error setting final crossfade state:', error)
        }
        console.log(`Crossfade completed from ${fromNodeId} to ${toNodeId}`)
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
  (window as any).getLoadingStats = getLoadingStats;
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

// Check if WebXR is supported
async function checkWebXRSupport(): Promise<boolean> {
  try {
    if (!navigator.xr) {
      console.log('❌ WebXR not supported on this device')
      return false
    }
    
    const isSupported = await navigator.xr.isSessionSupported('immersive-vr')
    console.log('🥽 WebXR VR support:', isSupported)
    return isSupported
  } catch (error) {
    console.warn('❌ Error checking WebXR support:', error)
    return false
  }
}

// Create VR button for user-initiated VR entry
function createVRButton(): HTMLButtonElement {
  const vrButton = document.createElement('button')
  vrButton.id = 'vrButton'
  vrButton.textContent = '🥽 Enter VR'
  vrButton.style.position = 'fixed'
  vrButton.style.top = '20px'
  vrButton.style.right = '20px'
  vrButton.style.zIndex = '1000'
  vrButton.style.padding = '12px 20px'
  vrButton.style.backgroundColor = '#007acc'
  vrButton.style.color = 'white'
  vrButton.style.border = 'none'
  vrButton.style.borderRadius = '6px'
  vrButton.style.cursor = 'pointer'
  vrButton.style.fontSize = '16px'
  vrButton.style.fontFamily = 'Arial, sans-serif'
  vrButton.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)'
  vrButton.style.transition = 'all 0.3s ease'
  
  vrButton.addEventListener('mouseenter', () => {
    vrButton.style.backgroundColor = '#005a9e'
    vrButton.style.transform = 'translateY(-2px)'
  })
  
  vrButton.addEventListener('mouseleave', () => {
    vrButton.style.backgroundColor = '#007acc'
    vrButton.style.transform = 'translateY(0)'
  })
  
  vrButton.addEventListener('click', () => {
    enableXR().catch(error => {
      console.error('❌ Failed to enable VR:', error)
      vrButton.textContent = '❌ VR Failed'
      vrButton.style.backgroundColor = '#dc3545'
      setTimeout(() => {
        vrButton.textContent = '🥽 Enter VR'
        vrButton.style.backgroundColor = '#007acc'
      }, 3000)
    })
  })
  
  return vrButton
}

async function enableXR() {
  try {
    console.log('🥽 Starting VR initialization...')
    
    // Double-check WebXR support before attempting to create session
    const isSupported = await checkWebXRSupport()
    if (!isSupported) {
      throw new Error('WebXR VR sessions are not supported on this device')
    }
    
    // Show loading state
    const vrButton = document.getElementById('vrButton') as HTMLButtonElement
    if (vrButton) {
      vrButton.textContent = '⏳ Starting VR...'
      vrButton.disabled = true
    }
    
    // Vollständiges WebXR-Default-Experience (UI, Pointer-Selection etc.)
    xrExperience = await WebXRDefaultExperience.CreateAsync(scene, {
      disableTeleportation: true, // In PhotoDomes unnatürlich – wir springen zwischen Knoten
      pointerSelectionOptions: { enablePointerSelectionOnAllControllers: true }
      // Hand-Tracking ist als Feature inkludiert (per Import aktiviert).
    })
    
    console.log('✅ WebXR experience created successfully')
    
    // Update button state
    if (vrButton) {
      vrButton.textContent = '✅ VR Ready'
      vrButton.style.backgroundColor = '#28a745'
    }
    
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
      xrExperience.baseExperience.onStateChangedObservable.add(async (state: any) => {
        setTimeout(() => updateMapPosition(), 500) // Small delay to ensure controllers are initialized
        
        // Enhanced dome refresh when entering VR mode
        if (state === 4 && isInitialized && currentId && domes[currentId]) { // IN_XR state
          console.log('Entered VR mode, applying enhanced refresh...')
          try {
            // Force complete material and texture refresh for WebXR entry
            if (scene) {
              scene.markAllMaterialsAsDirty(1) // Texture flag
              scene.markAllMaterialsAsDirty(2) // Light flag
            }
            
            // Specifically refresh the current dome's material and texture
            const currentDome = domes[currentId]
            if (currentDome && currentDome.mesh && currentDome.mesh.material) {
              const material = currentDome.mesh.material as any
              if (material) {
                // Force texture refresh
                if (material.diffuseTexture) {
                  material.diffuseTexture.wrapU = material.diffuseTexture.wrapU
                  material.diffuseTexture.wrapV = material.diffuseTexture.wrapV
                  if (material.diffuseTexture._prepareRowForTextureGeneration) {
                    material.diffuseTexture._prepareRowForTextureGeneration()
                  }
                }
                
                // Mark material as completely dirty
                if (material.markDirty) {
                  material.markDirty()
                }
                material.markAsDirty()
              }
              
              // Ensure dome is enabled and visible
              currentDome.setEnabled(true)
              if (material) {
                material.alpha = 1
              }
            }
            
            // Multiple render calls to ensure WebXR synchronization
            scene.render()
            setTimeout(() => scene.render(), 16)
            setTimeout(() => scene.render(), 50)
            
            console.log('VR entry enhanced refresh completed')
          } catch (error) {
            console.warn('VR entry refresh error (non-critical):', error)
          }
        }
      })
      
      // Listen for session end to update button
      xrExperience.baseExperience.onStateChangedObservable.add((state: any) => {
        if (vrButton) {
          if (state === 4) { // IN_XR state
            vrButton.textContent = '🚪 Exit VR'
            vrButton.style.backgroundColor = '#dc3545'
          } else if (state === 0) { // NOT_IN_XR state
            vrButton.textContent = '🥽 Enter VR'
            vrButton.style.backgroundColor = '#007acc'
            vrButton.disabled = false
          }
        }
      })
    }
    
  } catch (error) {
    console.error('❌ Failed to initialize WebXR:', error)
    
    // Update button to show error
    const vrButton = document.getElementById('vrButton') as HTMLButtonElement
    if (vrButton) {
      vrButton.textContent = '❌ VR Failed'
      vrButton.style.backgroundColor = '#dc3545'
      vrButton.disabled = false
      
      // Reset button after a few seconds
      setTimeout(() => {
        vrButton.textContent = '🥽 Enter VR'
        vrButton.style.backgroundColor = '#007acc'
      }, 3000)
    }
    
    throw error
  }
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
  
  // Additional WebXR dome refresh after switching in VR mode
  if (isInVRMode()) {
    setTimeout(() => forceWebXRDomeRefresh(targetId), 100)
  }
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
  // PRODUCTION MODE: Fast loading experience with progressive enhancement
  console.log('🚀 PRODUCTION MODE: Fast loading with progressive enhancement')
  
  // Make stats available globally for debugging
  ;(window as any).getLoadingStats = getLoadingStats
  
  // Create and show loading screen immediately
  createLoadingScreen()

  // Initialize essential nodes for fast startup
  const loadingStartTime = performance.now()
  
  initializeEssentialNodes().then(async () => {
    const essentialLoadTime = performance.now() - loadingStartTime
    
    if (PRELOAD_CONFIG.SHOW_PERFORMANCE_INFO) {
      console.log(`⚡ Essential nodes loaded in ${essentialLoadTime.toFixed(1)}ms`)
    }
    
    // Small delay to show 100% for a moment
    setTimeout(async () => {
      // Hide loading screen with smooth fade
      await hideLoadingScreen()
      
      // Show the initial node and map
      showInitialNode(currentId)
      buildMap()
      rebuildMapNodes()
      
      // Show loading stats
      const stats = getLoadingStats()
      console.log(`📊 Loading complete! ${stats.loaded}/${stats.total} nodes ready (${stats.percentage}%)`)
      if (stats.queued > 0) {
        console.log(`🔄 ${stats.queued} nodes loading in background...`)
      }
    }, 500)
  })
}

// Initialize WebXR support check and VR button
async function initializeVRSupport() {
  const isSupported = await checkWebXRSupport()
  if (isSupported) {
    const vrButton = createVRButton()
    document.body.appendChild(vrButton)
    console.log('✅ VR button added to page')
  } else {
    console.log('ℹ️ WebXR not supported, VR button not shown')
  }
}

// Initialize VR support after main content is loaded
initializeVRSupport().catch(console.error)

engine.runRenderLoop(() => scene.render())
addEventListener('resize', () => engine.resize())
