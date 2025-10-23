// Render Engine Module - Handles adaptive rendering, performance optimization, and Quest 3-specific optimizations
import type { 
  RenderingState,
  MemoryState,
  IRenderEngine,
  ModuleOptions,
  CoreRefs,
  UserInteractionCallback,
  TextureQuality
} from '../types'

import type { Quest3Config } from '../quest3Config'

export class RenderEngine implements IRenderEngine {
  private coreRefs: CoreRefs
  private config: Quest3Config
  private renderingState: RenderingState
  private memoryState: MemoryState
  
  // Callbacks
  private onUserInteraction?: UserInteractionCallback
  private onMemoryPressure?: (usage: number) => void
  private onContextLost?: () => void
  private onContextRestored?: () => void

  // WebGL error handling
  private contextLostCount = 0
  private maxContextLossRecoveryAttempts = 3

  constructor(options: ModuleOptions & {
    onUserInteraction?: UserInteractionCallback
    onMemoryPressure?: (usage: number) => void
    onContextLost?: () => void
    onContextRestored?: () => void
  }) {
    this.coreRefs = options.coreRefs
    this.config = options.config
    this.onUserInteraction = options.onUserInteraction
    this.onMemoryPressure = options.onMemoryPressure
    this.onContextLost = options.onContextLost
    this.onContextRestored = options.onContextRestored

    this.renderingState = {
      needsRender: true,
      targetFrameRate: this.config.targetFrameRate.desktop,
      lastFrameTime: 0,
      frameTimeThreshold: 1000 / this.config.targetFrameRate.desktop,
      isIdle: false,
      lastUserInteraction: Date.now(),
      renderRequestId: null
    }

    this.memoryState = {
      currentTextureQuality: 'std',
      lastMemoryCheck: 0,
      lastUIUpdate: 0
    }

    this.setupWebGLErrorHandling()
    this.setupUserInteractionTracking()
  }

  public startAdaptiveRenderLoop(): void {
    const render = (currentTime: number) => {
      const deltaTime = currentTime - this.renderingState.lastFrameTime

      // Check if enough time has passed for target frame rate
      if (deltaTime >= this.renderingState.frameTimeThreshold) {
        // Update user interaction detection
        this.updateIdleState()

        // Only render if changes occurred or forced
        if (this.renderingState.needsRender || this.isVRActive()) {
          this.coreRefs.scene.render()
          this.renderingState.needsRender = false
        }

        // Update UI less frequently to improve performance
        if (currentTime - this.memoryState.lastUIUpdate > this.config.energy.uiUpdateInterval) {
          this.updateUIElements(currentTime)
          this.memoryState.lastUIUpdate = currentTime
        }

        // Check memory usage periodically for Quest 3 optimization
        if (currentTime - this.memoryState.lastMemoryCheck > this.config.memory.checkInterval) {
          this.checkMemoryPressure()
          this.memoryState.lastMemoryCheck = currentTime
        }

        this.renderingState.lastFrameTime = currentTime
        this.adjustFrameRate()
      }

      // Schedule next frame
      this.renderingState.renderRequestId = requestAnimationFrame(render)
    }

    this.renderingState.renderRequestId = requestAnimationFrame(render)
    console.log(`Started adaptive render loop - Target: ${this.renderingState.targetFrameRate}fps for Quest 3`)
  }

  public requestRender(): void {
    this.renderingState.needsRender = true
  }

  public markUserInteraction(): void {
    this.renderingState.lastUserInteraction = Date.now()
    this.requestRender()
    if (this.renderingState.isIdle) {
      this.updateIdleState()
    }
    this.onUserInteraction?.()
  }

  private updateIdleState(): void {
    const now = Date.now()
    const timeSinceInteraction = now - this.renderingState.lastUserInteraction

    if (timeSinceInteraction > this.config.energy.idleTimeout && !this.renderingState.isIdle) {
      this.renderingState.isIdle = true
      this.renderingState.targetFrameRate = this.config.targetFrameRate.idle
      this.renderingState.frameTimeThreshold = 1000 / this.renderingState.targetFrameRate
      console.log(`Quest 3 entered idle mode - Frame rate reduced to ${this.renderingState.targetFrameRate}fps`)
    } else if (timeSinceInteraction <= this.config.energy.idleTimeout && this.renderingState.isIdle) {
      this.renderingState.isIdle = false
      this.renderingState.targetFrameRate = this.isVRActive() ? this.config.targetFrameRate.vr : this.config.targetFrameRate.desktop
      this.renderingState.frameTimeThreshold = 1000 / this.renderingState.targetFrameRate
      console.log(`Quest 3 exited idle mode - Frame rate restored to ${this.renderingState.targetFrameRate}fps`)
    }
  }

  private adjustFrameRate(): void {
    const baseRate = this.isVRActive() ? this.config.targetFrameRate.vr : this.config.targetFrameRate.desktop
    const newTargetFrameRate = this.renderingState.isIdle ? this.config.targetFrameRate.idle : baseRate
    
    if (newTargetFrameRate !== this.renderingState.targetFrameRate) {
      this.renderingState.targetFrameRate = newTargetFrameRate
      this.renderingState.frameTimeThreshold = 1000 / this.renderingState.targetFrameRate
      console.log(`Frame rate adjusted for Quest 3: ${this.renderingState.targetFrameRate}fps (VR: ${this.isVRActive()}, Idle: ${this.renderingState.isIdle})`)
    }
  }

  public checkMemoryPressure(): void {
    try {
      const memInfo = (performance as any).memory
      if (memInfo) {
        const memoryUsage = memInfo.usedJSHeapSize / memInfo.totalJSHeapSize
        
        if (memoryUsage > this.config.memory.pressureThreshold) {
          console.warn(`Quest 3 memory pressure detected: ${(memoryUsage * 100).toFixed(1)}%`)
          this.handleMemoryPressure(memoryUsage)
        } else if (memoryUsage < this.config.memory.pressureThreshold - 0.2 && this.memoryState.currentTextureQuality === 'mobile') {
          this.increaseTextureQuality()
        }
      }
    } catch (error) {
      console.warn('Memory pressure check failed:', error)
    }
  }

  public handleMemoryPressure(memoryUsage: number): void {
    console.log(`Handling Quest 3 memory pressure: ${(memoryUsage * 100).toFixed(1)}%`)

    // Step 1: Reduce texture quality
    if (this.memoryState.currentTextureQuality !== 'mobile') {
      this.reduceTextureQuality()
    }

    // Step 2: Force garbage collection if available
    if (memoryUsage > 0.9 && typeof (window as any).gc === 'function') {
      (window as any).gc()
      console.log('Forced garbage collection for Quest 3')
    }

    // Notify callback
    this.onMemoryPressure?.(memoryUsage)
  }

  private reduceTextureQuality(): void {
    const oldQuality = this.memoryState.currentTextureQuality
    
    if (this.memoryState.currentTextureQuality === 'hq') {
      this.memoryState.currentTextureQuality = 'std'
    } else if (this.memoryState.currentTextureQuality === 'std') {
      this.memoryState.currentTextureQuality = 'mobile'
    }

    if (oldQuality !== this.memoryState.currentTextureQuality) {
      console.log(`Quest 3 texture quality reduced: ${oldQuality} → ${this.memoryState.currentTextureQuality}`)
    }
  }

  private increaseTextureQuality(): void {
    const oldQuality = this.memoryState.currentTextureQuality
    
    if (this.memoryState.currentTextureQuality === 'mobile') {
      this.memoryState.currentTextureQuality = 'std'
    } else if (this.memoryState.currentTextureQuality === 'std' && this.isVRActive()) {
      this.memoryState.currentTextureQuality = 'hq'
    }

    if (oldQuality !== this.memoryState.currentTextureQuality) {
      console.log(`Quest 3 texture quality increased: ${oldQuality} → ${this.memoryState.currentTextureQuality}`)
    }
  }

  private updateUIElements(_currentTime: number): void {
    // Placeholder for UI update logic that would be handled by UIManager
    // This would call specific UI update methods as needed
    this.requestRender()
  }

  private setupWebGLErrorHandling(): void {
    const gl = this.coreRefs.engine._gl
    if (!gl) return

    console.log('Setting up WebGL error handling for Quest 3')

    // Enhanced context loss handling
    this.coreRefs.engine.onContextLostObservable.add(() => {
      this.contextLostCount++
      console.warn(`WebGL context lost (attempt ${this.contextLostCount}/${this.maxContextLossRecoveryAttempts})`)
      
      if (this.contextLostCount <= this.maxContextLossRecoveryAttempts) {
        console.log('Attempting context recovery for Quest 3')
        this.onContextLost?.()
      } else {
        console.error('Maximum context loss recovery attempts exceeded')
      }
    })

    this.coreRefs.engine.onContextRestoredObservable.add(() => {
      console.log('WebGL context restored - reinitializing resources')
      this.onContextRestored?.()
    })

    // Periodic WebGL error checking
    setInterval(() => {
      if (this.coreRefs.engine.isDisposed) return
      this.checkWebGLError('periodic check')
    }, this.config.webgl.errorCheckInterval)
  }

  private checkWebGLError(operation: string): boolean {
    const gl = this.coreRefs.engine._gl
    if (!gl) return false

    const error = gl.getError()
    if (error !== gl.NO_ERROR) {
      console.warn(`WebGL error after ${operation}:`, this.getWebGLErrorName(error))
      
      // Don't attempt recovery for common/harmless errors
      if (error === gl.INVALID_FRAMEBUFFER_OPERATION || error === gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT) {
        return false
      }
      
      return true // Critical error
    }
    return false
  }

  private getWebGLErrorName(error: number): string {
    const gl = this.coreRefs.engine._gl
    if (!gl) return `Unknown error: ${error}`

    const errorNames: { [key: number]: string } = {
      [gl.NO_ERROR]: 'NO_ERROR',
      [gl.INVALID_ENUM]: 'INVALID_ENUM',
      [gl.INVALID_VALUE]: 'INVALID_VALUE',
      [gl.INVALID_OPERATION]: 'INVALID_OPERATION',
      [gl.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
      [gl.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
      [gl.CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST_WEBGL'
    }

    return errorNames[error] || `Unknown error: ${error}`
  }

  private setupUserInteractionTracking(): void {
    // Track various user interactions for idle detection
    const events = ['pointerdown', 'pointermove', 'wheel', 'keydown']
    
    events.forEach(eventType => {
      document.addEventListener(eventType, () => this.markUserInteraction())
    })
  }

  private isVRActive(): boolean {
    // This would be provided by the WebXR manager
    // For now, return false as default
    return false
  }

  // Getters for state information
  public getCurrentTextureQuality(): TextureQuality {
    return this.memoryState.currentTextureQuality
  }

  public setTextureQuality(quality: TextureQuality): void {
    this.memoryState.currentTextureQuality = quality
  }

  public getTargetFrameRate(): number {
    return this.renderingState.targetFrameRate
  }

  public isIdle(): boolean {
    return this.renderingState.isIdle
  }

  public needsRender(): boolean {
    return this.renderingState.needsRender
  }

  public setVRActive(isActive: boolean): void {
    // Update frame rate when VR state changes
    const newFrameRate = isActive ? this.config.targetFrameRate.vr : this.config.targetFrameRate.desktop
    if (!this.renderingState.isIdle && newFrameRate !== this.renderingState.targetFrameRate) {
      this.renderingState.targetFrameRate = newFrameRate
      this.renderingState.frameTimeThreshold = 1000 / this.renderingState.targetFrameRate
      console.log(`Frame rate updated for VR state change: ${this.renderingState.targetFrameRate}fps`)
    }
  }

  public getPerformanceStats(): {
    targetFrameRate: number
    currentTextureQuality: TextureQuality
    isIdle: boolean
    memoryCheckInterval: number
    contextLossCount: number
  } {
    return {
      targetFrameRate: this.renderingState.targetFrameRate,
      currentTextureQuality: this.memoryState.currentTextureQuality,
      isIdle: this.renderingState.isIdle,
      memoryCheckInterval: this.config.memory.checkInterval,
      contextLossCount: this.contextLostCount
    }
  }

  public dispose(): void {
    // Stop render loop
    if (this.renderingState.renderRequestId) {
      cancelAnimationFrame(this.renderingState.renderRequestId)
      this.renderingState.renderRequestId = null
    }

    console.log('RenderEngine disposed')
  }
}