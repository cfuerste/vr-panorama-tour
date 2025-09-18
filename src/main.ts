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
  private floorplanUI: AdvancedDynamicTexture | null = null
  private floorplanContainer: TransformNode | null = null
  private isVRActive = false
  private infoText: TextBlock | null = null
  private enterVRButton: Button | null = null
  private desktopUI: AdvancedDynamicTexture | null = null
  private vrCaptionContainer: TransformNode | null = null
  private vrCaptionUI: AdvancedDynamicTexture | null = null
  private preloader: PanoramaPreloader

  constructor(canvas: HTMLCanvasElement) {
    // Initialize engine with VR optimizations
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      disableWebGL2Support: false,
      powerPreference: "high-performance",
      antialias: false, // Better VR performance
      alpha: false,
      doNotHandleContextLost: true, // Better performance on Quest
      audioEngine: false // Disable audio engine if not needed
    })

    // Create scene with performance optimizations
    this.scene = new Scene(this.engine)
    this.scene.clearColor = new Color4(0, 0, 0, 1)
    
    // Performance optimizations
    this.scene.skipPointerMovePicking = true // Skip unnecessary picking
    this.scene.autoClear = true
    this.scene.autoClearDepthAndStencil = true

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
      console.log('Loading panorama data from:', jsonPath)
      const response = await fetch(jsonPath)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      this.panoramaData = await response.json()
      console.log('Loaded panorama data:', Object.keys(this.panoramaData).length, 'panoramas')
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
    
    console.log(`Loading panorama: ${panoramaId}`, preloadedUrl ? '(preloaded)' : '(network)')
    
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

      // Update info text
      this.updateInfoText()

      // Preload connected panoramas after loading current one
      this.preloadConnectedPanoramas(panoramaId)

      console.log('Loaded panorama:', panoramaId, 'with resolution:', imageSuffix)
    } catch (error) {
      console.error('Failed to load panorama:', panoramaId, error)
    }
  }

  private startBackgroundPreloading(): void {
    if (!this.panoramaData || Object.keys(this.panoramaData).length === 0) {
      console.log('No panorama data available for preloading')
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
      console.log(`Starting preload of ${connectedImages.length} connected images for ${panoramaId}`)
      
      this.preloader.startPreloading(
        connectedImages,
        '', // Empty base path since we already have complete URLs
        (progress, total) => {
          console.log(`Preload progress: ${progress}/${total}`)
          // Update UI if needed
          this.updatePreloadProgress(progress, total)
        },
        () => {
          console.log('Connected panoramas preloaded!')
        }
      )
    }
  }

  private updatePreloadProgress(progress: number, total: number): void {
    // Update info text to show preload progress
    if (this.infoText) {
      const progressText = total > 0 ? `\nPreloading: ${progress}/${total}` : ''
      this.infoText.text = `\nCurrent Location:\n${this.getCurrentPanoramaDisplayName()}${progressText}`
    }
  }

  private updateInfoText(): void {
    if (this.infoText) {
      this.infoText.text = `\nCurrent Location:\n${this.getCurrentPanoramaDisplayName()}`
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
      
      // On click/select - navigate
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
    console.log('Navigating to:', targetPanorama)
    await this.loadPanorama(targetPanorama)
  }

  private async setupWebXR(): Promise<void> {
    try {
      this.xrHelper = await WebXRDefaultExperience.CreateAsync(this.scene, {
        floorMeshes: [],
        disableDefaultUI: false,
        disableTeleportation: false
      })

      // Configure for Meta Quest 3
      if (this.xrHelper.baseExperience) {
        // Enable hand tracking
        this.xrHelper.baseExperience.featuresManager.enableFeature(
          'hand-tracking' as any,
          'latest'
        )

        // Enable controller pointer selection
        this.xrHelper.baseExperience.featuresManager.enableFeature(
          'pointer-selection' as any,
          'stable',
          { 
            xrInput: this.xrHelper.input,
            enablePointerSelectionOnAllControllers: true
          }
        )

        // Setup VR state change handlers
        this.xrHelper.baseExperience.onStateChangedObservable.add((state) => {
          switch (state) {
            case WebXRState.ENTERING_XR:
              console.log('Entering VR')
              this.isVRActive = true
              this.onEnterVR()
              break
            case WebXRState.EXITING_XR:
              console.log('Exiting VR')
              this.isVRActive = false
              this.onExitVR()
              break
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

  private onEnterVR(): void {
    console.log('VR mode activated - refreshing photodome rendering')
    
    // Hide entire desktop UI when in VR mode
    if (this.desktopUI) {
      this.desktopUI.rootContainer.isVisible = false
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
  }

  private onExitVR(): void {
    console.log('Exiting VR mode')
    this.disposeFloorplanUI()
    this.disposeVRCaption()
    
    // Show desktop UI when exiting VR mode
    if (this.desktopUI) {
      this.desktopUI.rootContainer.isVisible = true
    }
    
    // Re-optimize materials for desktop
    if (this.currentPhotoDome?.material && !this.currentPhotoDome.material.isFrozen) {
      this.currentPhotoDome.material.freeze()
    }
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
    infoText.text = `\nCurrent Location:\n${this.getCurrentPanoramaDisplayName()}`
    infoText.color = 'white'
    infoText.fontSize = 16
    infoText.textWrapping = true
    infoText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    infoPanel.addControl(infoText)

    // Instructions for desktop users
    const instructionsPanel = new Rectangle('instructions')
    instructionsPanel.width = '280px'
    instructionsPanel.height = '80px'
    instructionsPanel.cornerRadius = 10
    instructionsPanel.color = 'white'
    instructionsPanel.thickness = 2
    instructionsPanel.background = 'rgba(100, 50, 0, 0.7)'
    instructionsPanel.top = '160px'
    instructionsPanel.left = '20px'
    instructionsPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
    instructionsPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    this.desktopUI.addControl(instructionsPanel)
    
    const instructionsText = new TextBlock()
    instructionsText.text = 'Desktop: Click and drag to look around\nVR: Use hand tracking or controllers\nto interact with hotspots'
    instructionsText.color = 'white'
    instructionsText.fontSize = 14
    instructionsText.textWrapping = true
    instructionsPanel.addControl(instructionsText)

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
    
    // Create floorplan plane
    const floorplanPlane = MeshBuilder.CreatePlane('floorplan', { size: 0.3 }, this.scene)
    floorplanPlane.parent = this.floorplanContainer
    floorplanPlane.position = new Vector3(-0.2, 0, 0.1)
    floorplanPlane.rotation = new Vector3(0, Math.PI / 6, 0)

    // Load appropriate floorplan image
    const currentFloor = this.panoramaData[this.currentPanorama]?.floor || 'EG'
    const basePath = import.meta.env.BASE_URL
    const floorplanPath = `${basePath}ui/floorplan_${currentFloor}.png`
    
    console.log('Loading floorplan:', floorplanPath)
    
    this.floorplanUI = AdvancedDynamicTexture.CreateForMesh(floorplanPlane)
    
    const background = new Rectangle()
    background.background = 'rgba(255, 255, 255, 0.9)'
    background.cornerRadius = 10
    this.floorplanUI.addControl(background)
    
    const floorplanImage = new Image('floorplan', floorplanPath)
    floorplanImage.stretch = Image.STRETCH_UNIFORM
    background.addControl(floorplanImage)

    // Try to attach to any existing left controllers
    if (this.xrHelper?.input.controllers) {
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
    if (!this.floorplanUI || !this.isVRActive) return

    const currentData = this.panoramaData[this.currentPanorama]
    if (!currentData) return

    // Update position indicator on floorplan
    // This would require more detailed implementation based on the map coordinates
    console.log('Updating floorplan position:', currentData.map)
  }

  private disposeFloorplanUI(): void {
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
    
    // Position the caption in front of the user
    this.vrCaptionContainer.position = new Vector3(0, 0.5, -2)
    
    // Create caption plane
    const captionPlane = MeshBuilder.CreatePlane('vrCaption', { size: 1.5 }, this.scene)
    captionPlane.parent = this.vrCaptionContainer
    captionPlane.billboardMode = Mesh.BILLBOARDMODE_ALL // Always face the user
    
    // Create caption UI
    this.vrCaptionUI = AdvancedDynamicTexture.CreateForMesh(captionPlane)
    
    // Create background
    const background = new Rectangle()
    background.background = 'rgba(0, 0, 0, 0.7)'
    background.cornerRadius = 15
    background.adaptWidthToChildren = true
    background.adaptHeightToChildren = true
    background.paddingTopInPixels = 15
    background.paddingBottomInPixels = 15
    background.paddingLeftInPixels = 25
    background.paddingRightInPixels = 25
    this.vrCaptionUI.addControl(background)
    
    // Create text
    const captionText = new TextBlock()
    captionText.text = `Current Location:\n${this.getCurrentPanoramaDisplayName()}`
    captionText.color = 'white'
    captionText.fontSize = 48
    captionText.fontFamily = 'Arial'
    captionText.textWrapping = true
    captionText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    captionText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
    background.addControl(captionText)
  }

  private disposeVRCaption(): void {
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
    if (!this.vrCaptionUI || !this.isVRActive) return
    
    // Find the text block and update it
    const background = this.vrCaptionUI.getControlByName('') as Rectangle
    if (background && background.children.length > 0) {
      const captionText = background.children[0] as TextBlock
      if (captionText) {
        captionText.text = `Current Location:\n${this.getCurrentPanoramaDisplayName()}`
      }
    }
  }

  public dispose(): void {
    this.clearScene()
    this.disposeFloorplanUI()
    this.disposeVRCaption()
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



