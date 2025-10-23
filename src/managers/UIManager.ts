// UI Manager Module - Handles all UI components (desktop, VR, floorplan)
import { AdvancedDynamicTexture, Control, TextBlock, Button, Rectangle, Image } from '@babylonjs/gui'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import type { 
  UIComponents,
  FloorplanElements,
  IUIManager,
  ModuleOptions,
  CoreRefs,
  PanoramaData,
  PanoramaDatabase,
  AdjustedCoordinates,
  FloorplanConfig,
  ControllerInfo
} from '../types'

import { DEFAULT_FLOORPLAN_CONFIG } from '../types'

export class UIManager implements IUIManager {
  private coreRefs: CoreRefs
  private components: UIComponents
  private floorplanElements: FloorplanElements
  private config: FloorplanConfig
  
  // State
  private isVRActive: boolean = false
  private isVREmulationMode: boolean = false
  private selectedFloor: string = 'EG'
  private currentPanorama: string = ''
  private currentLocationLabel: string = ''

  // Callbacks
  private onEnterVRCallback?: () => void
  private onFloorSwitchCallback?: (floor: string) => void
  private onNavigateCallback?: (panoramaId: string) => void

  constructor(options: ModuleOptions & {
    onEnterVR?: () => void
    onFloorSwitch?: (floor: string) => void
    onNavigate?: (panoramaId: string) => void
  }) {
    this.coreRefs = options.coreRefs
    this.onEnterVRCallback = options.onEnterVR
    this.onFloorSwitchCallback = options.onFloorSwitch
    this.onNavigateCallback = options.onNavigate
    this.config = DEFAULT_FLOORPLAN_CONFIG

    this.components = {
      desktopUI: null,
      enterVRButton: null,
      infoText: null,
      floorplanUI: null,
      floorplanContainer: null,
      floorplanImage: null,
      vrCaptionContainer: null,
      vrCaptionUI: null
    }

    this.floorplanElements = {
      positionMarkers: [],
      currentLocationMarker: null,
      viewDirectionIndicator: null,
      floorSwitchButtons: [],
      updateObserver: null
    }
  }

  public setupUI(): void {
    this.createDesktopUI()
    console.log('Desktop UI setup complete')
  }

  private createDesktopUI(): void {
    // Create desktop UI
    this.components.desktopUI = AdvancedDynamicTexture.CreateFullscreenUI('UI')
    
    this.createEnterVRButton()
    this.createInfoPanel()
  }

  private createEnterVRButton(): void {
    if (!this.components.desktopUI) return

    // VR Enter button
    this.components.enterVRButton = Button.CreateSimpleButton('enterVR', 'Enter VR Mode')
    this.components.enterVRButton.widthInPixels = 200
    this.components.enterVRButton.heightInPixels = 60
    this.components.enterVRButton.color = 'white'
    this.components.enterVRButton.cornerRadius = 10
    this.components.enterVRButton.background = 'rgba(0, 100, 200, 0.8)'
    this.components.enterVRButton.top = '-200px'
    this.components.enterVRButton.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM
    
    this.components.enterVRButton.onPointerClickObservable.add(() => {
      this.onEnterVRCallback?.()
    })
    
    this.components.desktopUI.addControl(this.components.enterVRButton)
  }

  private createInfoPanel(): void {
    if (!this.components.desktopUI) return

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
    this.components.desktopUI.addControl(infoPanel)
    
    const infoText = new TextBlock()
    infoText.text = `\nAktueller Standort:\n${this.getCurrentPanoramaDisplayName()}`
    infoText.color = 'white'
    infoText.fontSize = 16
    infoText.textWrapping = true
    infoText.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    infoPanel.addControl(infoText)

    this.components.infoText = infoText
  }

  public setupVRCaption(): void {
    if (!this.isVRActive) return

    console.log('Setting up VR caption')
    this.disposeVRCaption() // Clean up existing

    // Create VR caption container
    this.components.vrCaptionContainer = new TransformNode('vrCaptionContainer', this.coreRefs.scene)
    this.components.vrCaptionContainer.position = new Vector3(0, 0.5, -2)
    
    // Create caption plane - optimized for Meta Quest 3
    const captionPlane = MeshBuilder.CreatePlane('vrCaption', { width: 1.0, height: 0.4 }, this.coreRefs.scene)
    captionPlane.parent = this.components.vrCaptionContainer
    captionPlane.billboardMode = Mesh.BILLBOARDMODE_ALL
    
    // Make plane non-pickable for click-through functionality
    captionPlane.isPickable = false
    captionPlane.isBlocker = false
    
    // Create caption UI with high resolution for Meta Quest 3
    this.components.vrCaptionUI = AdvancedDynamicTexture.CreateForMesh(captionPlane, 1024, 512)
    
    // Make the entire UI non-interactive for click-through
    this.components.vrCaptionUI.isForeground = false
    this.components.vrCaptionUI.rootContainer.isPointerBlocker = false
    this.components.vrCaptionUI.rootContainer.isHitTestVisible = false
    
    // Create text directly without background
    const captionText = new TextBlock('vrCaptionText')
    captionText.text = `Aktueller Standort:\n\n${this.currentLocationLabel}`
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
    
    this.components.vrCaptionUI.addControl(captionText)
  }

  public updateVRCaptionPosition(): void {
    if (!this.components.vrCaptionContainer || !this.isVRActive) return
    
    let camera = this.coreRefs.scene.activeCamera
    if (!camera) camera = this.coreRefs.camera
    if (!camera) return
    
    // Calculate position in front of the camera
    const cameraDirection = camera.getForwardRay().direction
    const cameraPosition = camera.position
    
    // Position the caption closer for better readability in Meta Quest 3
    const distance = 1.5
    const heightOffset = 0.5
    
    this.components.vrCaptionContainer.position.x = cameraPosition.x + cameraDirection.x * distance
    this.components.vrCaptionContainer.position.y = cameraPosition.y + cameraDirection.y * distance + heightOffset
    this.components.vrCaptionContainer.position.z = cameraPosition.z + cameraDirection.z * distance
  }

  public disposeVRCaption(): void {
    if (this.components.vrCaptionUI) {
      this.components.vrCaptionUI.dispose()
      this.components.vrCaptionUI = null
    }
    if (this.components.vrCaptionContainer) {
      this.components.vrCaptionContainer.dispose()
      this.components.vrCaptionContainer = null
    }
  }

  public setupFloorplanUI(): void {
    if (!this.isVRActive) return

    console.log('Setting up floorplan UI')

    // Create floorplan container
    this.components.floorplanContainer = new TransformNode('floorplanContainer', this.coreRefs.scene)
    
    // Position floorplan in VR space
    if (this.isVREmulationMode) {
      this.components.floorplanContainer.position = new Vector3(-1.5, 0, -1)
      this.components.floorplanContainer.rotation = new Vector3(0, Math.PI / 4, 0)
    } else {
      this.components.floorplanContainer.position = new Vector3(0, 0, 0)
    }
    
    const floorplanScale = 2
    const floorplanWidth = 0.3 * floorplanScale
    const floorplanHeight = 0.2 * floorplanScale
    
    // Create floorplan plane
    const floorplanPlane = MeshBuilder.CreatePlane('floorplan', { width: floorplanWidth, height: floorplanHeight }, this.coreRefs.scene)
    floorplanPlane.parent = this.components.floorplanContainer
    
    // Fix flipped orientation by rotating the plane
    floorplanPlane.rotation.y = Math.PI
    
    if (!this.isVREmulationMode) {
      floorplanPlane.position = new Vector3(0.275, 0, 0)
    }

    // Load appropriate floorplan image
    const basePath = import.meta.env.BASE_URL
    const floorplanPath = `${basePath}ui/floorplan_${this.selectedFloor}.png`
    
    console.log('Loading floorplan:', floorplanPath)
    
    this.components.floorplanUI = AdvancedDynamicTexture.CreateForMesh(floorplanPlane)
    
    const background = new Rectangle()
    background.name = 'background'
    background.background = 'rgba(255, 255, 255, 0.9)'
    background.cornerRadius = 10
    this.components.floorplanUI.addControl(background)
    
    this.components.floorplanImage = new Image('floorplan', floorplanPath)
    this.components.floorplanImage.stretch = Image.STRETCH_UNIFORM
    background.addControl(this.components.floorplanImage)

    // Add floor switching buttons
    this.addFloorSwitchButtons(background)
  }

  private addFloorSwitchButtons(background: Rectangle): void {
    console.log('Adding floor switch buttons')
    
    const buttonWidth = 50
    const buttonHeight = 30
    const spacing = 8
    const startX = -((this.config.floors.length * buttonWidth + (this.config.floors.length - 1) * spacing) / 2)
    
    this.config.floors.forEach((floor, index) => {
      const button = new Button(`floor_button_${floor}`)
      button.widthInPixels = buttonWidth
      button.heightInPixels = buttonHeight
      button.cornerRadius = 8
      button.thickness = 3
      
      // Style based on whether this is the selected floor
      if (floor === this.selectedFloor) {
        button.background = 'rgba(0, 150, 255, 0.95)'
        button.color = 'white'
      } else {
        button.background = 'rgba(80, 80, 80, 0.9)'
        button.color = 'white'
      }
      
      button.leftInPixels = startX + (index * (buttonWidth + spacing))
      button.topInPixels = -60
      button.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
      button.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
      
      // Add text label
      const label = new TextBlock()
      label.text = floor
      label.color = button.color
      label.fontSize = '14px'
      label.fontWeight = 'bold'
      button.addControl(label)
      
      // Add click handler
      button.onPointerClickObservable.add(() => {
        console.log(`Floor button ${floor} clicked`)
        this.switchToFloor(floor)
      })
      
      background.addControl(button)
      this.floorplanElements.floorSwitchButtons.push(button)
    })
  }

  private switchToFloor(floor: string): void {
    console.log(`Switching floorplan to floor: ${floor}`)
    
    if (this.selectedFloor === floor) return
    
    this.selectedFloor = floor
    this.onFloorSwitchCallback?.(floor)
    
    // Update floorplan image
    if (this.components.floorplanImage) {
      const basePath = import.meta.env.BASE_URL
      const floorplanPath = `${basePath}ui/floorplan_${floor}.png`
      this.components.floorplanImage.source = floorplanPath
    }
    
    this.updateFloorSwitchButtons()
  }

  private updateFloorSwitchButtons(): void {
    this.floorplanElements.floorSwitchButtons.forEach(control => {
      const button = control as Button
      const buttonName = button.name || ''
      const floor = buttonName.replace('floor_button_', '')
      
      if (floor === this.selectedFloor) {
        button.background = 'rgba(0, 150, 255, 0.95)'
        button.color = 'white'
      } else {
        button.background = 'rgba(80, 80, 80, 0.9)'
        button.color = 'white'
      }
      
      // Update text color
      if (button.children && button.children.length > 0) {
        const label = button.children[0] as TextBlock
        if (label) label.color = 'white'
      }
    })
  }

  public addFloorplanPositionMarkers(panoramaData: PanoramaDatabase): void {
    if (!this.components.floorplanUI) return

    const background = this.components.floorplanUI.getControlByName('background') as Rectangle
    if (!background) return

    // Clear existing markers
    this.clearFloorplanMarkers()
    
    const allPanoramas = Object.entries(panoramaData)
    console.log(`Adding ${allPanoramas.length} floorplan markers with blending`)

    allPanoramas.forEach(([panoramaId, data]) => {
      this.createFloorplanPositionMarker(background, panoramaId, data)
    })

    this.createViewDirectionIndicator(background)
  }

  private createFloorplanPositionMarker(background: Rectangle, panoramaId: string, data: PanoramaData): void {
    const marker = new Button(`marker_${panoramaId}`)
    
    const isCurrent = panoramaId === this.currentPanorama
    const isSelectedFloor = data.floor === this.selectedFloor
    
    if (isCurrent) {
      marker.widthInPixels = 30
      marker.heightInPixels = 30
      marker.cornerRadius = 15
      marker.thickness = 3
      marker.background = 'rgba(255, 0, 0, 0.9)'
      marker.color = 'rgba(255, 255, 0, 1)'
      this.floorplanElements.currentLocationMarker = marker
    } else if (isSelectedFloor) {
      marker.widthInPixels = 34
      marker.heightInPixels = 34
      marker.cornerRadius = 17
      marker.thickness = 2
      marker.background = 'rgba(0, 150, 255, 0.8)'
      marker.color = 'rgba(255, 255, 255, 0.9)'
    } else {
      marker.widthInPixels = 20
      marker.heightInPixels = 20
      marker.cornerRadius = 10
      marker.thickness = 1
      marker.background = 'rgba(0, 150, 255, 0.5)'
      marker.color = 'rgba(255, 255, 255, 0.6)'
    }
    
    // Add hover effects for clickable markers
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
    
    marker.left = `${(adjustedCoords.x * 100)}%`
    marker.top = `${(adjustedCoords.y * 100)}%`
    marker.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
    marker.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    
    // Add click handler for navigation
    marker.onPointerClickObservable.add(() => {
      if (!isCurrent) {
        console.log(`Navigating to ${data.name} on floor ${data.floor} via floorplan click`)
        this.onNavigateCallback?.(panoramaId)
      }
    })
    
    background.addControl(marker)
    this.floorplanElements.positionMarkers.push(marker)
  }

  private adjustCoordinatesForAspectRatio(x: number, y: number): AdjustedCoordinates {
    const aspectRatio = this.config.aspectRatio
    let adjustedX = x
    let adjustedY = y
    
    if (aspectRatio > this.config.containerAspectRatio) {
      const imageHeightInContainer = 1.0 / aspectRatio
      const letterboxOffset = (1.0 - imageHeightInContainer) / 2
      adjustedY = letterboxOffset + (y * imageHeightInContainer)
    }
    
    return { x: adjustedX, y: adjustedY }
  }

  private createViewDirectionIndicator(background: Rectangle): void {
    if (!this.currentPanorama) return

    // This would need panorama data to get coordinates
    // For now, create placeholder
    const directionIndicatorL = new Rectangle('view_direction_L')
    directionIndicatorL.widthInPixels = 2
    directionIndicatorL.heightInPixels = 25
    directionIndicatorL.background = 'rgba(255, 255, 0, 0.8)'
    directionIndicatorL.thickness = 0
    
    background.addControl(directionIndicatorL)
    this.floorplanElements.viewDirectionIndicator = directionIndicatorL
  }

  public updateViewAngle(): void {
    if (!this.floorplanElements.viewDirectionIndicator) return

    let camera = this.coreRefs.scene.activeCamera
    if (!camera) camera = this.coreRefs.camera
    if (!camera) return
    
    // Get camera rotation to determine view direction
    let cameraYRotation = 0
    if (this.coreRefs.camera) {
      cameraYRotation = this.coreRefs.camera.rotation.y
    }
    
    // Apply rotation to indicator
    this.floorplanElements.viewDirectionIndicator.rotation = cameraYRotation
  }

  private clearFloorplanMarkers(): void {
    // Clear position markers
    this.floorplanElements.positionMarkers.forEach(marker => {
      if (marker.parent) {
        marker.parent.removeControl(marker)
      }
      marker.dispose()
    })
    this.floorplanElements.positionMarkers = []
    
    // Clear floor switch buttons
    this.floorplanElements.floorSwitchButtons.forEach(button => {
      if (button.parent) {
        button.parent.removeControl(button)
      }
      button.dispose()
    })
    this.floorplanElements.floorSwitchButtons = []
    
    // Clear other elements
    if (this.floorplanElements.currentLocationMarker) {
      if (this.floorplanElements.currentLocationMarker.parent) {
        this.floorplanElements.currentLocationMarker.parent.removeControl(this.floorplanElements.currentLocationMarker)
      }
      this.floorplanElements.currentLocationMarker.dispose()
      this.floorplanElements.currentLocationMarker = null
    }
    
    if (this.floorplanElements.viewDirectionIndicator) {
      if (this.floorplanElements.viewDirectionIndicator.parent) {
        this.floorplanElements.viewDirectionIndicator.parent.removeControl(this.floorplanElements.viewDirectionIndicator)
      }
      this.floorplanElements.viewDirectionIndicator.dispose()
      this.floorplanElements.viewDirectionIndicator = null
    }
  }

  public disposeFloorplanUI(): void {
    this.clearFloorplanMarkers()

    if (this.components.floorplanUI) {
      this.components.floorplanUI.dispose()
      this.components.floorplanUI = null
    }

    if (this.components.floorplanContainer) {
      this.components.floorplanContainer.getChildMeshes().forEach(mesh => {
        if (mesh.material) {
          mesh.material.dispose()
        }
        mesh.dispose()
      })
      
      this.components.floorplanContainer.dispose()
      this.components.floorplanContainer = null
    }

    this.components.floorplanImage = null
    console.log('Floorplan UI properly disposed')
  }

  public updateInfoText(): void {
    if (this.components.infoText) {
      this.components.infoText.text = `\nAktueller Standort:\n${this.getCurrentPanoramaDisplayName()}`
    }
  }

  public updateVRCaption(): void {
    if (!this.isVRActive) return
    this.setupVRCaption()
  }

  public updateFloorplan(): void {
    if (!this.isVRActive || !this.components.floorplanUI) return
    // This would be called when panorama changes to update markers
    console.log('Updating floorplan markers')
  }

  public showContextLossError(): void {
    if (this.components.infoText) {
      this.components.infoText.text = 'WebGL Error: Please reload the page\n(Quest 3 context recovery failed)'
      this.components.infoText.color = 'red'
    }
  }

  public hideDesktopUI(): void {
    if (this.components.desktopUI?.rootContainer) {
      console.log('Hiding desktop UI for VR mode')
      this.components.desktopUI.rootContainer.isVisible = false
      this.components.desktopUI.rootContainer.alpha = 0
      this.components.desktopUI.rootContainer.isPointerBlocker = false
      this.components.desktopUI.rootContainer.isHitTestVisible = false
    }
  }

  public showDesktopUI(): void {
    if (this.components.desktopUI?.rootContainer) {
      console.log('Showing desktop UI for desktop mode')
      this.components.desktopUI.rootContainer.isVisible = true
      this.components.desktopUI.rootContainer.alpha = 1
      this.components.desktopUI.rootContainer.isPointerBlocker = true
      this.components.desktopUI.rootContainer.isHitTestVisible = true
    }
  }

  public setVRActive(isActive: boolean): void {
    this.isVRActive = isActive
    
    if (isActive) {
      this.hideDesktopUI()
      this.setupVRCaption()
      this.setupFloorplanUI()
    } else {
      this.showDesktopUI()
      this.disposeVRCaption()
      this.disposeFloorplanUI()
    }
  }

  public setVREmulationMode(enabled: boolean): void {
    this.isVREmulationMode = enabled
  }

  public setCurrentPanorama(panoramaId: string): void {
    this.currentPanorama = panoramaId
  }

  public setCurrentLocationLabel(label: string): void {
    this.currentLocationLabel = label
  }

  public setSelectedFloor(floor: string): void {
    this.selectedFloor = floor
  }

  public attachFloorplanToController(controller: ControllerInfo): void {
    if (!this.components.floorplanContainer || !this.isVRActive) return

    console.log('Attaching floorplan to controller:', controller.handness)
    
    if (controller.handness === 'left') {
      if (controller.grip) {
        this.components.floorplanContainer.parent = controller.grip
      } else if (controller.pointer) {
        this.components.floorplanContainer.parent = controller.pointer
      }
    }
  }

  private getCurrentPanoramaDisplayName(): string {
    if (!this.currentPanorama) return 'Unknown'
    
    const parts = this.currentPanorama.split('_')
    return parts.slice(1).join(' ').replace(/([A-Z])/g, ' $1').trim()
  }

  public dispose(): void {
    this.disposeVRCaption()
    this.disposeFloorplanUI()
    
    if (this.components.desktopUI) {
      this.components.desktopUI.dispose()
      this.components.desktopUI = null
    }

    // Reset all component references
    this.components = {
      desktopUI: null,
      enterVRButton: null,
      infoText: null,
      floorplanUI: null,
      floorplanContainer: null,
      floorplanImage: null,
      vrCaptionContainer: null,
      vrCaptionUI: null
    }

    console.log('UIManager disposed')
  }
}