// Shared Types for VR Panorama Tour
import { PhotoDome } from '@babylonjs/core/Helpers/photoDome'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { AdvancedDynamicTexture, Control, TextBlock, Button, Image } from '@babylonjs/gui'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { Scene, Engine } from '@babylonjs/core'
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience'
import { Mesh } from '@babylonjs/core/Meshes/mesh'

// Core panorama data interfaces
export interface PanoramaLink {
  to: string
  yaw: number
  pitch: number
  label: string
}

export interface PanoramaData {
  name: string
  image: string
  links: PanoramaLink[]
  map: { x: number; y: number }
  floor: string
}

export interface PanoramaDatabase {
  [key: string]: PanoramaData
}

// UI-related interfaces
export interface UIComponents {
  desktopUI: AdvancedDynamicTexture | null
  enterVRButton: Button | null
  infoText: TextBlock | null
  floorplanUI: AdvancedDynamicTexture | null
  floorplanContainer: TransformNode | null
  floorplanImage: Image | null
  vrCaptionContainer: TransformNode | null
  vrCaptionUI: AdvancedDynamicTexture | null
}

export interface FloorplanElements {
  positionMarkers: Control[]
  currentLocationMarker: Control | null
  viewDirectionIndicator: Control | null
  floorSwitchButtons: Control[]
  updateObserver: any
}

// Navigation interfaces
export interface NavigationState {
  currentPanorama: string
  currentLocationLabel: string
  selectedFloor: string
  hotspots: Mesh[]
}

export interface HotspotMetadata {
  link: PanoramaLink
}

// WebXR interfaces
export interface VRState {
  isVRActive: boolean
  isVREmulationMode: boolean
  xrHelper: WebXRDefaultExperience | null
}

export interface ControllerInfo {
  handness: 'left' | 'right'
  motionController: any
  pointer?: any
  grip?: any
}

// Performance and rendering interfaces
export interface RenderingState {
  needsRender: boolean
  targetFrameRate: number
  lastFrameTime: number
  frameTimeThreshold: number
  isIdle: boolean
  lastUserInteraction: number
  renderRequestId: number | null
}

export interface MemoryState {
  currentTextureQuality: 'mobile' | 'std' | 'hq'
  lastMemoryCheck: number
  lastUIUpdate: number
}

// Core system references
export interface CoreRefs {
  engine: Engine
  scene: Scene
  camera: UniversalCamera
  currentPhotoDome: PhotoDome | null
}

// Event callback types
export type ProgressCallback = (progress: number, total: number) => void
export type CompletionCallback = () => void
export type NavigationCallback = (panoramaId: string) => Promise<void>
export type UserInteractionCallback = () => void

// Configuration and quality types
export type TextureQuality = 'mobile' | 'std' | 'hq'
export type PerformanceProfile = 'low' | 'medium' | 'high'

// Cache-related types (re-export from cacheManager for convenience)
export interface CachedPhotoDome {
  photoDome: PhotoDome
  isActive: boolean
  lastUsed: number
}

// Coordinate system types
export interface MapCoordinates {
  x: number
  y: number
}

export interface AdjustedCoordinates {
  x: number
  y: number
}

// Error handling types
export interface WebGLErrorInfo {
  operation: string
  error: number
  errorName: string
  timestamp: number
}

export interface ContextLossInfo {
  count: number
  maxRecoveryAttempts: number
  canRecover: boolean
}

// Module interfaces for dependency injection
export interface IDataManager {
  loadPanoramaData(): Promise<void>
  getPanoramaData(): PanoramaDatabase
  getCurrentPanoramaData(): PanoramaData | null
}

export interface INavigationManager {
  createHotspots(links: PanoramaLink[]): void
  clearHotspots(): void
  navigateToPanorama(targetPanorama: string): Promise<void>
  getCurrentLocationLabel(): string
  setCurrentLocationLabel(label: string): void
}

export interface IUIManager {
  setupUI(): void
  setupVRCaption(): void
  disposeVRCaption(): void
  setupFloorplanUI(): void
  disposeFloorplanUI(): void
  updateInfoText(): void
  updateVRCaption(): void
  updateFloorplan(): void
  showContextLossError(): void
}

export interface IWebXRManager {
  setupWebXR(): Promise<void>
  onEnterVR(): void
  onExitVR(): void
  isVRActive(): boolean
  getXRHelper(): WebXRDefaultExperience | null
}

export interface IRenderEngine {
  startAdaptiveRenderLoop(): void
  requestRender(): void
  markUserInteraction(): void
  checkMemoryPressure(): void
  handleMemoryPressure(memoryUsage: number): void
  dispose(): void
}

// Event emitter interfaces for loose coupling
export interface VREvents {
  'vr-enter': () => void
  'vr-exit': () => void
  'panorama-loaded': (panoramaId: string) => void
  'navigation-start': (targetPanorama: string) => void
  'user-interaction': () => void
  'memory-pressure': (usage: number) => void
  'context-lost': () => void
  'context-restored': () => void
}

// Module initialization options
export interface ModuleOptions {
  coreRefs: CoreRefs
  config: any // Quest3Config - avoiding circular dependency
  onEvent?: <K extends keyof VREvents>(event: K, callback: VREvents[K]) => void
  offEvent?: <K extends keyof VREvents>(event: K, callback: VREvents[K]) => void
}

// Floorplan-specific types
export interface FloorplanConfig {
  imageWidth: number
  imageHeight: number
  aspectRatio: number
  containerAspectRatio: number
  floors: string[]
}

export const DEFAULT_FLOORPLAN_CONFIG: FloorplanConfig = {
  imageWidth: 1000,
  imageHeight: 751,
  aspectRatio: 1000 / 751,
  containerAspectRatio: 1,
  floors: ['UG', 'EG', 'OG', 'DA']
}