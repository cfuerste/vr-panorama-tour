// Navigation Manager Module - Handles panorama navigation, hotspots, and transitions
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3, Vector3 } from '@babylonjs/core/Maths/math'
import { Animation } from '@babylonjs/core/Animations/animation'
import { Tools } from '@babylonjs/core/Misc/tools'
import { ActionManager } from '@babylonjs/core/Actions/actionManager'
import { ExecuteCodeAction } from '@babylonjs/core/Actions/directActions'
import { AdvancedDynamicTexture, TextBlock } from '@babylonjs/gui'

import type { 
  PanoramaLink,
  NavigationState,
  INavigationManager,
  ModuleOptions,
  CoreRefs,
  NavigationCallback,
  UserInteractionCallback,
  HotspotMetadata
} from '../types'

export class NavigationManager implements INavigationManager {
  private coreRefs: CoreRefs
  private state: NavigationState
  private onNavigate?: NavigationCallback
  private onUserInteraction?: UserInteractionCallback
  private isVRActive: boolean = false

  constructor(options: ModuleOptions & {
    onNavigate?: NavigationCallback
    onUserInteraction?: UserInteractionCallback
  }) {
    this.coreRefs = options.coreRefs
    this.onNavigate = options.onNavigate
    this.onUserInteraction = options.onUserInteraction

    this.state = {
      currentPanorama: 'Panorama_Außenanlagen_001',
      currentLocationLabel: 'Drehgestelllager',
      selectedFloor: 'EG',
      hotspots: []
    }
  }

  public createHotspots(links: PanoramaLink[]): void {
    // Clear existing hotspots first
    this.clearHotspots()

    links.forEach((link, index) => {
      this.createHotspot(link, index)
    })

    console.log(`Created ${links.length} navigation hotspots`)
  }

  private createHotspot(link: PanoramaLink, index: number): void {
    // Create hotspot sphere
    const hotspot = MeshBuilder.CreateSphere(`hotspot_${index}`, { diameter: 8 }, this.coreRefs.scene)
    
    // Position hotspot based on yaw/pitch
    const distance = 200
    const yawRad = Tools.ToRadians(link.yaw) - Math.PI / 2 // Adjust for initial orientation
    const pitchRad = Tools.ToRadians(link.pitch)
    
    const x = distance * Math.cos(pitchRad) * Math.cos(yawRad)
    const y = distance * Math.sin(pitchRad)
    const z = distance * Math.cos(pitchRad) * Math.sin(yawRad)
    
    hotspot.position = new Vector3(x, y, z)

    // Create hotspot material with better visual feedback
    const material = new PBRMaterial(`hotspotMat_${index}`, this.coreRefs.scene)
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

    // Add interaction handlers
    this.setupHotspotInteraction(hotspot, link, index)

    // Create label
    this.createHotspotLabel(hotspot, link.label, index)

    // Store reference with metadata
    hotspot.metadata = { link } satisfies HotspotMetadata
    this.state.hotspots.push(hotspot)
  }

  private setupHotspotInteraction(hotspot: Mesh, link: PanoramaLink, _index: number): void {
    hotspot.actionManager = new ActionManager(this.coreRefs.scene)
    
    // On hover - change color for visual feedback
    hotspot.actionManager.registerAction(new ExecuteCodeAction(
      ActionManager.OnPointerOverTrigger,
      () => {
        if (hotspot.material && hotspot.material instanceof PBRMaterial) {
          hotspot.material.emissiveColor = new Color3(0.3, 0.3, 0.3)
        }
        // Add haptic feedback for VR controllers if available
        this.triggerHapticFeedback(0.3, 100)
      }
    ))
          
    // On click/select - navigate and store the label
    hotspot.actionManager.registerAction(new ExecuteCodeAction(
      ActionManager.OnPickTrigger,
      () => {
        // Mark user interaction
        this.onUserInteraction?.()

        // Strong haptic feedback on selection
        this.triggerHapticFeedback(0.8, 200)
        
        // Store the label before navigating
        this.state.currentLocationLabel = link.label
        this.navigateToPanorama(link.to)
      }
    ))
  }

  private triggerHapticFeedback(intensity: number, duration: number): void {
    // This would be implemented by the WebXR manager
    // For now, just log the intent
    if (this.isVRActive) {
      console.log(`Haptic feedback: intensity=${intensity}, duration=${duration}`)
    }
  }

  private createHotspotLabel(hotspot: Mesh, text: string, index: number): void {
    // Create plane for label
    const labelPlane = MeshBuilder.CreatePlane(`label_${index}`, { size: 50 }, this.coreRefs.scene)
    labelPlane.position = hotspot.position.clone()
    labelPlane.position.y += 10
    labelPlane.billboardMode = Mesh.BILLBOARDMODE_ALL
    labelPlane.isPickable = false

    // Create label texture
    const labelTexture = AdvancedDynamicTexture.CreateForMesh(labelPlane)
    
    const textBlock = new TextBlock()
    textBlock.text = text
    textBlock.color = 'white'
    textBlock.fontSize = 85
    textBlock.fontWeight = 'bold'
    textBlock.fontFamily = 'Arial'
    textBlock.textWrapping = false
    textBlock.resizeToFit = false
    
    labelTexture.addControl(textBlock)
    
    this.state.hotspots.push(labelPlane)
  }

  public clearHotspots(): void {
    // Clear hotspots only (don't dispose the photodome)
    this.state.hotspots.forEach(hotspot => {
      try {
        hotspot.dispose()
      } catch (error) {
        console.warn('Error disposing hotspot:', error)
      }
    })
    this.state.hotspots = []
  }

  public async navigateToPanorama(targetPanorama: string): Promise<void> {
    if (this.onNavigate) {
      try {
        await this.onNavigate(targetPanorama)
        this.state.currentPanorama = targetPanorama
        console.log(`Navigated to panorama: ${targetPanorama}`)
      } catch (error) {
        console.error(`Failed to navigate to panorama: ${targetPanorama}`, error)
        throw error
      }
    } else {
      console.warn('No navigation callback set')
    }
  }

  public getCurrentLocationLabel(): string {
    return this.state.currentLocationLabel
  }

  public setCurrentLocationLabel(label: string): void {
    this.state.currentLocationLabel = label
  }

  public getCurrentPanorama(): string {
    return this.state.currentPanorama
  }

  public setCurrentPanorama(panoramaId: string): void {
    this.state.currentPanorama = panoramaId
  }

  public getSelectedFloor(): string {
    return this.state.selectedFloor
  }

  public setSelectedFloor(floor: string): void {
    this.state.selectedFloor = floor
  }

  public setVRActive(isActive: boolean): void {
    this.isVRActive = isActive
  }

  public getHotspotCount(): number {
    return this.state.hotspots.length
  }

  public getHotspotsMetadata(): HotspotMetadata[] {
    return this.state.hotspots
      .map(hotspot => hotspot.metadata)
      .filter((metadata): metadata is HotspotMetadata => !!metadata)
  }

  public dispose(): void {
    this.clearHotspots()
    console.log('NavigationManager disposed')
  }
}