// Refactored VR Panorama Viewer - Main Coordinator Class
import { Engine, Scene } from '@babylonjs/core'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { PhotoDome } from '@babylonjs/core/Helpers/photoDome'
import { Color4, Vector3 } from '@babylonjs/core/Maths/math'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'

// Import GLB loader plugin
import '@babylonjs/loaders/glTF'

// Module imports
import { 
  DataManager, 
  NavigationManager, 
  WebXRManager, 
  UIManager, 
  RenderEngine 
} from './managers'

// Existing optimized modules
import { PanoramaPreloader } from './panoramaPreloader'
import { TextureStreamer } from './textureStreamer'
import { CacheManager } from './cacheManager'
import { getAdaptiveConfig } from './quest3Config'

// Types
import type { 
  CoreRefs,
  ModuleOptions,
  TextureQuality,
  ControllerInfo
} from './types'

export class VRPanoramaViewer {
  // Core Babylon.js references
  private coreRefs!: CoreRefs
  
  // Module managers
  private dataManager!: DataManager
  private navigationManager!: NavigationManager
  private webXRManager!: WebXRManager
  private uiManager!: UIManager
  private renderEngine!: RenderEngine
  
  // Existing optimized systems
  private preloader!: PanoramaPreloader
  private textureStreamer!: TextureStreamer
  private cacheManager!: CacheManager
  
  // Configuration
  private config = getAdaptiveConfig()
  
  // State
  private isInitialized = false

  constructor(canvas: HTMLCanvasElement) {
    // Initialize core Babylon.js engine and scene
    this.initializeCore(canvas)
    
    // Initialize managers with dependency injection
    this.initializeManagers()
    
    // Start initialization process
    this.init()
  }

  private initializeCore(canvas: HTMLCanvasElement): void {
    // Initialize engine with VR optimizations
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false,
      powerPreference: "high-performance",
      antialias: false,
      alpha: false,
      doNotHandleContextLost: true,
      audioEngine: false,
      failIfMajorPerformanceCaveat: false,
      xrCompatible: true,
      premultipliedAlpha: false,
      depth: true,
      adaptToDeviceRatio: true
    })

    // Create scene with performance optimizations
    const scene = new Scene(engine)
    scene.clearColor = new Color4(0, 0, 0, 1)
    scene.skipPointerMovePicking = true
    scene.autoClear = true
    scene.autoClearDepthAndStencil = true

    // Create camera
    const camera = new UniversalCamera('Camera', new Vector3(0, 0, 0), scene)
    camera.minZ = 0.1
    camera.maxZ = 1000
    camera.fov = Math.PI / 3
    camera.attachControl(canvas, true)

    // Add lighting
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene)
    light.intensity = 1

    // Store core references
    this.coreRefs = {
      engine,
      scene,
      camera,
      currentPhotoDome: null
    }

    // Handle resize
    window.addEventListener('resize', () => {
      this.coreRefs.engine.resize()
    })
  }

  private initializeManagers(): void {
    // Initialize optimized systems first
    this.preloader = new PanoramaPreloader()
    this.textureStreamer = new TextureStreamer(this.coreRefs.scene)
    this.cacheManager = new CacheManager(this.config)

    // Create module options
    const moduleOptions: ModuleOptions = {
      coreRefs: this.coreRefs,
      config: this.config
    }

    // Initialize data manager
    this.dataManager = new DataManager(moduleOptions)

    // Initialize navigation manager with callbacks
    this.navigationManager = new NavigationManager({
      ...moduleOptions,
      onNavigate: this.handleNavigation.bind(this),
      onUserInteraction: this.handleUserInteraction.bind(this)
    })

    // Initialize WebXR manager with callbacks
    this.webXRManager = new WebXRManager({
      ...moduleOptions,
      onEnterVR: this.handleEnterVR.bind(this),
      onExitVR: this.handleExitVR.bind(this),
      onControllerConnected: this.handleControllerConnected.bind(this)
    })

    // Initialize UI manager with callbacks
    this.uiManager = new UIManager({
      ...moduleOptions,
      onEnterVR: this.handleEnterVRRequest.bind(this),
      onFloorSwitch: this.handleFloorSwitch.bind(this),
      onNavigate: this.handleNavigation.bind(this)
    })

    // Initialize render engine with callbacks
    this.renderEngine = new RenderEngine({
      ...moduleOptions,
      onUserInteraction: this.handleUserInteraction.bind(this),
      onMemoryPressure: this.handleMemoryPressure.bind(this),
      onContextLost: this.handleContextLost.bind(this),
      onContextRestored: this.handleContextRestored.bind(this)
    })
  }

  private async init(): Promise<void> {
    try {
      console.log('🚀 Initializing VR Panorama Viewer...')

      // Load panorama data
      await this.dataManager.loadPanoramaData()
      
      // Load initial panorama
      await this.loadPanorama(this.dataManager.getCurrentPanoramaId())
      
      // Start preloading connected panoramas
      this.startBackgroundPreloading()
      
      // Setup WebXR
      await this.webXRManager.setupWebXR()
      
      // Setup UI
      this.uiManager.setupUI()
      
      // Start adaptive render loop
      this.renderEngine.startAdaptiveRenderLoop()

      this.isInitialized = true
      console.log('✅ VR Panorama Viewer initialized successfully')

    } catch (error) {
      console.error('❌ Failed to initialize VR Panorama Viewer:', error)
      throw error
    }
  }

  private async loadPanorama(panoramaId: string): Promise<void> {
    if (!this.dataManager.panoramaExists(panoramaId)) {
      console.error('Panorama not found:', panoramaId)
      return
    }

    const panoramaInfo = this.dataManager.getPanoramaData()[panoramaId]
    
    // Choose appropriate image resolution based on device and VR state
    const isVR = this.webXRManager.isVRActive()
    const currentQuality = this.renderEngine.getCurrentTextureQuality()
    
    const cacheKey = this.getCacheKey(panoramaId, isVR, currentQuality)

    // Mark all cached panoramas as inactive
    this.cacheManager.markActive('')

    // Clear navigation hotspots
    this.navigationManager.clearHotspots()

    let photoDome: PhotoDome

    // Check if panorama is already cached
    if (this.cacheManager.has(cacheKey)) {
      console.log(`Using cached panorama: ${cacheKey}`)
      const cached = this.cacheManager.get(cacheKey)!
      photoDome = cached.photoDome
      this.cacheManager.markActive(cacheKey)
      
      if (photoDome.mesh) {
        photoDome.mesh.setEnabled(true)
      }
    } else {
      console.log(`Loading new panorama: ${cacheKey}`)
      
      try {
        photoDome = await this.createPhotoDome(panoramaInfo, currentQuality, isVR, cacheKey)
      } catch (error) {
        console.error('Failed to load panorama:', panoramaId, error)
        return
      }
    }

    // Update core reference
    this.coreRefs.currentPhotoDome = photoDome
    
    // Update managers
    this.dataManager.setCurrentPanorama(panoramaId)
    this.navigationManager.setCurrentPanorama(panoramaId)
    this.navigationManager.setVRActive(isVR)
    
    // Create navigation hotspots
    this.navigationManager.createHotspots(panoramaInfo.links)

    // Update UI
    this.uiManager.setCurrentPanorama(panoramaId)
    this.uiManager.updateFloorplan()
    this.uiManager.updateVRCaption()
    this.uiManager.updateInfoText()

    // Preload connected panoramas
    this.preloadConnectedPanoramas(panoramaId)

    console.log(`Loaded panorama: ${panoramaId}`)
  }

  private async createPhotoDome(
    panoramaInfo: any, 
    targetQuality: TextureQuality, 
    isVR: boolean,
    cacheKey: string
  ): Promise<PhotoDome> {
    const basePath = import.meta.env.BASE_URL
    const baseImageUrl = `${basePath}panos/optimized_natural/${panoramaInfo.image}`
    
    // Use texture streaming for better performance
    const streamedTexture = await this.textureStreamer.streamTexture(
      baseImageUrl,
      targetQuality,
      10 // High priority
    )
    
    const photoDome = new PhotoDome(
      `dome_${cacheKey}`,
      '',
      {
        resolution: isVR ? 128 : 64,
        size: 1000,
        useDirectMapping: false,
        halfDomeMode: false
      },
      this.coreRefs.scene
    )
    
    // Manually assign the streamed texture
    if (photoDome.material) {
      photoDome.material.diffuseTexture = streamedTexture
      photoDome.material.backFaceCulling = false
      
      if (!isVR) {
        photoDome.material.freeze()
      }
    }

    // VR-specific mesh configuration
    if (photoDome.mesh && isVR) {
      photoDome.mesh.flipFaces(false)
    }

    // Add to cache
    this.cacheManager.set(cacheKey, photoDome, true)

    return photoDome
  }

  private getCacheKey(panoramaId: string, isVR: boolean, quality: TextureQuality): string {
    let suffix = '_std.jpg'
    
    switch (quality) {
      case 'mobile':
        suffix = '_mobile.jpg'
        break
      case 'std':
        suffix = '_std.jpg'
        break
      case 'hq':
        suffix = isVR ? '_hq.jpg' : '_std.jpg'
        break
    }
    
    return `${panoramaId}_${suffix}`
  }

  private startBackgroundPreloading(): void {
    const currentPanoramaId = this.dataManager.getCurrentPanoramaId()
    this.preloadConnectedPanoramas(currentPanoramaId)
  }

  private preloadConnectedPanoramas(panoramaId: string): void {
    const connectedIds = this.dataManager.getConnectedPanoramas(panoramaId)
    const connectedImages: string[] = []
    const basePath = import.meta.env.BASE_URL
    const origin = window.location.origin

    connectedIds.forEach(id => {
      const panoramaInfo = this.dataManager.getPanoramaData()[id]
      if (panoramaInfo) {
        const baseImageName = panoramaInfo.image.replace('.jpg', '')
        const imagePath = `panos/optimized_natural/`
        
        connectedImages.push(`${origin}${basePath}${imagePath}${baseImageName}_std.jpg`)
        connectedImages.push(`${origin}${basePath}${imagePath}${baseImageName}_mobile.jpg`)
        connectedImages.push(`${origin}${basePath}${imagePath}${baseImageName}.jpg`)
      }
    })

    if (connectedImages.length > 0) {
      this.preloader.startPreloading(
        connectedImages,
        '',
        (progress, total) => {
          console.log(`Preloading progress: ${progress}/${total}`)
        },
        () => {
          console.log('Preloading complete')
        }
      )
    }
  }

  // Event handlers for module coordination
  private async handleNavigation(panoramaId: string): Promise<void> {
    this.renderEngine.requestRender()
    await this.loadPanorama(panoramaId)
    this.renderEngine.requestRender()
  }

  private handleUserInteraction(): void {
    this.renderEngine.markUserInteraction()
  }

  private handleEnterVR(): void {
    console.log('🥽 Coordinator: Entering VR mode')
    
    // Update all managers
    this.navigationManager.setVRActive(true)
    this.renderEngine.setVRActive(true)
    this.uiManager.setVRActive(true)
    
    // Refresh current panorama for VR
    if (this.coreRefs.currentPhotoDome?.material && this.coreRefs.currentPhotoDome.material.isFrozen) {
      this.coreRefs.currentPhotoDome.material.unfreeze()
    }
    
    this.renderEngine.requestRender()
  }

  private handleExitVR(): void {
    console.log('🖥️  Coordinator: Exiting VR mode')
    
    // Update all managers
    this.navigationManager.setVRActive(false)
    this.renderEngine.setVRActive(false)
    this.uiManager.setVRActive(false)
    
    // Re-optimize materials for desktop
    if (this.coreRefs.currentPhotoDome?.material && !this.coreRefs.currentPhotoDome.material.isFrozen) {
      this.coreRefs.currentPhotoDome.material.freeze()
    }
  }

  private async handleEnterVRRequest(): Promise<void> {
    if (this.webXRManager.isVRSupported()) {
      try {
        await this.webXRManager.enterVR()
      } catch (error) {
        console.error('Failed to enter VR:', error)
      }
    }
  }

  private handleControllerConnected(controller: ControllerInfo): void {
    console.log('Controller connected:', controller.handness)
    
    if (controller.handness === 'left' && this.webXRManager.isVRActive()) {
      this.uiManager.attachFloorplanToController(controller)
    }
  }

  private handleFloorSwitch(floor: string): void {
    console.log('Floor switched to:', floor)
    this.navigationManager.setSelectedFloor(floor)
    this.uiManager.setSelectedFloor(floor)
  }

  private handleMemoryPressure(usage: number): void {
    console.warn(`Memory pressure: ${(usage * 100).toFixed(1)}%`)
    
    // Aggressive cache cleanup
    this.cacheManager.aggressiveCleanup()
    
    // Clean up other systems
    this.preloader.dispose()
    this.preloader = new PanoramaPreloader()
    this.textureStreamer.cleanup()
  }

  private handleContextLost(): void {
    console.warn('WebGL context lost - clearing cache')
    this.cacheManager.aggressiveCleanup()
  }

  private handleContextRestored(): void {
    console.log('WebGL context restored - reloading current panorama')
    const currentId = this.dataManager.getCurrentPanoramaId()
    if (currentId) {
      this.loadPanorama(currentId).catch(error => {
        console.error('Failed to reload panorama after context restore:', error)
      })
    }
  }

  // Public API methods
  public async navigateTo(panoramaId: string): Promise<void> {
    if (!this.isInitialized) {
      console.warn('Viewer not yet initialized')
      return
    }
    
    await this.handleNavigation(panoramaId)
  }

  public async enterVR(): Promise<void> {
    await this.handleEnterVRRequest()
  }

  public async exitVR(): Promise<void> {
    if (this.webXRManager.isVRSupported()) {
      try {
        await this.webXRManager.exitVR()
      } catch (error) {
        console.error('Failed to exit VR:', error)
      }
    }
  }

  public getCurrentPanorama(): string {
    return this.dataManager.getCurrentPanoramaId()
  }

  public isVRActive(): boolean {
    return this.webXRManager.isVRActive()
  }

  public getStats(): {
    dataStats: any
    renderStats: any
    cacheStats: any
  } {
    return {
      dataStats: this.dataManager.getStatistics(),
      renderStats: this.renderEngine.getPerformanceStats(),
      cacheStats: this.cacheManager.getStats()
    }
  }

  public dispose(): void {
    console.log('🧹 Disposing VR Panorama Viewer...')
    
    // Dispose all managers
    this.renderEngine.dispose()
    this.uiManager.dispose()
    this.webXRManager.dispose()
    this.navigationManager.dispose()
    this.dataManager.dispose()
    
    // Dispose optimized systems
    this.cacheManager.clear()
    this.textureStreamer.dispose()
    this.preloader.dispose()
    
    // Dispose core Babylon.js resources
    this.coreRefs.scene.dispose()
    this.coreRefs.engine.dispose()
    
    console.log('✅ VR Panorama Viewer disposed')
  }
}

// Initialize the VR panorama viewer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  if (canvas) {
    new VRPanoramaViewer(canvas)
  } else {
    console.error('Canvas element not found')
  }
})