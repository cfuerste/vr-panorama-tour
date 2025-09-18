// Panorama Preloader Manager
import type { PreloadRequest, PreloadResponse } from './panoramaPreloader.worker'

interface PreloadedImage {
  url: string
  data: ArrayBuffer
  objectUrl?: string
}

export class PanoramaPreloader {
  private worker: Worker
  private preloadedImages = new Map<string, PreloadedImage>()
  private onProgressCallback?: (progress: number, total: number) => void
  private onCompleteCallback?: () => void

  constructor() {
    // Create worker from the worker file
    this.worker = new Worker(
      new URL('./panoramaPreloader.worker.ts', import.meta.url),
      { type: 'module' }
    )

    this.worker.addEventListener('message', this.handleWorkerMessage.bind(this))
    this.worker.addEventListener('error', this.handleWorkerError.bind(this))
  }

  private handleWorkerMessage(event: MessageEvent<PreloadResponse>) {
    const { data } = event

    switch (data.type) {
      case 'PRELOAD_PROGRESS':
        if (data.imageUrl && data.imageData) {
          // Create object URL for immediate use
          const blob = new Blob([data.imageData])
          const objectUrl = URL.createObjectURL(blob)
          
          this.preloadedImages.set(data.imageUrl, {
            url: data.imageUrl,
            data: data.imageData,
            objectUrl
          })

          console.log(`Preloaded: ${data.imageUrl}`)
        }

        if (this.onProgressCallback && data.progress !== undefined && data.total !== undefined) {
          this.onProgressCallback(data.progress, data.total)
        }
        break

      case 'PRELOAD_COMPLETE':
        console.log('All panoramas preloaded!')
        if (this.onCompleteCallback) {
          this.onCompleteCallback()
        }
        break

      case 'PRELOAD_ERROR':
        console.error(`Preload error for ${data.imageUrl}:`, data.error)
        break
    }
  }

  private handleWorkerError(error: ErrorEvent) {
    console.error('Worker error:', error)
  }

  public startPreloading(
    imageUrls: string[], 
    basePath: string,
    onProgress?: (progress: number, total: number) => void,
    onComplete?: () => void
  ) {
    this.onProgressCallback = onProgress
    this.onCompleteCallback = onComplete

    const message: PreloadRequest = {
      type: 'PRELOAD_IMAGES',
      images: imageUrls,
      basePath
    }

    this.worker.postMessage(message)
  }

  public getPreloadedImage(url: string): string | null {
    const preloaded = this.preloadedImages.get(url)
    return preloaded?.objectUrl || null
  }

  public isImagePreloaded(url: string): boolean {
    return this.preloadedImages.has(url)
  }

  public getPreloadProgress(): { loaded: number; total: number } {
    return {
      loaded: this.preloadedImages.size,
      total: this.preloadedImages.size // This would need to be tracked differently for accurate total
    }
  }

  public dispose() {
    // Clean up object URLs
    for (const image of this.preloadedImages.values()) {
      if (image.objectUrl) {
        URL.revokeObjectURL(image.objectUrl)
      }
    }
    
    this.preloadedImages.clear()
    this.worker.terminate()
  }
}