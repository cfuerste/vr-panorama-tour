// VR Panorama Viewer for Meta Quest 3
import { Engine, Scene } from '@babylonjs/core'
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { PhotoDome } from '@babylonjs/core/Helpers/photoDome'
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience'
import { WebXRState } from '@babylonjs/core/XR/webXRTypes'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Animation } from '@babylonjs/core/Animations/animation'
import { Tools } from '@babylonjs/core/Misc/tools'
import { AdvancedDynamicTexture, Control, TextBlock, Button, Rectangle, Image } from '@babylonjs/gui'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { PanoramaPreloader } from './panoramaPreloader'

// Import GLB loader plugin
import '@babylonjs/loaders/glTF'

// Import WebXR features
import '@babylonjs/core/XR/features/WebXRHandTracking'
import '@babylonjs/core/XR/features/WebXRControllerPointerSelection'
import '@babylonjs/core/XR/features/WebXRPlaneDetector'
import '@babylonjs/core/XR/features/WebXRFeaturePointSystem'

// Import ActionManager
import { ActionManager } from '@babylonjs/core/Actions/actionManager'
import { ExecuteCodeAction } from '@babylonjs/core/Actions/directActions'

// Types
interface PanoramaLink {
  to: string
  yaw: number
  pitch: number
  label: string
}

interface PanoramaData {
  name: string
  image: string
  links: PanoramaLink[]
  map: { x: number; y: number }
  floor: string
}

interface PanoramaDatabase {
  [key: string]: PanoramaData
}

class VRPanoramaViewer {
  private engine: Engine
  private scene: Scene
  private camera: UniversalCamera
  private xrHelper: WebXRDefaultExperience | null = null
  private currentPhotoDome: PhotoDome | null = null
  private hotspots: Mesh[] = []
  private panoramaData: PanoramaDatabase = {}
  private currentPanorama: string = 'Panorama_Außenanlagen_001'
  private currentLocationLabel: string = 'Drehgestelllager'
  private floorplanUI: AdvancedDynamicTexture | null = null
  private floorplanContainer: TransformNode | null = null
  private floorplanPositionMarkers: Control[] = []
  private floorplanCurrentLocationMarker: Control | null = null
  private floorplanViewDirectionIndicator: Control | null = null
  private floorplanUpdateObserver: any = null
  private selectedFloor: string = 'EG' // Currently selected floor for floorplan view
  private floorplanImage: Image | null = null // Reference to floorplan image for updating
  private floorSwitchButtons: Control[] = [] // Array to store floor switch buttons
  private isVRActive = false
  private infoText: TextBlock | null = null
  private enterVRButton: Button | null = null
  private desktopUI: AdvancedDynamicTexture | null = null
  private vrCaptionContainer: TransformNode | null = null
  private vrCaptionUI: AdvancedDynamicTexture | null = null
  private vrCaptionRenderObserver: any = null
  private isVREmulationMode = false
  private preloader: PanoramaPreloader

  constructor(canvas: HTMLCanvasElement) {
    // Initialize engine with VR optimizations and improved WebGL error handling
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false,
      powerPreference: "high-performance",
      antialias: false, // Better VR performance
      alpha: false,
      doNotHandleContextLost: true, // Better performance on Quest
      audioEngine: false, // Disable audio engine if not needed
      // Enhanced framebuffer handling
      failIfMajorPerformanceCaveat: false,
      xrCompatible: true, // Ensure XR compatibility
      // Improved multisample handling for VR
      premultipliedAlpha: false,
      depth: true,
      // Better error recovery
      adaptToDeviceRatio: true
    })

    // Add WebGL error handling
    const gl = this.engine._gl
    if (gl) {
      // Override WebGL functions to catch and handle framebuffer errors gracefully
      const originalFramebufferTexture2D = gl.framebufferTexture2D
      gl.framebufferTexture2D = function(target: number, attachment: number, textarget: number, texture: WebGLTexture | null, level: number) {
        try {
          return originalFramebufferTexture2D.call(this, target, attachment, textarget, texture, level)
        } catch (error) {
          console.warn('WebGL framebuffer operation failed, continuing:', error)
          return null
        }
      }
    }

    // Create scene with performance optimizations
    this.scene = new Scene(this.engine)
    this.scene.clearColor = new Color4(0, 0, 0, 1)
    
    // Performance optimizations
    this.scene.skipPointerMovePicking = true // Skip unnecessary picking
    this.scene.autoClear = true
    this.scene.autoClearDepthAndStencil = true
    
    // Add global error handling for WebGL context
    this.engine.onContextLostObservable.add(() => {
      console.warn('WebGL context lost - attempting recovery')
    })
    
    this.engine.onContextRestoredObservable.add(() => {
      console.log('WebGL context restored successfully')
    })

    // Create camera
    this.camera = new UniversalCamera('Camera', new Vector3(0, 0, 0), this.scene)
    this.camera.minZ = 0.1
    this.camera.maxZ = 1000
    this.camera.fov = Math.PI / 3
    this.camera.attachControl(canvas, true)

    // Add lighting
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), this.scene)
    light.intensity = 1

    // Initialize preloader
    this.preloader = new PanoramaPreloader()

    // Setup keyboard controls for VR emulation
    this.setupVREmulationControls()

    this.init()
  }

  private async init() {
    // Load panorama data
    await this.loadPanoramaData()
    
    // Load initial panorama
    await this.loadPanorama(this.currentPanorama)
    
    // Start preloading connected panoramas
    this.startBackgroundPreloading()
    
    // Setup WebXR
    await this.setupWebXR()
    
    // Setup UI
    this.setupUI()
    
    // Start render loop
    this.engine.runRenderLoop(() => {
      this.scene.render()
    })

    // Handle resize
    window.addEventListener('resize', () => {
      this.engine.resize()
    })
  }

  private async loadPanoramaData(): Promise<void> {
    try {
      // Use Vite's base URL to handle both dev and production paths
      const basePath = import.meta.env.BASE_URL
      const jsonPath = `${basePath}json/Panoramane_Standorte.json`
      const response = await fetch(jsonPath)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      this.panoramaData = await response.json()
    } catch (error) {
      console.error('Failed to load panorama data:', error)
    }
  }

  private async loadPanorama(panoramaId: string): Promise<void> {
    const panoramaInfo = this.panoramaData[panoramaId]
    if (!panoramaInfo) {
      console.error('Panorama not found:', panoramaId)
      return
    }

    // Remove existing photodome and hotspots
    this.clearScene()

    // Choose appropriate image resolution based on device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    const isVR = this.isVRActive
    
    let imageSuffix = '_std.jpg' // Default to standard resolution
    if (isMobile && !isVR) {
      imageSuffix = '_mobile.jpg' // Lower resolution for mobile
    } else if (isVR) {
      imageSuffix = '_hq.jpg' // Highest resolution for VR
    }
    
    const basePath = import.meta.env.BASE_URL
    const imagePath = `${basePath}panos/optimized_natural/${panoramaInfo.image.replace('.jpg', imageSuffix)}`
    
    // Check if image is preloaded
    const preloadedUrl = this.preloader.getPreloadedImage(imagePath)
    const finalImagePath = preloadedUrl || imagePath
    
    try {
      this.currentPhotoDome = new PhotoDome(
        `dome_${panoramaId}`,
        finalImagePath,
        {
          resolution: isVR ? 128 : 64, // Higher resolution for VR
          size: 1000,
          useDirectMapping: false, // Keep original mapping for correct orientation
          halfDomeMode: false
        },
        this.scene
      )

      // Fix for VR headsets - ensure proper material configuration
      if (this.currentPhotoDome.material) {
        // Don't freeze the material immediately in VR to allow proper setup
        if (!this.isVRActive) {
          this.currentPhotoDome.material.freeze()
        }
        
        // Ensure backface culling is disabled for proper inside-out rendering
        this.currentPhotoDome.material.backFaceCulling = false
        
        // Force texture refresh for VR
        if (this.isVRActive && this.currentPhotoDome.material.diffuseTexture) {
          this.currentPhotoDome.material.diffuseTexture.updateSamplingMode(1) // Linear sampling
        }
      }

      // For VR compatibility without changing orientation
      if (this.currentPhotoDome.mesh) {
        // Ensure proper inside-out rendering without flipping faces
        this.currentPhotoDome.mesh.material = this.currentPhotoDome.material
        
        // Only adjust for VR if needed, without affecting desktop orientation
        if (this.isVRActive) {
          this.currentPhotoDome.mesh.flipFaces(false) // Don't flip faces to maintain orientation
          
          // If you need to adjust the starting rotation to match the original view,
          // you can apply a rotation here:
          // this.currentPhotoDome.mesh.rotation.y = 0 // Adjust as needed
        }
      }

      this.currentPanorama = panoramaId

      // Create hotspots for navigation
      this.createHotspots(panoramaInfo.links)

      // Update floorplan
      this.updateFloorplan()

      // Update VR caption if in VR mode
      this.updateVRCaption()

      // Update VR caption in emulation mode if active
      this.updateVRCaptionEmulation()

      // Update info text
      this.updateInfoText()

      // Preload connected panoramas after loading current one
      this.preloadConnectedPanoramas(panoramaId)

    } catch (error) {
      console.error('Failed to load panorama:', panoramaId, error)
    }
  }

  private startBackgroundPreloading(): void {
    if (!this.panoramaData || Object.keys(this.panoramaData).length === 0) {
      return
    }

    // Get all panorama images that are connected to current panorama
    this.preloadConnectedPanoramas(this.currentPanorama)
  }

  private preloadConnectedPanoramas(panoramaId: string): void {
    const currentPanorama = this.panoramaData[panoramaId]
    if (!currentPanorama) return

    // Get connected panorama images
    const connectedImages: string[] = []
    const basePath = import.meta.env.BASE_URL

    // Add images from current panorama's links
    currentPanorama.links.forEach(link => {
      const targetPanorama = this.panoramaData[link.to]
      if (targetPanorama) {
        // Add different quality versions with proper absolute URLs
        const baseImageName = targetPanorama.image.replace('.jpg', '')
        const imagePath = `panos/optimized_natural/`
        
        // Construct complete URLs with origin
        const origin = window.location.origin
        const stdUrl = `${origin}${basePath}${imagePath}${baseImageName}_std.jpg`
        const mobileUrl = `${origin}${basePath}${imagePath}${baseImageName}_mobile.jpg`
        const hrUrl = `${origin}${basePath}${imagePath}${baseImageName}.jpg`
        
        connectedImages.push(stdUrl)
        connectedImages.push(mobileUrl)
        connectedImages.push(hrUrl)
      }
    })

    if (connectedImages.length > 0) {
      this.preloader.startPreloading(
        connectedImages,
        '', // Empty base path since we already have complete URLs
        (progress, total) => {
          // Update UI progress display
          this.updatePreloadProgress(progress, total)
        },
        () => {
          // Preloading complete - update UI
          this.updateInfoText()
        }
      )
    }
  }

  private updatePreloadProgress(progress: number, total: number): void {
    // Update info text to show preload progress
    if (this.infoText) {
      const progressText = total > 0 ? `\nPreloading: ${progress}/${total}` : ''
      this.infoText.text = `\nAktueller Standort:\n${this.getCurrentPanoramaDisplayName()}${progressText}`
    }
  }

  private getCurrentLocationLabel(): string {
    return this.currentLocationLabel
  }

  private updateInfoText(): void {
    if (this.infoText) {
      this.infoText.text = `\nAktueller Standort:\n${this.getCurrentLocationLabel()}`
    }
  }

  private clearScene(): void {
    // Dispose existing photodome
    if (this.currentPhotoDome) {
      this.currentPhotoDome.dispose()
      this.currentPhotoDome = null
    }

    // Clear hotspots
    this.hotspots.forEach(hotspot => hotspot.dispose())
    this.hotspots = []
  }

  private createHotspots(links: PanoramaLink[]): void {
    links.forEach((link, index) => {
      // Create hotspot sphere
      const hotspot = MeshBuilder.CreateSphere(`hotspot_${index}`, { diameter: 8 }, this.scene)
      
      // Position hotspot based on yaw/pitch
      const distance = 200
      const yawRad = Tools.ToRadians(link.yaw) - Math.PI / 2 // Adjust for initial orientation
      const pitchRad = Tools.ToRadians(link.pitch)
      
      const x = distance * Math.cos(pitchRad) * Math.cos(yawRad)
      const y = distance * Math.sin(pitchRad)
      const z = distance * Math.cos(pitchRad) * Math.sin(yawRad)
      
      hotspot.position = new Vector3(x, y, z)

      // Create hotspot material with better visual feedback
      const material = new PBRMaterial(`hotspotMat_${index}`, this.scene)
      material.albedoColor = new Color3(0.8, 0.8, 0.8)
      material.emissiveColor = new Color3(0, 0.5, 1)
      material.metallic = 0
      material.roughness = 0.8
      material.alpha = 0.5
      material.freeze() // Freeze for performance
      hotspot.material = material

      // Add pulsing animation
      Animation.CreateAndStartAnimation(
        `hotspotAnim_${index}`,
        hotspot,
        'scaling',
        30,
        60,
        Vector3.One(),
        new Vector3(1.3, 1.3, 1.3),
        Animation.ANIMATIONLOOPMODE_CYCLE
      )

      // Add interaction with haptic feedback
      hotspot.actionManager = new ActionManager(this.scene)
      
      // On hover - change color for visual feedback
      hotspot.actionManager.registerAction(new ExecuteCodeAction(
        ActionManager.OnPointerOverTrigger,
        () => {
          material.emissiveColor = new Color3(0.3, 0.3, 0.3)
          // Add haptic feedback for VR controllers
          if (this.isVRActive && this.xrHelper?.input) {
            this.xrHelper.input.controllers.forEach(controller => {
              if (controller.motionController) {
                // Try to trigger haptic feedback if available
                try {
                  const hapticComponent = controller.motionController.getComponent('haptic')
                  if (hapticComponent) {
                    (hapticComponent as any).pulse?.(0.3, 100)
                  }
                } catch (e) {
                  // Haptic feedback not available
                }
              }
            })
          }
        }
      ))
      
      hotspot.actionManager.registerAction(new ExecuteCodeAction(
        ActionManager.OnPointerOutTrigger,
        () => {
          material.emissiveColor = new Color3(0.5, 0.1, 0.1)
        }
      ))
      
      // On click/select - navigate and store the label
      hotspot.actionManager.registerAction(new ExecuteCodeAction(
        ActionManager.OnPickTrigger,
        () => {
          // Strong haptic feedback on selection
          if (this.isVRActive && this.xrHelper?.input) {
            this.xrHelper.input.controllers.forEach(controller => {
              if (controller.motionController) {
                try {
                  const hapticComponent = controller.motionController.getComponent('haptic')
                  if (hapticComponent) {
                    (hapticComponent as any).pulse?.(0.8, 200)
                  }
                } catch (e) {
                  // Haptic feedback not available
                }
              }
            })
          }
          
          // Store the label before navigating
          this.currentLocationLabel = link.label
          this.navigateToPanorama(link.to)
        }
      ))

      // Store reference
      hotspot.metadata = { link }
      this.hotspots.push(hotspot)

      // Create label
      this.createHotspotLabel(hotspot, link.label, index)
    })
  }

  private createHotspotLabel(hotspot: Mesh, text: string, index: number): void {
    // Create plane for label
    const labelPlane = MeshBuilder.CreatePlane(`label_${index}`, { size: 80 }, this.scene)
    labelPlane.position = hotspot.position.clone()
    labelPlane.position.y += 10
    labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL

    // Create label texture
    const labelTexture = AdvancedDynamicTexture.CreateForMesh(labelPlane)
    
    const textBlock = new TextBlock()
    textBlock.text = text
    textBlock.color = 'white'
    textBlock.fontSize = 55
    textBlock.fontWeight = 'bold'
    textBlock.fontFamily = 'Arial'
    textBlock.textWrapping = true
    textBlock.resizeToFit = true
    
    const background = new Rectangle()
    background.adaptWidthToChildren = true
    background.adaptHeightToChildren = true
    background.cornerRadius = 10
    background.color = 'rgba(0, 0, 0, 0.8)'
    background.thickness = 0  // Remove visible frame
    background.paddingTopInPixels = 10
    background.paddingBottomInPixels = 10
    background.paddingLeftInPixels = 15
    background.paddingRightInPixels = 15
    background.addControl(textBlock)
    
    labelTexture.addControl(background)
    
    this.hotspots.push(labelPlane)
  }

  private async navigateToPanorama(targetPanorama: string): Promise<void> {
    await this.loadPanorama(targetPanorama)
  }

  private async setupWebXR(): Promise<void> {
    try {
      console.log('🔧 Setting up WebXR for Meta Quest 3...')
      this.xrHelper = await WebXRDefaultExperience.CreateAsync(this.scene, {
        floorMeshes: [],
        disableDefaultUI: false,
        disableTeleportation: false
      })

      console.log('✅ WebXR initialized successfully')

      // Configure for Meta Quest 3
      if (this.xrHelper.baseExperience) {
        console.log('🔧 Configuring WebXR features...')
        
        // Log initial state
        console.log('📊 Initial WebXR state:', {
          hasXRHelper: !!this.xrHelper,
          hasBaseExperience: !!this.xrHelper.baseExperience,
          hasSessionManager: !!this.xrHelper.baseExperience.sessionManager,
          initialVRState: this.isVRActive,
          isInXRSession: this.xrHelper.baseExperience.sessionManager?.inXRSession || false
        })
        
        // Try initial feature setup (may fail, will retry in VR session)
        this.tryInitialFeatureSetup()

        // Setup VR state change handlers with enhanced debugging for Meta Quest 3
        const sessionManager = this.xrHelper.baseExperience.sessionManager
        
        console.log('🔧 Setting up WebXR session detection for Meta Quest 3...')
        
        // Primary WebXR session event listeners (direct WebXR API)
        sessionManager.onXRSessionInit.add((session: XRSession) => {
          const sessionMode = (session as any).mode || 'unknown'
          console.log('🚀 XRSession STARTED:', {
            mode: sessionMode,
            visibilityState: session.visibilityState,
            timestamp: new Date().toLocaleTimeString()
          })
          
          // Validate this is an immersive VR session by checking the session manager
          const isImmersiveVR = this.xrHelper?.baseExperience?.sessionManager?.inXRSession || false
          console.log('🔍 Session validation:', {
            isImmersiveVR,
            sessionManagerExists: !!this.xrHelper?.baseExperience?.sessionManager,
            currentVRState: this.isVRActive
          })
          
          if (isImmersiveVR) {
            console.log('✅ Immersive VR session detected - triggering VR mode')
            this.isVRActive = true
            
            // IMPORTANT: Try to setup WebXR features AFTER session starts
            // This is when features like hand tracking become available
            this.setupVRFeatures()
            
            this.onEnterVR()
            
            // Setup direct session event listeners for reliable state tracking
            session.addEventListener('visibilitychange', () => {
              console.log('👁️  VR session visibility changed:', {
                visibilityState: session.visibilityState,
                timestamp: new Date().toLocaleTimeString()
              })
              // Handle visibility changes inline
              if (session.visibilityState === 'visible' && !this.isVRActive) {
                console.log('👁️  VR session became visible - entering VR mode')
                this.isVRActive = true
                this.onEnterVR()
              } else if (session.visibilityState === 'hidden' && this.isVRActive) {
                console.log('👁️  VR session became hidden - staying in VR mode (backgrounded)')
                // Keep VR mode active even when backgrounded
              }
            })
            
            session.addEventListener('end', () => {
              console.log('🛑 VR session ended - triggering exit VR mode')
              this.isVRActive = false
              this.onExitVR()
            })
          } else {
            console.log('ℹ️  Non-immersive session detected - not entering VR mode')
          }
        })
        
        // Listen for session end
        sessionManager.onXRSessionEnded.add(() => {
          console.log('🛑 XRSession ENDED - ensuring VR mode is disabled')
          if (this.isVRActive) {
            this.isVRActive = false
            this.onExitVR()
          }
        })

        // Backup: Listen for WebXR state changes (secondary detection)
        this.xrHelper.baseExperience.onStateChangedObservable.add((state) => {
          console.log('🔄 WebXR State Change (backup detection):', {
            state,
            currentVRState: this.isVRActive,
            timestamp: new Date().toLocaleTimeString()
          })
          
          // Only use backup detection if primary session detection didn't work
          const hasActiveSession = !!sessionManager.session && this.xrHelper?.baseExperience?.sessionManager?.inXRSession
          
          switch (state) {
            case WebXRState.ENTERING_XR:
              if (!this.isVRActive && hasActiveSession) {
                console.log('🔄 Backup: Entering VR - hiding desktop UI')
                this.isVRActive = true
                this.onEnterVR()
              }
              break
            case WebXRState.EXITING_XR:
              if (this.isVRActive && !hasActiveSession) {
                console.log('🔄 Backup: Exiting VR - showing desktop UI')
                this.isVRActive = false
                this.onExitVR()
              }
              break
            case WebXRState.IN_XR:
              if (!this.isVRActive && hasActiveSession) {
                console.log('🔄 Backup: In VR state - ensuring desktop UI is hidden')
                this.isVRActive = true
                this.onEnterVR()
              }
              break
            case WebXRState.NOT_IN_XR:
              if (this.isVRActive && !hasActiveSession) {
                console.log('🔄 Backup: Not in VR state - ensuring desktop UI is visible')
                this.isVRActive = false
                this.onExitVR()
              }
              break
          }
        })

        // Frame-based validation for Meta Quest 3 compatibility with enhanced debugging
        let frameCount = 0
        this.scene.registerBeforeRender(() => {
          frameCount++
          const session = sessionManager.session
          const inXRSession = this.xrHelper?.baseExperience?.sessionManager?.inXRSession || false
          
          // Enhanced debugging every 120 frames (every 2 seconds at 60fps)
          if (frameCount % 120 === 0) {
            console.log('🔍 Frame check debug (every 2s):', {
              frameCount,
              hasSession: !!session,
              inXRSession,
              isVRActive: this.isVRActive,
              desktopUIVisible: this.desktopUI?.rootContainer?.isVisible,
              sessionVisibilityState: session?.visibilityState,
              timestamp: new Date().toLocaleTimeString()
            })
          }
          
          if (session && inXRSession) {
            // We should be in VR mode
            if (!this.isVRActive) {
              console.log('⚠️  Frame check: VR session active but isVRActive false - correcting')
              this.isVRActive = true
              this.onEnterVR()
            }
            
            // Additional check: ensure desktop UI is really hidden
            if (this.desktopUI?.rootContainer?.isVisible) {
              console.log('🚨 Frame check: Desktop UI visible in VR - forcing hide')
              this.onEnterVR() // Re-run hide logic
            }
          } else {
            // We should NOT be in VR mode
            if (this.isVRActive) {
              console.log('⚠️  Frame check: No VR session but isVRActive true - correcting')
              this.isVRActive = false
              this.onExitVR()
            }
          }
        })

        // Setup controller management
        this.xrHelper.input.onControllerAddedObservable.add((controller) => {
          controller.onMotionControllerInitObservable.add((motionController) => {
            console.log('Controller connected:', motionController.handness)
            
            if (motionController.handness === 'left' && this.isVRActive) {
              // Try to attach floorplan if it exists
              if (this.floorplanContainer) {
                this.attachFloorplanToController(controller)
              }
            }
          })
        })
      }
    } catch (error) {
      console.warn('WebXR not supported or failed to initialize:', error)
    }
  }

  // Setup VR features AFTER VR session starts - when features become available
  private setupVRFeatures(): void {
    if (!this.xrHelper?.baseExperience?.featuresManager) {
      console.log('❌ Features manager not available')
      return
    }

    console.log('🔧 Setting up VR features AFTER session start...')

    // Try hand tracking again now that we're in VR
    try {
      console.log('🖐️  Attempting to enable hand tracking in VR session...')
      
      const handTrackingOptions = {
        disableHandMesh: true,
        useSimpleHandMesh: true,
        handMeshRiggingNeeded: false,
        enableHandMeshes: false
      }
      
      const handTrackingFeature = this.xrHelper.baseExperience.featuresManager.enableFeature(
        'hand-tracking' as any,
        'latest',
        handTrackingOptions
      )
      
      if (handTrackingFeature) {
        console.log('✅ Hand tracking enabled successfully in VR session')
        
        try {
          const handFeature = handTrackingFeature as any
          if (handFeature.onHandAddedObservable) {
            handFeature.onHandAddedObservable.add((hand: any) => {
              console.log('🖐️  Hand added in VR:', hand.handness)
            })
          }
          
          if (handFeature.onHandRemovedObservable) {
            handFeature.onHandRemovedObservable.add((hand: any) => {
              console.log('🖐️  Hand removed in VR:', hand.handness)
            })
          }
        } catch (observableError) {
          console.log('Hand tracking observables not available in VR session:', observableError)
        }
      } else {
        console.log('⚠️  Hand tracking still not available in VR session')
      }
    } catch (handTrackingError) {
      console.log('⚠️  Hand tracking failed in VR session:', handTrackingError)
    }

    // Try pointer selection again now that we're in VR
    try {
      console.log('👆 Attempting to enable pointer selection in VR session (right controller only)...')
      
      const pointerFeature = this.xrHelper.baseExperience.featuresManager.enableFeature(
        'pointer-selection' as any,
        'stable',
        { 
          xrInput: this.xrHelper.input,
          enablePointerSelectionOnAllControllers: false,
          preferredHandness: 'right'
        }
      )
      
      if (pointerFeature) {
        console.log('✅ Pointer selection enabled successfully in VR session (right controller only)')
      } else {
        console.log('⚠️  Pointer selection still not available in VR session')
      }
    } catch (pointerError) {
      console.log('⚠️  Pointer selection failed in VR session:', pointerError)
    }

    console.log('🔧 VR features setup complete')
  }

  // Try initial feature setup (before VR session) - may fail, will retry later
  private tryInitialFeatureSetup(): void {
    console.log('🔄 Attempting initial feature setup (pre-VR session)...')
    
    // Try hand tracking (may not be available yet)
    try {
      console.log('Attempting to enable hand tracking...')
      
      if ('XRSession' in window && navigator.xr && 'requestSession' in navigator.xr) {
        const handTrackingOptions = {
          disableHandMesh: true,
          useSimpleHandMesh: true,
          handMeshRiggingNeeded: false,
          enableHandMeshes: false
        }
        
        const handTrackingFeature = this.xrHelper?.baseExperience?.featuresManager?.enableFeature(
          'hand-tracking' as any,
          'latest',
          handTrackingOptions
        )
        
        if (handTrackingFeature) {
          console.log('✅ Hand tracking enabled in initial setup')
        } else {
          console.log('ℹ️  Hand tracking not available in initial setup - will retry in VR session')
        }
      } else {
        console.log('ℹ️  WebXR hand tracking not supported in this browser/device')
      }
    } catch (handTrackingError) {
      const errorMessage = handTrackingError instanceof Error ? handTrackingError.message : String(handTrackingError)
      console.log('ℹ️  Hand tracking failed in initial setup (expected):', errorMessage)
      console.log('Will retry when VR session starts')
    }

    // Try pointer selection (may not be available yet)
    try {
      console.log('Attempting to enable pointer selection (right controller only)...')
      
      const pointerFeature = this.xrHelper?.baseExperience?.featuresManager?.enableFeature(
        'pointer-selection' as any,
        'stable',
        { 
          xrInput: this.xrHelper?.input,
          enablePointerSelectionOnAllControllers: false,
          preferredHandness: 'right'
        }
      )
      
      if (pointerFeature) {
        console.log('✅ Pointer selection enabled in initial setup (right controller only)')
      } else {
        console.log('ℹ️  Pointer selection not available in initial setup - will retry in VR session')
      }
    } catch (pointerError) {
      const errorMessage = pointerError instanceof Error ? pointerError.message : String(pointerError)
      console.log('ℹ️  Pointer selection failed in initial setup (expected):', errorMessage)
      console.log('Will retry when VR session starts')
    }

    console.log('🔄 Initial feature setup complete - errors are expected and will be retried')
  }

  private onEnterVR(): void {
    console.log('🥽 ENTERING VR MODE - Starting UI transition')
    console.log('🖥️  Desktop UI state check:', {
      desktopUIExists: !!this.desktopUI,
      rootContainerExists: !!this.desktopUI?.rootContainer,
      rootContainerVisible: this.desktopUI?.rootContainer?.isVisible,
      rootContainerAlpha: this.desktopUI?.rootContainer?.alpha
    })
    
    // Hide entire desktop UI when in VR mode with improved Meta Quest 3 compatibility
    if (this.desktopUI && this.desktopUI.rootContainer) {
      console.log('🔄 Applying desktop UI hiding methods...')
      
      // Method 1: Hide the container
      const wasVisible = this.desktopUI.rootContainer.isVisible
      this.desktopUI.rootContainer.isVisible = false
      this.desktopUI.rootContainer.alpha = 0
      console.log(`   ✓ Container visibility: ${wasVisible} → false`)
      
      // Method 2: Move UI plane out of view and disable depth testing
      const uiPlane = this.desktopUI.getScene()?.meshes.find(m => m.name === 'UI_PLANE')
      if (uiPlane) {
        const wasPlaneVisible = uiPlane.isVisible
        uiPlane.isVisible = false
        uiPlane.setEnabled(false)
        console.log(`   ✓ UI Plane visibility: ${wasPlaneVisible} → false`)
        
        // Set material properties to ensure it doesn't render
        if (uiPlane.material) {
          uiPlane.material.alpha = 0
          uiPlane.material.disableDepthWrite = true
          uiPlane.material.needDepthPrePass = false
          console.log('   ✓ UI Plane material properties updated')
        }
        
        // Move far away as additional safety
        uiPlane.position.z = -1000
        console.log('   ✓ UI Plane moved to z=-1000')
      } else {
        console.log('   ⚠️  UI Plane not found')
      }
      
      // Method 3: Disable all UI interactions
      this.desktopUI.rootContainer.isPointerBlocker = false
      this.desktopUI.rootContainer.isHitTestVisible = false
      console.log('   ✓ UI interactions disabled')
      
      // Final verification
      console.log('🔍 Final desktop UI state:', {
        rootContainerVisible: this.desktopUI.rootContainer.isVisible,
        rootContainerAlpha: this.desktopUI.rootContainer.alpha,
        isPointerBlocker: this.desktopUI.rootContainer.isPointerBlocker
      })
      
    } else {
      console.error('❌ Cannot hide desktop UI - desktopUI or rootContainer is null!')
    }
    
    // Setup VR caption
    this.setupVRCaption()
    
    // Force photodome refresh for VR
    if (this.currentPhotoDome) {
      // Unfreeze material to allow updates
      if (this.currentPhotoDome.material && this.currentPhotoDome.material.isFrozen) {
        this.currentPhotoDome.material.unfreeze()
      }
      
      // Ensure proper material settings for VR
      if (this.currentPhotoDome.material) {
        this.currentPhotoDome.material.backFaceCulling = false
        
        // Force texture update
        if (this.currentPhotoDome.material.diffuseTexture) {
          this.currentPhotoDome.material.diffuseTexture.updateSamplingMode(1)
          // Force texture to reload
          this.currentPhotoDome.material.diffuseTexture.getInternalTexture()?.generateMipMaps
        }
      }
      
      // Ensure mesh is properly configured for VR without affecting orientation
      if (this.currentPhotoDome.mesh) {
        // Don't flip faces to maintain correct orientation
        this.currentPhotoDome.mesh.flipFaces(false)
        
        // Ensure the material is properly applied
        this.currentPhotoDome.mesh.material = this.currentPhotoDome.material
      }
    }
    
    // Setup floorplan UI
    this.setupFloorplanUI()
    
    // Force a scene refresh
    this.scene.render()
    
    console.log('🥽 VR mode setup complete - desktop UI should be hidden')
  }

  private onExitVR(): void {
    console.log('🖥️  EXITING VR MODE - Restoring desktop UI')
    this.disposeFloorplanUI()
    this.disposeVRCaption()
    
    // Restore desktop UI when exiting VR mode with improved reliability
    if (this.desktopUI && this.desktopUI.rootContainer) {
      console.log('🔄 Restoring desktop UI visibility...')
      
      // Method 1: Restore container visibility
      this.desktopUI.rootContainer.isVisible = true
      this.desktopUI.rootContainer.alpha = 1
      console.log('   ✓ Container visibility restored to true')
      
      // Method 2: Restore UI plane if it exists
      const uiPlane = this.desktopUI.getScene()?.meshes.find(m => m.name === 'UI_PLANE')
      if (uiPlane) {
        uiPlane.isVisible = true
        uiPlane.setEnabled(true)
        console.log('   ✓ UI Plane visibility restored')
        
        // Restore material properties
        if (uiPlane.material) {
          uiPlane.material.alpha = 1
          uiPlane.material.disableDepthWrite = false
          uiPlane.material.needDepthPrePass = true
          console.log('   ✓ UI Plane material properties restored')
        }
        
        // Reset position
        uiPlane.position.z = 0
        console.log('   ✓ UI Plane position reset to z=0')
      } else {
        console.log('   ⚠️  UI Plane not found during restoration')
      }
      
      // Method 3: Restore UI interactions
      this.desktopUI.rootContainer.isPointerBlocker = true
      this.desktopUI.rootContainer.isHitTestVisible = true
      console.log('   ✓ UI interactions restored')
      
      // Final verification
      console.log('🔍 Final desktop UI restore state:', {
        rootContainerVisible: this.desktopUI.rootContainer.isVisible,
        rootContainerAlpha: this.desktopUI.rootContainer.alpha,
        isPointerBlocker: this.desktopUI.rootContainer.isPointerBlocker
      })
    } else {
      console.error('❌ Cannot restore desktop UI - desktopUI or rootContainer is null!')
    }
    
    // Re-optimize materials for desktop
    if (this.currentPhotoDome?.material && !this.currentPhotoDome.material.isFrozen) {
      this.currentPhotoDome.material.freeze()
    }
    
    console.log('🖥️  Desktop UI restoration complete')
  }

  private setupUI(): void {
    // Create desktop UI
    this.desktopUI = AdvancedDynamicTexture.CreateFullscreenUI('UI')
    
    // VR Enter button
    this.enterVRButton = Button.CreateSimpleButton('enterVR', 'Enter VR Mode')
    this.enterVRButton.widthInPixels = 200
    this.enterVRButton.heightInPixels = 60
    this.enterVRButton.color = 'white'
    this.enterVRButton.cornerRadius = 10
    this.enterVRButton.background = 'rgba(0, 100, 200, 0.8)'
    this.enterVRButton.top = '-200px'
    this.enterVRButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM
    
    this.enterVRButton.onPointerClickObservable.add(() => {
      if (this.xrHelper?.baseExperience) {
        this.xrHelper.baseExperience.enterXRAsync('immersive-vr', 'local-floor')
      }
    })
    
    // Only show VR button if WebXR is supported
    if (this.xrHelper) {
      this.desktopUI.addControl(this.enterVRButton)
    }

    // Add panorama info panel
    const infoPanel = new Rectangle('infoPanel')
    infoPanel.width = '300px'
    infoPanel.height = '120px'
    infoPanel.cornerRadius = 10
    infoPanel.color = 'white'
    infoPanel.thickness = 2
    infoPanel.background = 'rgba(0, 0, 0, 0.7)'
    infoPanel.top = '20px'
    infoPanel.left = '20px'
    infoPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
    infoPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    this.desktopUI.addControl(infoPanel)
    
    const infoText = new TextBlock()
    infoText.text = `\nAktueller Standort:\n${this.getCurrentPanoramaDisplayName()}`
    infoText.color = 'white'
    infoText.fontSize = 16
    infoText.textWrapping = true
    infoText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    infoPanel.addControl(infoText)

    // Store reference to update later
    this.infoText = infoText
  }

  private getCurrentPanoramaDisplayName(): string {
    const parts = this.currentPanorama.split('_')
    return parts.slice(1).join(' ').replace(/([A-Z])/g, ' $1').trim()
  }

  private setupFloorplanUI(): void {
    if (!this.isVRActive) return

    console.log('Setting up floorplan UI')

    // Create floorplan container
    this.floorplanContainer = new TransformNode('floorplanContainer', this.scene)
    
    // Position floorplan in VR space
    if (this.isVREmulationMode) {
      // In emulation mode, position floorplan to the left side where it's visible
      this.floorplanContainer.position = new Vector3(-1.5, 0, -1)
      this.floorplanContainer.rotation = new Vector3(0, Math.PI / 4, 0)
    } else {
      // In real VR, it will be attached to controller
      this.floorplanContainer.position = new Vector3(0, 0, 0)
    }
    
    // Create floorplan plane
    const floorplanPlane = MeshBuilder.CreatePlane('floorplan', { width: 0.3, height: 0.2 }, this.scene)
    floorplanPlane.parent = this.floorplanContainer
    
    // Fix flipped orientation by rotating the plane
    floorplanPlane.rotation.y = Math.PI // 180 degree rotation to unflip
    
    if (!this.isVREmulationMode) {
      // Only offset when attached to controller
      floorplanPlane.position = new Vector3(-0.2, 0, 0.1)
      // Combine the flip correction with the controller rotation
      floorplanPlane.rotation = new Vector3(0, Math.PI + Math.PI / 6, 0)
    }

    // Load appropriate floorplan image
    const currentFloor = this.panoramaData[this.currentPanorama]?.floor || 'EG'
    this.selectedFloor = currentFloor // Initialize selected floor
    const basePath = import.meta.env.BASE_URL
    const floorplanPath = `${basePath}ui/floorplan_${this.selectedFloor}.png`
    
    console.log('Loading floorplan:', floorplanPath)
    
    this.floorplanUI = AdvancedDynamicTexture.CreateForMesh(floorplanPlane)
    
    const background = new Rectangle()
    background.name = 'background' // Add name for easy reference
    background.background = 'rgba(255, 255, 255, 0.9)'
    background.cornerRadius = 10
    this.floorplanUI.addControl(background)
    
    this.floorplanImage = new Image('floorplan', floorplanPath)
    this.floorplanImage.stretch = Image.STRETCH_UNIFORM
    background.addControl(this.floorplanImage)

    // Add floor switching buttons
    this.addFloorSwitchButtons(background)

    // Add interactive position markers for all floors (with blending)
    this.addFloorplanPositionMarkers(background, this.selectedFloor)

    // Setup continuous update for view direction
    this.setupFloorplanUpdateObserver()

    // Only try to attach to controllers in real VR mode
    if (!this.isVREmulationMode && this.xrHelper?.input.controllers) {
      this.xrHelper.input.controllers.forEach(controller => {
        if (controller.motionController?.handness === 'left') {
          console.log('Found existing left controller, attaching floorplan')
          this.attachFloorplanToController(controller)
        }
      })
    }

    // Add current position indicator
    this.updateFloorplan()
  }

  private attachFloorplanToController(controller: any): void {
    if (!this.floorplanContainer || !this.isVRActive) {
      // If floorplan isn't ready yet, set up to attach when it is
      console.log('Floorplan not ready, setting up delayed attachment')
      return
    }

    console.log('Attaching floorplan to left controller')
    // Directly attach floorplan to controller
    if (controller.grip) {
      this.floorplanContainer.parent = controller.grip
    } else if (controller.pointer) {
      this.floorplanContainer.parent = controller.pointer
    }
  }

  private updateFloorplan(): void {
    if (!this.floorplanUI || (!this.isVRActive && !this.isVREmulationMode)) return

    const currentData = this.panoramaData[this.currentPanorama]
    if (!currentData) return

    // Update position indicator on floorplan
    // This would require more detailed implementation based on the map coordinates
    console.log('Updating floorplan position:', currentData.map)
    
    // Update current location marker and view direction if they exist
    this.updateFloorplanMarkers()
  }

  private addFloorSwitchButtons(background: Rectangle): void {
    console.log('Adding floor switch buttons')
    
    const floors = ['UG', 'EG', 'OG', 'DA']
    const buttonWidth = 50  // Increased width for better visibility
    const buttonHeight = 30 // Increased height for better visibility
    const spacing = 8
    const startX = -((floors.length * buttonWidth + (floors.length - 1) * spacing) / 2)
    
    floors.forEach((floor, index) => {
      const button = new Button(`floor_button_${floor}`)
      button.widthInPixels = buttonWidth
      button.heightInPixels = buttonHeight
      button.cornerRadius = 8
      button.thickness = 3
      
      // Style based on whether this is the selected floor
      if (floor === this.selectedFloor) {
        button.background = 'rgba(0, 150, 255, 0.95)' // Brighter blue for selected
        button.color = 'white'
      } else {
        button.background = 'rgba(80, 80, 80, 0.9)' // Darker gray for better contrast
        button.color = 'white'
      }
      
      // Position buttons at the top of the floorplan, but within visible area
      button.leftInPixels = startX + (index * (buttonWidth + spacing))
      button.topInPixels = -60 // Position closer to ensure visibility
      button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
      button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
      
      // Add text label
      const label = new TextBlock()
      label.text = floor
      label.color = button.color
      label.fontSize = '14px' // Increased font size
      label.fontWeight = 'bold'
      button.addControl(label)
      
      // Add click handler
      button.onPointerClickObservable.add(() => {
        console.log(`Floor button ${floor} clicked`)
        this.switchToFloor(floor)
      })
      
      background.addControl(button)
      this.floorSwitchButtons.push(button)
      
      console.log(`Added floor button for ${floor} at position (${button.leftInPixels}, ${button.topInPixels})`)
    })
    
    console.log(`Added ${floors.length} floor switch buttons`)
  }

  private switchToFloor(floor: string): void {
    console.log(`Switching floorplan to floor: ${floor}`)
    
    if (this.selectedFloor === floor) {
      console.log(`Already viewing floor ${floor}`)
      return
    }
    
    this.selectedFloor = floor
    
    // Update floorplan image
    if (this.floorplanImage) {
      const basePath = import.meta.env.BASE_URL
      const floorplanPath = `${basePath}ui/floorplan_${floor}.png`
      this.floorplanImage.source = floorplanPath
      console.log(`Updated floorplan image to: ${floorplanPath}`)
    }
    
    // Update button styling
    this.updateFloorSwitchButtons()
    
    // Update markers with blending for the new floor
    const background = this.floorplanUI?.getControlByName('background') as Rectangle
    if (background) {
      this.addFloorplanPositionMarkersWithBlending(background, floor)
    }
  }

  private updateFloorSwitchButtons(): void {
    this.floorSwitchButtons.forEach(control => {
      const button = control as Button
      const buttonName = button.name || ''
      const floor = buttonName.replace('floor_button_', '')
      
      if (floor === this.selectedFloor) {
        button.background = 'rgba(0, 150, 255, 0.95)' // Brighter blue for selected
        button.color = 'white'
        // Update text color if button has children
        if (button.children && button.children.length > 0) {
          const label = button.children[0] as TextBlock
          if (label) label.color = 'white'
        }
      } else {
        button.background = 'rgba(80, 80, 80, 0.9)' // Darker gray for better contrast
        button.color = 'white'
        // Update text color if button has children
        if (button.children && button.children.length > 0) {
          const label = button.children[0] as TextBlock
          if (label) label.color = 'white'
        }
      }
    })
  }

  private addFloorplanPositionMarkers(background: Rectangle, currentFloor: string): void {
    // Use the new blending method
    this.addFloorplanPositionMarkersWithBlending(background, currentFloor)
  }

  private addFloorplanPositionMarkersWithBlending(background: Rectangle, selectedFloor: string): void {
    console.log('Adding interactive position markers with floor blending for selected floor:', selectedFloor)
    
    // Clear existing markers
    this.clearFloorplanMarkers()
    
    // Get ALL panoramas (not just current floor) for blending
    const allPanoramas = Object.entries(this.panoramaData)
    
    console.log(`Found ${allPanoramas.length} total panoramas across all floors`)
    
    // Add position markers for each panorama with blending
    allPanoramas.forEach(([panoramaId, data]) => {
      this.createFloorplanPositionMarkerWithBlending(background, panoramaId, data, selectedFloor)
    })

    // Add view direction indicator for current location
    this.createViewDirectionIndicator(background)
    
    console.log('Floorplan markers setup complete with floor blending')
  }

  private createFloorplanPositionMarkerWithBlending(background: Rectangle, panoramaId: string, data: PanoramaData, selectedFloor: string): void {
    // Create clickable position marker
    const marker = new Button(`marker_${panoramaId}`)
    
    // Determine marker properties based on floor relationship
    const isCurrent = panoramaId === this.currentPanorama
    const isSelectedFloor = data.floor === selectedFloor
    
    if (isCurrent) {
      // Current location marker - always prominent
      marker.widthInPixels = 20
      marker.heightInPixels = 20
      marker.cornerRadius = 10
      marker.thickness = 3
      marker.background = 'rgba(255, 0, 0, 0.9)' // Bright red for current location
      marker.color = 'rgba(255, 255, 0, 1)' // Yellow border
      // Store reference for updating
      this.floorplanCurrentLocationMarker = marker
    } else if (isSelectedFloor) {
      // Markers on selected floor - normal visibility
      marker.widthInPixels = 14
      marker.heightInPixels = 14
      marker.cornerRadius = 7
      marker.thickness = 2
      marker.background = 'rgba(0, 150, 255, 0.8)' // Blue for same floor
      marker.color = 'rgba(255, 255, 255, 0.9)' // White border
    } else {
      // Markers on other floors - dimmed/blended
      marker.widthInPixels = 10
      marker.heightInPixels = 10
      marker.cornerRadius = 5
      marker.thickness = 1
      marker.background = 'rgba(150, 150, 150, 0.4)' // Dimmed gray for other floors
      marker.color = 'rgba(200, 200, 200, 0.5)' // Light gray border
    }
    
    // Add hover effects for better interaction (only for clickable markers)
    if (isCurrent || isSelectedFloor) {
      marker.pointerEnterAnimation = () => {
        marker.scaleX = 1.2
        marker.scaleY = 1.2
      }
      marker.pointerOutAnimation = () => {
        marker.scaleX = 1.0
        marker.scaleY = 1.0
      }
    }
    
    // Apply aspect ratio correction to coordinates
    const adjustedCoords = this.adjustCoordinatesForAspectRatio(data.map.x, data.map.y)
    
    // Use percentage positioning for better scaling
    marker.left = `${(adjustedCoords.x * 100)}%`
    marker.top = `${(adjustedCoords.y * 100)}%`
    marker.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
    marker.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    
    // Add click handler for navigation
    marker.onPointerClickObservable.add(() => {
      if (!isCurrent) {
        console.log(`Navigating to ${data.name} on floor ${data.floor} via floorplan click`)
        this.navigateToPanorama(panoramaId)
      } else {
        console.log(`Already at ${data.name}`)
      }
    })
    
    // Add to background and store reference
    background.addControl(marker)
    this.floorplanPositionMarkers.push(marker)
    
    console.log(`Added position marker for ${data.name} (${data.floor}):`)
    console.log(`  - Is current location: ${isCurrent}`)
    console.log(`  - Is on selected floor: ${isSelectedFloor}`)
    console.log(`  - Floor: ${data.floor} (selected: ${selectedFloor})`)
  }  private adjustCoordinatesForAspectRatio(x: number, y: number): { x: number; y: number } {
    // Floorplan images are 1000x751 pixels (aspect ratio ~1.33:1)
    const floorplanImageWidth = 1000
    const floorplanImageHeight = 751
    const aspectRatio = floorplanImageWidth / floorplanImageHeight // ~1.33
    
    // The container is square, so the image will be letterboxed
    // Since width > height, the image will be letterboxed (black bars on top/bottom)
    let adjustedX = x
    let adjustedY = y
    
    const containerAspectRatio = 1 // Square container
    if (aspectRatio > containerAspectRatio) {
      // Image is wider - letterboxed (black bars top/bottom)
      const imageHeightInContainer = 1.0 / aspectRatio // Height ratio in container
      const letterboxOffset = (1.0 - imageHeightInContainer) / 2
      adjustedY = letterboxOffset + (y * imageHeightInContainer)
    }
    
    return { x: adjustedX, y: adjustedY }
  }

  private createViewDirectionIndicator(background: Rectangle): void {
    const currentData = this.panoramaData[this.currentPanorama]
    if (!currentData) return
    
    // Apply aspect ratio correction to view direction coordinates
    const adjustedCoords = this.adjustCoordinatesForAspectRatio(currentData.map.x, currentData.map.y)
    
    // Create arrow or line indicating view direction
    const directionIndicator = new Rectangle('view_direction')
    directionIndicator.widthInPixels = 3
    directionIndicator.heightInPixels = 25
    directionIndicator.background = 'rgba(255, 255, 0, 0.9)' // Yellow arrow
    directionIndicator.thickness = 0
    
    // Use percentage positioning for consistent scaling
    directionIndicator.left = `${(adjustedCoords.x * 100)}%`
    directionIndicator.top = `${(adjustedCoords.y * 100 - 8)}%` // Offset upward from marker
    directionIndicator.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
    directionIndicator.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    
    // Rotate based on current camera direction (will be updated in updateFloorplanMarkers)
    this.updateViewDirection(directionIndicator)
    
    background.addControl(directionIndicator)
    this.floorplanViewDirectionIndicator = directionIndicator
    
    console.log('Added view direction indicator with aspect ratio correction')
  }

  private updateFloorplanMarkers(): void {
    // When the current location changes, we need to recreate all markers
    // to update their styling (current vs non-current)
    if (!this.floorplanUI) return
    
    const currentData = this.panoramaData[this.currentPanorama]
    if (!currentData) return
    
    // Get the background rectangle that contains the markers
    const background = this.floorplanUI.getControlByName('background') as Rectangle
    if (!background) {
      console.warn('Floorplan background not found')
      return
    }
    
    // Recreate all markers with updated styling using the currently selected floor
    this.addFloorplanPositionMarkersWithBlending(background, this.selectedFloor)
    
    // Update view direction indicator position if it exists
    if (this.floorplanViewDirectionIndicator) {
      const adjustedCoords = this.adjustCoordinatesForAspectRatio(currentData.map.x, currentData.map.y)
      this.floorplanViewDirectionIndicator.left = `${(adjustedCoords.x * 100)}%`
      this.floorplanViewDirectionIndicator.top = `${(adjustedCoords.y * 100 - 8)}%`
      this.updateViewDirection(this.floorplanViewDirectionIndicator)
    }
    
    console.log(`Updated floorplan markers for current location: ${currentData.name} on selected floor: ${this.selectedFloor}`)
  }

  private updateViewDirection(indicator: Control): void {
    // Get camera rotation to determine view direction
    let camera = this.scene.activeCamera
    if (this.xrHelper && this.xrHelper.baseExperience.camera) {
      camera = this.xrHelper.baseExperience.camera
    }
    if (!camera) camera = this.camera
    if (!camera) return
    
    // Convert camera Y rotation to degrees and apply to indicator
    // For UniversalCamera, use the camera's rotation property
    let cameraYRotation = 0
    if (camera instanceof UniversalCamera) {
      cameraYRotation = camera.rotation.y * (180 / Math.PI)
    } else {
      // For WebXR camera, get rotation from transform
      const forward = camera.getForwardRay().direction
      cameraYRotation = Math.atan2(forward.x, forward.z) * (180 / Math.PI)
    }
    
    indicator.transformCenterX = 0.5
    indicator.transformCenterY = 1 // Rotate around bottom of the indicator
    indicator.rotation = cameraYRotation
  }

  private clearFloorplanMarkers(): void {
    // Clear existing position markers
    this.floorplanPositionMarkers.forEach(marker => {
      if (marker.parent) {
        marker.parent.removeControl(marker)
      }
      marker.dispose()
    })
    this.floorplanPositionMarkers = []
    
    // Clear floor switch buttons
    this.floorSwitchButtons.forEach(button => {
      if (button.parent) {
        button.parent.removeControl(button)
      }
      button.dispose()
    })
    this.floorSwitchButtons = []
    
    // Clear current location marker
    if (this.floorplanCurrentLocationMarker) {
      if (this.floorplanCurrentLocationMarker.parent) {
        this.floorplanCurrentLocationMarker.parent.removeControl(this.floorplanCurrentLocationMarker)
      }
      this.floorplanCurrentLocationMarker.dispose()
      this.floorplanCurrentLocationMarker = null
    }
    
    // Clear view direction indicator
    if (this.floorplanViewDirectionIndicator) {
      if (this.floorplanViewDirectionIndicator.parent) {
        this.floorplanViewDirectionIndicator.parent.removeControl(this.floorplanViewDirectionIndicator)
      }
      this.floorplanViewDirectionIndicator.dispose()
      this.floorplanViewDirectionIndicator = null
    }
  }

  private setupFloorplanUpdateObserver(): void {
    // Remove existing observer if any
    if (this.floorplanUpdateObserver) {
      this.scene.unregisterBeforeRender(this.floorplanUpdateObserver)
      this.floorplanUpdateObserver = null
    }
    
    // Setup continuous update for view direction indicator
    this.floorplanUpdateObserver = this.scene.registerBeforeRender(() => {
      if (this.floorplanViewDirectionIndicator) {
        this.updateViewDirection(this.floorplanViewDirectionIndicator)
      }
    })
    
    console.log('Setup floorplan continuous update observer')
  }

  private disposeFloorplanUI(): void {
    // Clear markers first
    this.clearFloorplanMarkers()
    
    // Remove update observer
    if (this.floorplanUpdateObserver) {
      this.scene.unregisterBeforeRender(this.floorplanUpdateObserver)
      this.floorplanUpdateObserver = null
    }
    
    if (this.floorplanUI) {
      this.floorplanUI.dispose()
      this.floorplanUI = null
    }
    if (this.floorplanContainer) {
      this.floorplanContainer.dispose()
      this.floorplanContainer = null
    }
  }
  
  private setupVRCaption(): void {
    if (!this.isVRActive) return

    // Create VR caption container
    this.vrCaptionContainer = new TransformNode('vrCaptionContainer', this.scene)
    
    // Position the caption in front of the user (will be updated each frame)
    this.vrCaptionContainer.position = new Vector3(0, 0.5, -2)
    
    // Create caption plane - optimized for Meta Quest 3
    const captionPlane = MeshBuilder.CreatePlane('vrCaption', { width: 1.0, height: 0.4 }, this.scene)
    captionPlane.parent = this.vrCaptionContainer
    captionPlane.billboardMode = Mesh.BILLBOARDMODE_ALL // Always face the user
    
    // Make plane non-pickable for click-through functionality
    captionPlane.isPickable = false
    captionPlane.isBlocker = false
    
    // Create caption UI with high resolution for Meta Quest 3
    this.vrCaptionUI = AdvancedDynamicTexture.CreateForMesh(captionPlane, 1024, 512)
    
    // Make the entire UI non-interactive for click-through
    this.vrCaptionUI.isForeground = false
    this.vrCaptionUI.rootContainer.isPointerBlocker = false
    this.vrCaptionUI.rootContainer.isHitTestVisible = false
    
    // Create text directly without background
    const captionText = new TextBlock('vrCaptionText')
    captionText.text = `Aktueller Standort:\n\n${this.getCurrentLocationLabel()}`
    captionText.color = 'white'
    captionText.fontSize = 32
    captionText.fontFamily = 'Arial'
    captionText.fontWeight = 'bold'
    captionText.textWrapping = true
    captionText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    captionText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER

    // Make text non-interactive for click-through
    captionText.isPointerBlocker = false
    captionText.isHitTestVisible = false

    // Add text directly to UI (no background container)
    this.vrCaptionUI.addControl(captionText)
    
    // Register update function to keep caption in front of camera
    this.vrCaptionRenderObserver = this.scene.registerBeforeRender(() => {
      this.updateVRCaptionPosition()
    })
  }

  private updateVRCaptionPosition(): void {
    if (!this.vrCaptionContainer || !this.isVRActive) return
    
    // Use WebXR camera when available for better Meta Quest 3 tracking
    let camera = this.scene.activeCamera
    if (this.xrHelper && this.xrHelper.baseExperience.camera) {
      camera = this.xrHelper.baseExperience.camera
    }
    if (!camera) camera = this.camera
    if (!camera) return
    
    // Calculate position in front of the camera
    const cameraDirection = camera.getForwardRay().direction
    const cameraPosition = camera.position
    
    // Position the caption closer for better readability in Meta Quest 3
    const distance = 1.5
    const heightOffset = 0.5
    
    this.vrCaptionContainer.position.x = cameraPosition.x + cameraDirection.x * distance
    this.vrCaptionContainer.position.y = cameraPosition.y + cameraDirection.y * distance + heightOffset
    this.vrCaptionContainer.position.z = cameraPosition.z + cameraDirection.z * distance
  }

  private disposeVRCaption(): void {
    // Remove render observer
    if (this.vrCaptionRenderObserver) {
      this.scene.unregisterBeforeRender(this.vrCaptionRenderObserver)
      this.vrCaptionRenderObserver = null
    }
    
    if (this.vrCaptionUI) {
      this.vrCaptionUI.dispose()
      this.vrCaptionUI = null
    }
    if (this.vrCaptionContainer) {
      this.vrCaptionContainer.dispose()
      this.vrCaptionContainer = null
    }
  }

  private updateVRCaption(): void {
    if (!this.isVRActive) return

    // Dispose existing VR caption first
    this.disposeVRCaption()

    // Create VR caption container
    this.vrCaptionContainer = new TransformNode('vrCaptionContainer', this.scene)
    
    // Position the caption in front of the user (will be updated each frame)
    this.vrCaptionContainer.position = new Vector3(0, 0.5, -2)
    
    // Create caption plane - optimized for Meta Quest 3
    const captionPlane = MeshBuilder.CreatePlane('vrCaption', { width: 1.0, height: 0.4 }, this.scene)
    captionPlane.parent = this.vrCaptionContainer
    captionPlane.billboardMode = Mesh.BILLBOARDMODE_ALL // Always face the user
    
    // Make plane non-pickable for click-through functionality
    captionPlane.isPickable = false
    captionPlane.isBlocker = false
    
    // Create caption UI with high resolution for Meta Quest 3
    this.vrCaptionUI = AdvancedDynamicTexture.CreateForMesh(captionPlane, 1024, 512)
    
    // Make the entire UI non-interactive for click-through
    this.vrCaptionUI.isForeground = false
    this.vrCaptionUI.rootContainer.isPointerBlocker = false
    this.vrCaptionUI.rootContainer.isHitTestVisible = false
    
    // Create text directly without background
    const captionText = new TextBlock('vrCaptionText')
    captionText.text = `Aktueller Standort:\n\n${this.getCurrentLocationLabel()}`
    captionText.color = 'white'
    captionText.fontSize = 32
    captionText.fontFamily = 'Arial'
    captionText.fontWeight = 'bold'
    captionText.textWrapping = true
    captionText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    captionText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
    
    // Make text non-interactive for click-through
    captionText.isPointerBlocker = false
    captionText.isHitTestVisible = false
    
    // Add text directly to UI (no background container)
    this.vrCaptionUI.addControl(captionText)
    
    // Register update function to keep caption in front of camera
    this.vrCaptionRenderObserver = this.scene.registerBeforeRender(() => {
      this.updateVRCaptionPosition()
    })
  }

  private setupVREmulationControls(): void {
    // Add keyboard event listener for VR emulation
    window.addEventListener('keydown', (event) => {
      if (event.key === 'v' || event.key === 'V') {
        this.toggleVREmulation()
      }
    })

    console.log('VR Emulation Controls:')
    console.log('Press "V" key to toggle VR emulation mode')
  }

  private toggleVREmulation(): void {
    this.isVREmulationMode = !this.isVREmulationMode
    
    if (this.isVREmulationMode) {
      console.log('🥽 VR Emulation Mode: ON')
      this.enterVREmulation()
    } else {
      console.log('🖥️ VR Emulation Mode: OFF')
      this.exitVREmulation()
    }
  }

  private enterVREmulation(): void {
    console.log('🥽 Entering VR emulation mode (UI only - no WebXR)')
    
    // IMPORTANT: Only simulate VR UI, don't trigger actual WebXR
    this.isVREmulationMode = true
    // Note: isVRActive stays false to prevent WebXR feature setup
    
    // Hide desktop UI for emulation
    if (this.desktopUI && this.desktopUI.rootContainer) {
      console.log('🔄 Hiding desktop UI for emulation...')
      this.desktopUI.rootContainer.isVisible = false
      this.desktopUI.rootContainer.alpha = 0
    }
    
    // Setup VR-specific UI for emulation (bypass isVRActive check)
    this.setupVRCaptionEmulation()
    this.setupFloorplanUIEmulation()
    
    // Show emulation info
    this.showEmulationInfo()
    
    // VR-style material setup for visual testing
    if (this.currentPhotoDome) {
      if (this.currentPhotoDome.material && this.currentPhotoDome.material.isFrozen) {
        this.currentPhotoDome.material.unfreeze()
      }
      
      // VR-specific material setup
      if (this.currentPhotoDome.material) {
        this.currentPhotoDome.material.backFaceCulling = false
        this.currentPhotoDome.material.maxSimultaneousLights = 2
      }
      
      if (this.currentPhotoDome.mesh) {
        this.currentPhotoDome.mesh.flipFaces(false)
        this.currentPhotoDome.mesh.material = this.currentPhotoDome.material
      }
    }
    
    this.scene.render()
    console.log('🥽 VR emulation UI active (no WebXR session)')
  }

  private exitVREmulation(): void {
    console.log('🖥️  Exiting VR emulation mode (restoring desktop UI)')
    
    // Reset emulation state
    this.isVREmulationMode = false
    // Note: isVRActive should already be false
    
    // Restore desktop UI
    if (this.desktopUI && this.desktopUI.rootContainer) {
      console.log('🔄 Restoring desktop UI...')
      this.desktopUI.rootContainer.isVisible = true
      this.desktopUI.rootContainer.alpha = 1
    }
    
    // Clean up VR-specific UI
    this.disposeVRCaption()
    this.disposeFloorplanUI()
    this.disposeEmulationInfo()
    
    // Re-optimize materials for desktop
    if (this.currentPhotoDome?.material && !this.currentPhotoDome.material.isFrozen) {
      this.currentPhotoDome.material.freeze()
    }
    
    console.log('🖥️  VR emulation exited - desktop UI restored')
  }

  // VR Caption setup for emulation mode (bypasses isVRActive check)
  private setupVRCaptionEmulation(): void {
    console.log('Setting up VR caption for emulation mode')

    // Dispose existing VR caption first
    this.disposeVRCaption()

    // Create VR caption container
    this.vrCaptionContainer = new TransformNode('vrCaptionContainer', this.scene)
    
    // Position the caption in front of the user (will be updated each frame)
    this.vrCaptionContainer.position = new Vector3(0, 0.5, -2)
    
    // Create caption plane - optimized for emulation
    const captionPlane = MeshBuilder.CreatePlane('vrCaption', { width: 1.0, height: 0.4 }, this.scene)
    captionPlane.parent = this.vrCaptionContainer
    captionPlane.billboardMode = Mesh.BILLBOARDMODE_ALL // Always face the user
    
    // Make plane non-pickable for click-through functionality
    captionPlane.isPickable = false
    captionPlane.isBlocker = false
    
    // Create caption UI with high resolution
    this.vrCaptionUI = AdvancedDynamicTexture.CreateForMesh(captionPlane, 1024, 512)
    
    // Make the entire UI non-interactive for click-through
    this.vrCaptionUI.isForeground = false
    this.vrCaptionUI.rootContainer.isPointerBlocker = false
    this.vrCaptionUI.rootContainer.isHitTestVisible = false
    
    // Create text directly without background
    const captionText = new TextBlock('vrCaptionText')
    captionText.text = `Aktueller Standort:\n\n${this.getCurrentLocationLabel()}\n(EMULATION MODE)`
    captionText.color = 'white'
    captionText.fontSize = 32
    captionText.fontFamily = 'Arial'
    captionText.fontWeight = 'bold'
    captionText.textWrapping = true
    captionText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    captionText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
    
    // Make text non-interactive for click-through
    captionText.isPointerBlocker = false
    captionText.isHitTestVisible = false
    
    // Add text directly to UI (no background container)
    this.vrCaptionUI.addControl(captionText)
    
    // Register update function to keep caption in front of camera
    this.vrCaptionRenderObserver = this.scene.registerBeforeRender(() => {
      this.updateVRCaptionPosition()
    })
  }

  // Update VR caption text in emulation mode when location changes
  private updateVRCaptionEmulation(): void {
    if (!this.isVREmulationMode) return

    // If VR caption UI exists in emulation mode, update the text
    if (this.vrCaptionUI) {
      const captionText = this.vrCaptionUI.getControlByName('vrCaptionText') as TextBlock
      if (captionText) {
        captionText.text = `Aktueller Standort:\n\n${this.getCurrentLocationLabel()}\n(EMULATION MODE)`
        console.log('Updated VR caption in emulation mode:', this.getCurrentLocationLabel())
      }
    }
  }

  // Floorplan setup for emulation mode (bypasses isVRActive check)
  private setupFloorplanUIEmulation(): void {
    console.log('Setting up floorplan UI for emulation mode')

    // Create floorplan container
    this.floorplanContainer = new TransformNode('floorplanContainer', this.scene)
    
    // Position floorplan to the left side where it's visible in emulation
    this.floorplanContainer.position = new Vector3(-1.5, 0, -1)
    this.floorplanContainer.rotation = new Vector3(0, Math.PI / 4, 0)
    
    // Create floorplan plane
    const floorplanPlane = MeshBuilder.CreatePlane('floorplan', { size: 0.3 }, this.scene)
    floorplanPlane.parent = this.floorplanContainer

    // Load appropriate floorplan image
    const currentFloor = this.panoramaData[this.currentPanorama]?.floor || 'EG'
    const basePath = import.meta.env.BASE_URL
    const floorplanPath = `${basePath}ui/floorplan_${currentFloor}.png`
    
    console.log('Loading floorplan for emulation:', floorplanPath)
    
    this.floorplanUI = AdvancedDynamicTexture.CreateForMesh(floorplanPlane)
    
    const background = new Rectangle()
    background.background = 'rgba(255, 255, 255, 0.9)'
    background.cornerRadius = 10
    this.floorplanUI.addControl(background)
    
    const floorplanImage = new Image('floorplan', floorplanPath)
    floorplanImage.stretch = Image.STRETCH_UNIFORM
    background.addControl(floorplanImage)

    // Add interactive position markers
    this.addFloorplanPositionMarkers(background, currentFloor)

    // Setup continuous update for view direction
    this.setupFloorplanUpdateObserver()

    // Add current position indicator
    this.updateFloorplan()
  }

  private showEmulationInfo(): void {
    // Create emulation info overlay
    const emulationInfo = new TextBlock()
    emulationInfo.text = '🥽 VR EMULATION MODE\nPress "V" to exit\n\nFloorplan visible in scene\nVR Caption displayed'
    emulationInfo.color = 'yellow'
    emulationInfo.fontSize = 24
    emulationInfo.fontFamily = 'Arial'
    emulationInfo.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT
    emulationInfo.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    emulationInfo.top = '20px'
    emulationInfo.left = '-20px'
    emulationInfo.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT
    emulationInfo.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    
    // Create a separate UI for emulation info that stays visible
    const emulationUI = AdvancedDynamicTexture.CreateFullscreenUI('EmulationUI')
    emulationUI.addControl(emulationInfo)
    
    // Store reference for cleanup
    ;(emulationInfo as any)._emulationUI = emulationUI
    ;(this as any)._emulationInfo = emulationInfo
  }

  private disposeEmulationInfo(): void {
    const emulationInfo = (this as any)._emulationInfo
    if (emulationInfo) {
      const emulationUI = (emulationInfo as any)._emulationUI
      if (emulationUI) {
        emulationUI.dispose()
      }
      ;(this as any)._emulationInfo = null
    }
  }

  public dispose(): void {
    this.clearScene()
    this.disposeFloorplanUI()
    this.disposeVRCaption()
    this.disposeEmulationInfo()
    this.preloader.dispose()
    this.scene.dispose()
    this.engine.dispose()
  }
}

// Initialize the VR panorama viewer
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const viewer = new VRPanoramaViewer(canvas)

// Handle page unload
window.addEventListener('beforeunload', () => {
  viewer.dispose()
})



