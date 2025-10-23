// WebXR Manager Module - Handles VR setup, state management, and controller handling
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience'
import { WebXRState } from '@babylonjs/core/XR/webXRTypes'

// Import WebXR features
import '@babylonjs/core/XR/features/WebXRHandTracking'
import '@babylonjs/core/XR/features/WebXRControllerPointerSelection'
import '@babylonjs/core/XR/features/WebXRPlaneDetector'
import '@babylonjs/core/XR/features/WebXRFeaturePointSystem'

import type { 
  VRState,
  IWebXRManager,
  ModuleOptions,
  CoreRefs,
  ControllerInfo
} from '../types'

export class WebXRManager implements IWebXRManager {
  private coreRefs: CoreRefs
  private state: VRState
  private onEnterVRCallback?: () => void
  private onExitVRCallback?: () => void
  private onControllerConnected?: (controller: ControllerInfo) => void

  constructor(options: ModuleOptions & {
    onEnterVR?: () => void
    onExitVR?: () => void
    onControllerConnected?: (controller: ControllerInfo) => void
  }) {
    this.coreRefs = options.coreRefs
    this.onEnterVRCallback = options.onEnterVR
    this.onExitVRCallback = options.onExitVR
    this.onControllerConnected = options.onControllerConnected

    this.state = {
      isVRActive: false,
      isVREmulationMode: false,
      xrHelper: null
    }
  }

  public async setupWebXR(): Promise<void> {
    try {
      console.log('🔧 Setting up WebXR for Meta Quest 3...')
      this.state.xrHelper = await WebXRDefaultExperience.CreateAsync(this.coreRefs.scene, {
        floorMeshes: [],
        disableDefaultUI: false,
        disableTeleportation: false
      })

      console.log('✅ WebXR initialized successfully')

      if (this.state.xrHelper.baseExperience) {
        console.log('🔧 Configuring WebXR features...')
        
        this.logInitialState()
        this.tryInitialFeatureSetup()
        this.setupVRStateHandlers()
        this.setupControllerManagement()
      }
    } catch (error) {
      console.warn('WebXR not supported or failed to initialize:', error)
    }
  }

  private logInitialState(): void {
    console.log('📊 Initial WebXR state:', {
      hasXRHelper: !!this.state.xrHelper,
      hasBaseExperience: !!this.state.xrHelper?.baseExperience,
      hasSessionManager: !!this.state.xrHelper?.baseExperience?.sessionManager,
      initialVRState: this.state.isVRActive,
      isInXRSession: this.state.xrHelper?.baseExperience?.sessionManager?.inXRSession || false
    })
  }

  private setupVRStateHandlers(): void {
    if (!this.state.xrHelper?.baseExperience) return

    const sessionManager = this.state.xrHelper.baseExperience.sessionManager
    
    console.log('🔧 Setting up WebXR session detection for Meta Quest 3...')
    
    // Primary WebXR session event listeners
    sessionManager.onXRSessionInit.add((session: XRSession) => {
      const sessionMode = (session as any).mode || 'unknown'
      console.log('🚀 XRSession STARTED:', {
        mode: sessionMode,
        visibilityState: session.visibilityState,
        timestamp: new Date().toLocaleTimeString()
      })
      
      const isImmersiveVR = this.state.xrHelper?.baseExperience?.sessionManager?.inXRSession || false
      console.log('🔍 Session validation:', {
        isImmersiveVR,
        sessionManagerExists: !!this.state.xrHelper?.baseExperience?.sessionManager,
        currentVRState: this.state.isVRActive
      })
      
      if (isImmersiveVR) {
        console.log('✅ Immersive VR session detected - triggering VR mode')
        this.state.isVRActive = true
        this.setupVRFeatures()
        this.onEnterVR()
        
        this.setupSessionEventListeners(session)
      } else {
        console.log('ℹ️  Non-immersive session detected - not entering VR mode')
      }
    })
    
    sessionManager.onXRSessionEnded.add(() => {
      console.log('🛑 XRSession ENDED - ensuring VR mode is disabled')
      if (this.state.isVRActive) {
        this.state.isVRActive = false
        this.onExitVR()
      }
    })

    // Backup state change detection
    this.state.xrHelper.baseExperience.onStateChangedObservable.add((state) => {
      console.log('🔄 WebXR State Change (backup detection):', {
        state,
        currentVRState: this.state.isVRActive,
        timestamp: new Date().toLocaleTimeString()
      })
      
      const hasActiveSession = !!sessionManager.session && this.state.xrHelper?.baseExperience?.sessionManager?.inXRSession
      
      switch (state) {
        case WebXRState.ENTERING_XR:
          if (!this.state.isVRActive && hasActiveSession) {
            console.log('🔄 Backup: Entering VR - hiding desktop UI')
            this.state.isVRActive = true
            this.onEnterVR()
          }
          break
        case WebXRState.EXITING_XR:
          if (this.state.isVRActive && !hasActiveSession) {
            console.log('🔄 Backup: Exiting VR - showing desktop UI')
            this.state.isVRActive = false
            this.onExitVR()
          }
          break
        case WebXRState.IN_XR:
          if (!this.state.isVRActive && hasActiveSession) {
            console.log('🔄 Backup: In VR state - ensuring desktop UI is hidden')
            this.state.isVRActive = true
            this.onEnterVR()
          }
          break
        case WebXRState.NOT_IN_XR:
          if (this.state.isVRActive && !hasActiveSession) {
            console.log('🔄 Backup: Not in VR state - ensuring desktop UI is visible')
            this.state.isVRActive = false
            this.onExitVR()
          }
          break
      }
    })

    this.setupFrameBasedValidation()
  }

  private setupSessionEventListeners(session: XRSession): void {
    session.addEventListener('visibilitychange', () => {
      console.log('👁️  VR session visibility changed:', {
        visibilityState: session.visibilityState,
        timestamp: new Date().toLocaleTimeString()
      })
      
      if (session.visibilityState === 'visible' && !this.state.isVRActive) {
        console.log('👁️  VR session became visible - entering VR mode')
        this.state.isVRActive = true
        this.onEnterVR()
      } else if (session.visibilityState === 'hidden' && this.state.isVRActive) {
        console.log('👁️  VR session became hidden - staying in VR mode (backgrounded)')
        // Keep VR mode active even when backgrounded
      }
    })
    
    session.addEventListener('end', () => {
      console.log('🛑 VR session ended - triggering exit VR mode')
      this.state.isVRActive = false
      this.onExitVR()
    })
  }

  private setupFrameBasedValidation(): void {
    if (!this.state.xrHelper?.baseExperience) return

    const sessionManager = this.state.xrHelper.baseExperience.sessionManager
    let frameCount = 0

    this.coreRefs.scene.registerBeforeRender(() => {
      frameCount++
      const session = sessionManager.session
      const inXRSession = this.state.xrHelper?.baseExperience?.sessionManager?.inXRSession || false
                
      if (session && inXRSession) {
        if (!this.state.isVRActive) {
          console.log('⚠️  Frame check: VR session active but isVRActive false - correcting')
          this.state.isVRActive = true
          this.onEnterVR()
        }
      } else {
        if (this.state.isVRActive) {
          console.log('⚠️  Frame check: No VR session but isVRActive true - correcting')
          this.state.isVRActive = false
          this.onExitVR()
        }
      }
    })
  }

  private setupControllerManagement(): void {
    if (!this.state.xrHelper?.input) return

    this.state.xrHelper.input.onControllerAddedObservable.add((controller) => {
      controller.onMotionControllerInitObservable.add((motionController) => {
        console.log('Controller connected:', motionController.handness)
        
        const controllerInfo: ControllerInfo = {
          handness: motionController.handness as 'left' | 'right',
          motionController,
          pointer: controller.pointer,
          grip: controller.grip
        }
        
        this.onControllerConnected?.(controllerInfo)
      })
    })
  }

  private setupVRFeatures(): void {
    if (!this.state.xrHelper?.baseExperience?.featuresManager) {
      console.log('❌ Features manager not available')
      return
    }

    console.log('🔧 Setting up VR features AFTER session start...')

    this.tryEnableHandTracking()
    this.tryEnablePointerSelection()

    console.log('🔧 VR features setup complete')
  }

  private tryEnableHandTracking(): void {
    try {
      console.log('🖐️  Attempting to enable hand tracking in VR session...')
      
      const handTrackingOptions = {
        disableHandMesh: true,
        useSimpleHandMesh: true,
        handMeshRiggingNeeded: false,
        enableHandMeshes: false
      }
      
      const handTrackingFeature = this.state.xrHelper?.baseExperience?.featuresManager?.enableFeature(
        'hand-tracking' as any,
        'latest',
        handTrackingOptions
      )
      
      if (handTrackingFeature) {
        console.log('✅ Hand tracking enabled successfully in VR session')
        this.setupHandTrackingObservables(handTrackingFeature)
      } else {
        console.log('⚠️  Hand tracking still not available in VR session')
      }
    } catch (handTrackingError) {
      console.log('⚠️  Hand tracking failed in VR session:', handTrackingError)
    }
  }

  private setupHandTrackingObservables(handFeature: any): void {
    try {
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
  }

  private tryEnablePointerSelection(): void {
    try {
      console.log('👆 Attempting to enable pointer selection in VR session (right controller only)...')
      
      const pointerFeature = this.state.xrHelper?.baseExperience?.featuresManager?.enableFeature(
        'pointer-selection' as any,
        'stable',
        { 
          xrInput: this.state.xrHelper?.input,
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
  }

  private tryInitialFeatureSetup(): void {
    console.log('🔄 Attempting initial feature setup (pre-VR session)...')
    
    // Features may not be available yet, will retry in VR session
    this.tryEnableHandTracking()
    this.tryEnablePointerSelection()

    console.log('🔄 Initial feature setup complete - errors are expected and will be retried')
  }

  public onEnterVR(): void {
    console.log('🥽 WebXRManager: Entering VR mode')
    this.onEnterVRCallback?.()
  }

  public onExitVR(): void {
    console.log('🖥️  WebXRManager: Exiting VR mode')
    this.onExitVRCallback?.()
  }

  public isVRActive(): boolean {
    return this.state.isVRActive
  }

  public getXRHelper(): WebXRDefaultExperience | null {
    return this.state.xrHelper
  }

  public isVRSupported(): boolean {
    return !!this.state.xrHelper
  }

  public async enterVR(): Promise<void> {
    if (this.state.xrHelper?.baseExperience) {
      try {
        await this.state.xrHelper.baseExperience.enterXRAsync('immersive-vr', 'local-floor')
      } catch (error) {
        console.error('Failed to enter VR:', error)
        throw error
      }
    } else {
      throw new Error('WebXR not initialized')
    }
  }

  public async exitVR(): Promise<void> {
    if (this.state.xrHelper?.baseExperience?.sessionManager?.session) {
      try {
        await this.state.xrHelper.baseExperience.sessionManager.exitXRAsync()
      } catch (error) {
        console.error('Failed to exit VR:', error)
        throw error
      }
    }
  }

  public setVREmulationMode(enabled: boolean): void {
    this.state.isVREmulationMode = enabled
    console.log(`VR emulation mode: ${enabled ? 'enabled' : 'disabled'}`)
  }

  public isVREmulationMode(): boolean {
    return this.state.isVREmulationMode
  }

  public triggerHapticFeedback(controllerId: string, intensity: number, duration: number): void {
    if (!this.isVRActive() || !this.state.xrHelper?.input) return

    try {
      this.state.xrHelper.input.controllers.forEach(controller => {
        if (controller.motionController && controller.uniqueId === controllerId) {
          const hapticComponent = controller.motionController.getComponent('haptic')
          if (hapticComponent) {
            (hapticComponent as any).pulse?.(intensity, duration)
          }
        }
      })
    } catch (error) {
      console.warn('Haptic feedback failed:', error)
    }
  }

  public triggerHapticFeedbackAll(intensity: number, duration: number): void {
    if (!this.isVRActive() || !this.state.xrHelper?.input) return

    try {
      this.state.xrHelper.input.controllers.forEach(controller => {
        if (controller.motionController) {
          const hapticComponent = controller.motionController.getComponent('haptic')
          if (hapticComponent) {
            (hapticComponent as any).pulse?.(intensity, duration)
          }
        }
      })
    } catch (error) {
      console.warn('Haptic feedback failed:', error)
    }
  }

  public dispose(): void {
    if (this.state.xrHelper) {
      this.state.xrHelper.dispose()
      this.state.xrHelper = null
    }
    
    this.state.isVRActive = false
    console.log('WebXRManager disposed')
  }
}