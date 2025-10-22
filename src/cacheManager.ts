// Cache Management System for Quest 3 VR Tour
import { PhotoDome } from '@babylonjs/core/Helpers/photoDome'
import type { Quest3Config } from './quest3Config'

export interface CachedPhotoDome {
  photoDome: PhotoDome
  isActive: boolean
  lastUsed: number
}

export class CacheManager {
  private cache = new Map<string, CachedPhotoDome>()
  private config: Quest3Config
  
  constructor(config: Quest3Config) {
    this.config = config
  }

  public set(key: string, photoDome: PhotoDome, isActive: boolean = false): void {
    this.cache.set(key, {
      photoDome,
      isActive,
      lastUsed: Date.now()
    })

    // Cleanup if needed
    if (this.cache.size > this.config.memory.cacheSize.cleanup) {
      this.cleanup()
    }
  }

  public get(key: string): CachedPhotoDome | undefined {
    const cached = this.cache.get(key)
    if (cached) {
      cached.lastUsed = Date.now()
    }
    return cached
  }

  public has(key: string): boolean {
    return this.cache.has(key)
  }

  public markActive(key: string): void {
    // Mark all as inactive first
    this.cache.forEach(cached => {
      cached.isActive = false
      if (cached.photoDome.mesh) {
        cached.photoDome.mesh.setEnabled(false)
      }
    })

    // Mark specified as active
    const cached = this.cache.get(key)
    if (cached) {
      cached.isActive = true
      cached.lastUsed = Date.now()
      if (cached.photoDome.mesh) {
        cached.photoDome.mesh.setEnabled(true)
      }
    }
  }

  public cleanup(): void {
    if (this.cache.size <= this.config.memory.cacheSize.max) {
      return
    }

    console.log(`Cache cleanup: ${this.cache.size} entries, target: ${this.config.memory.cacheSize.max}`)

    // Sort by last used time (oldest first)
    const cacheEntries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

    // Remove oldest entries, but never remove the currently active one
    const entriesToRemove = cacheEntries.slice(0, this.cache.size - this.config.memory.cacheSize.max)
    
    for (const [key, cachedDome] of entriesToRemove) {
      if (!cachedDome.isActive) {
        console.log(`Removing cached panorama: ${key}`)
        this.disposePanoramaResources(cachedDome.photoDome)
        this.cache.delete(key)
      }
    }

    console.log(`Cache cleanup complete: ${this.cache.size} entries remaining`)
  }

  public aggressiveCleanup(): void {
    console.log('Performing aggressive cache cleanup for Quest 3')
    
    // Remove all inactive panoramas
    for (const [key, cachedDome] of this.cache.entries()) {
      if (!cachedDome.isActive) {
        this.disposePanoramaResources(cachedDome.photoDome)
        this.cache.delete(key)
      }
    }

    console.log(`Aggressive cleanup complete: ${this.cache.size} panoramas remaining`)
  }

  public clear(): void {
    // Dispose all cached panoramas
    for (const cachedDome of this.cache.values()) {
      this.disposePanoramaResources(cachedDome.photoDome)
    }
    this.cache.clear()
    console.log('Cache completely cleared')
  }

  public getSize(): number {
    return this.cache.size
  }

  public getStats(): { total: number; active: number; inactive: number } {
    let active = 0
    let inactive = 0
    
    for (const cached of this.cache.values()) {
      if (cached.isActive) {
        active++
      } else {
        inactive++
      }
    }

    return {
      total: this.cache.size,
      active,
      inactive
    }
  }

  private disposePanoramaResources(photoDome: PhotoDome): void {
    try {
      // Dispose textures properly to free VRAM on Quest 3
      if (photoDome.material && photoDome.material.diffuseTexture) {
        const texture = photoDome.material.diffuseTexture
        texture.dispose()
      }

      // Dispose material
      if (photoDome.material) {
        photoDome.material.dispose()
      }

      // Dispose mesh and its vertex/index buffers
      if (photoDome.mesh) {
        photoDome.mesh.dispose()
      }

      // Finally dispose the photodome itself
      photoDome.dispose()
      
      console.log('WebGL resources properly disposed for Quest 3')
    } catch (error) {
      console.warn('Error during resource disposal:', error)
    }
  }
}