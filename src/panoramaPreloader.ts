// Panorama Preloader Manager
interface PreloadedImage {
  url: string
  data: ArrayBuffer
  objectUrl?: string
}

interface PreloadRequest {
  type: 'PRELOAD_IMAGES'
  images: string[]
  basePath: string
}

interface PreloadResponse {
  type: 'PRELOAD_COMPLETE' | 'PRELOAD_PROGRESS' | 'PRELOAD_ERROR'
  imageUrl?: string
  imageData?: ArrayBuffer
  error?: string
  progress?: number
  total?: number
}

export class PanoramaPreloader {
  private worker: Worker
  private workerBlobUrl: string
  private preloadedImages = new Map<string, PreloadedImage>()
  private onProgressCallback?: (progress: number, total: number) => void
  private onCompleteCallback?: () => void

  constructor() {
    // Create worker inline to avoid import.meta.url issues in GitHub Actions
    const workerScript = `
      // Cache for loaded images
      const imageCache = new Map();

      self.addEventListener('message', async (event) => {
        const { data } = event;

        if (data.type === 'PRELOAD_IMAGES') {
          await preloadImages(data.images, data.basePath);
        }
      });

      async function preloadImages(imageUrls, basePath) {
        const total = imageUrls.length;
        let completed = 0;

        console.log('[Worker] Starting preload of ' + total + ' images');

        for (const imageUrl of imageUrls) {
          try {
            const fullUrl = basePath + imageUrl;
            
            // Skip if already cached
            if (imageCache.has(fullUrl)) {
              completed++;
              postMessage({
                type: 'PRELOAD_PROGRESS',
                imageUrl: fullUrl,
                progress: completed,
                total
              });
              continue;
            }

            console.log('[Worker] Preloading: ' + fullUrl);
            
            // Fetch the image
            const response = await fetch(fullUrl);
            if (!response.ok) {
              throw new Error('Failed to fetch ' + fullUrl + ': ' + response.status);
            }

            const arrayBuffer = await response.arrayBuffer();
            
            // Cache the image data
            imageCache.set(fullUrl, arrayBuffer);
            
            completed++;

            // Send progress update
            postMessage({
              type: 'PRELOAD_PROGRESS',
              imageUrl: fullUrl,
              imageData: arrayBuffer,
              progress: completed,
              total
            });

          } catch (error) {
            console.error('[Worker] Failed to preload ' + imageUrl + ':', error);
            
            postMessage({
              type: 'PRELOAD_ERROR',
              imageUrl: imageUrl,
              error: error.message || 'Unknown error'
            });
          }
        }

        console.log('[Worker] Preload complete: ' + completed + '/' + total + ' images');
        
        postMessage({
          type: 'PRELOAD_COMPLETE',
          progress: completed,
          total
        });
      }
    `;

    const blob = new Blob([workerScript], { type: 'application/javascript' });
    this.workerBlobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.workerBlobUrl);

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
    URL.revokeObjectURL(this.workerBlobUrl)
  }
}