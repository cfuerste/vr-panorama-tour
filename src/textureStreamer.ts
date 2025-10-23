// Texture Streaming System for Quest 3 Optimization
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Scene } from '@babylonjs/core/scene'

interface StreamingTexture {
  baseTexture: Texture | null
  highResTexture: Texture | null
  isLoading: boolean
  loadStartTime: number
  priority: number
}

interface TextureRequest {
  url: string
  quality: 'mobile' | 'std' | 'hq'
  priority: number
  callback: (texture: Texture) => void
}

export class TextureStreamer {
  private scene: Scene
  private streamingTextures = new Map<string, StreamingTexture>()
  private loadQueue: TextureRequest[] = []
  private activeLoads = 0
  private maxConcurrentLoads = 2 // Limit for Quest 3
  private loadTimeout = 10000 // 10 second timeout

  constructor(scene: Scene) {
    this.scene = scene
  }

  /**
   * Load texture with progressive enhancement
   * First loads low-res version, then upgrades to high-res
   */
  public streamTexture(
    baseUrl: string,
    targetQuality: 'mobile' | 'std' | 'hq',
    priority: number = 1
  ): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const cacheKey = `${baseUrl}_${targetQuality}`
      
      // Check if already cached
      const existing = this.streamingTextures.get(cacheKey)
      if (existing?.highResTexture) {
        resolve(existing.highResTexture)
        return
      }

      // Start with base quality texture for immediate display
      this.loadBaseTexture(baseUrl, targetQuality, priority)
        .then(baseTexture => {
          // Return base texture immediately for display
          resolve(baseTexture)
          
          // Queue high-res version for background loading
          if (targetQuality !== 'mobile') {
            this.queueHighResTexture(baseUrl, targetQuality, priority, baseTexture)
          }
        })
        .catch(reject)
    })
  }

  private async loadBaseTexture(
    baseUrl: string,
    targetQuality: 'mobile' | 'std' | 'hq',
    priority: number
  ): Promise<Texture> {
    // Always start with mobile quality for instant display
    const mobileUrl = baseUrl.replace(/\.(jpg|jpeg)$/, '_mobile.jpg')
    const cacheKey = `${baseUrl}_${targetQuality}`
    
    try {
      const texture = new Texture(mobileUrl, this.scene, false, false)
      texture.wrapU = Texture.CLAMP_ADDRESSMODE
      texture.wrapV = Texture.CLAMP_ADDRESSMODE
      
      // Store in streaming cache
      this.streamingTextures.set(cacheKey, {
        baseTexture: texture,
        highResTexture: null,
        isLoading: false,
        loadStartTime: Date.now(),
        priority
      })

      return texture
    } catch (error) {
      console.error('Failed to load base texture:', mobileUrl, error)
      throw error
    }
  }

  private queueHighResTexture(
    baseUrl: string,
    targetQuality: 'mobile' | 'std' | 'hq',
    priority: number,
    baseTexture: Texture
  ): void {
    const suffix = targetQuality === 'hq' ? '_hq.jpg' : '_std.jpg'
    const highResUrl = baseUrl.replace(/\.(jpg|jpeg)$/, suffix)
    
    const request: TextureRequest = {
      url: highResUrl,
      quality: targetQuality,
      priority,
      callback: (highResTexture) => {
        this.upgradeTexture(baseUrl, targetQuality, baseTexture, highResTexture)
      }
    }

    // Insert in priority order
    let insertIndex = this.loadQueue.length
    for (let i = 0; i < this.loadQueue.length; i++) {
      if (this.loadQueue[i].priority < priority) {
        insertIndex = i
        break
      }
    }
    
    this.loadQueue.splice(insertIndex, 0, request)
    this.processLoadQueue()
  }

  private async processLoadQueue(): Promise<void> {
    if (this.activeLoads >= this.maxConcurrentLoads || this.loadQueue.length === 0) {
      return
    }

    const request = this.loadQueue.shift()!
    this.activeLoads++

    try {
      console.log(`Loading high-res texture: ${request.url} (Priority: ${request.priority})`)
      
      // Load with timeout for Quest 3 stability
      const texture = await this.loadTextureWithTimeout(request.url, this.loadTimeout)
      request.callback(texture)
      
    } catch (error) {
      console.warn(`Failed to load high-res texture ${request.url}:`, error)
    } finally {
      this.activeLoads--
      // Process next item in queue
      setTimeout(() => this.processLoadQueue(), 100)
    }
  }

  private loadTextureWithTimeout(url: string, timeout: number): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const texture = new Texture(url, this.scene, false, false)
      let resolved = false

      // Success callback
      texture.onLoadObservable.addOnce(() => {
        if (!resolved) {
          resolved = true
          texture.wrapU = Texture.CLAMP_ADDRESSMODE
          texture.wrapV = Texture.CLAMP_ADDRESSMODE
          resolve(texture)
        }
      })

      // Error handling - check if texture failed to load after a short delay
      setTimeout(() => {
        if (!resolved && texture.isReady && texture.isReady() === false) {
          resolved = true
          reject(new Error(`Failed to load texture: ${url}`))
        }
      }, 1000)

      // Timeout fallback
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          texture.dispose()
          reject(new Error(`Texture load timeout: ${url}`))
        }
      }, timeout)
    })
  }

  private upgradeTexture(
    baseUrl: string,
    targetQuality: 'mobile' | 'std' | 'hq',
    baseTexture: Texture,
    highResTexture: Texture
  ): void {
    const cacheKey = `${baseUrl}_${targetQuality}`
    const streamingTexture = this.streamingTextures.get(cacheKey)
    
    if (streamingTexture) {
      streamingTexture.highResTexture = highResTexture
      console.log(`Texture upgraded: ${baseUrl} -> ${targetQuality}`)
      
      // Notify that high-res version is ready
      this.onTextureUpgraded(baseTexture, highResTexture)
    }
  }

  private onTextureUpgraded(baseTexture: Texture, highResTexture: Texture): void {
    // Find materials using the base texture and upgrade them
    this.scene.materials.forEach(material => {
      if ((material as any).diffuseTexture === baseTexture) {
        console.log('Upgrading material texture to high-res')
        ;(material as any).diffuseTexture = highResTexture
        
        // Dispose old texture after a delay to ensure smooth transition
        setTimeout(() => {
          try {
            baseTexture.dispose()
          } catch (e) {
            // Texture might already be disposed
          }
        }, 1000)
      }
    })
  }

  /**
   * Get current texture for a given URL and quality
   */
  public getCurrentTexture(baseUrl: string, targetQuality: 'mobile' | 'std' | 'hq'): Texture | null {
    const cacheKey = `${baseUrl}_${targetQuality}`
    const streamingTexture = this.streamingTextures.get(cacheKey)
    
    // Return high-res if available, otherwise base texture
    return streamingTexture?.highResTexture || streamingTexture?.baseTexture || null
  }

  /**
   * Check if high-res version is available
   */
  public hasHighResVersion(baseUrl: string, targetQuality: 'mobile' | 'std' | 'hq'): boolean {
    const cacheKey = `${baseUrl}_${targetQuality}`
    return !!this.streamingTextures.get(cacheKey)?.highResTexture
  }

  /**
   * Clear unused textures to free memory
   */
  public cleanup(): void {
    const now = Date.now()
    const maxAge = 5 * 60 * 1000 // 5 minutes

    for (const [key, streamingTexture] of this.streamingTextures.entries()) {
      if (now - streamingTexture.loadStartTime > maxAge) {
        // Dispose textures safely
        try {
          if (streamingTexture.baseTexture) {
            streamingTexture.baseTexture.dispose()
          }
          if (streamingTexture.highResTexture) {
            streamingTexture.highResTexture.dispose()
          }
        } catch (e) {
          // Texture might already be disposed
        }
        
        this.streamingTextures.delete(key)
        console.log(`Cleaned up old streaming texture: ${key}`)
      }
    }
  }

  /**
   * Dispose all textures and clear cache
   */
  public dispose(): void {
    // Clear load queue
    this.loadQueue = []
    
    // Dispose all textures safely
    for (const streamingTexture of this.streamingTextures.values()) {
      try {
        if (streamingTexture.baseTexture) {
          streamingTexture.baseTexture.dispose()
        }
        if (streamingTexture.highResTexture) {
          streamingTexture.highResTexture.dispose()
        }
      } catch (e) {
        // Texture might already be disposed
      }
    }
    
    this.streamingTextures.clear()
    console.log('TextureStreamer disposed')
  }
}