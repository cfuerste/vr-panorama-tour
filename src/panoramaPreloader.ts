interface CachedImage {
  blob: Blob
  objectUrl?: string
}

// Store compressed downloads only. Fetch is asynchronous; no worker-side copy
// or decoded image cache is needed. The viewer owns GPU textures separately.
export class PanoramaPreloader {
  private images = new Map<string, CachedImage>()
  private bytes = 0
  private background: AbortController | null = null
  private requests = new Set<AbortController>()
  private disposed = false
  private progress = { loaded: 0, total: 0 }

  private readonly maxBytes: number
  private readonly maxEntries: number

  constructor(maxBytes = 24 * 1024 * 1024, maxEntries = 12) {
    this.maxBytes = maxBytes
    this.maxEntries = maxEntries
  }

  private normalize(url: string, basePath = ''): string {
    return new URL(url, new URL(basePath || '.', document.baseURI)).href
  }

  private touch(url: string): CachedImage | undefined {
    const entry = this.images.get(url)
    if (entry) {
      this.images.delete(url)
      this.images.set(url, entry)
    }
    return entry
  }

  public async loadImage(url: string, signal?: AbortSignal): Promise<Blob> {
    if (this.disposed) throw new Error('Panorama preloader disposed')
    signal?.throwIfAborted()
    const key = this.normalize(url)
    const cached = this.touch(key)
    if (cached) return cached.blob
    const request = new AbortController()
    const abort = () => request.abort()
    signal?.addEventListener('abort', abort, { once: true })
    this.requests.add(request)
    const timeout = setTimeout(abort, 45000)
    try {
      const response = await fetch(key, { signal: request.signal })
      if (!response.ok) throw new Error(`Panorama HTTP ${response.status}: ${key}`)
      const blob = await response.blob()
      request.signal.throwIfAborted()
      if (blob.size <= this.maxBytes && this.maxEntries > 0) {
        this.remove(key)
        while (this.images.size && (this.bytes + blob.size > this.maxBytes || this.images.size >= this.maxEntries)) {
          this.remove(this.images.keys().next().value!)
        }
        this.images.set(key, { blob })
        this.bytes += blob.size
      }
      return blob
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      this.requests.delete(request)
    }
  }

  private remove(key: string): void {
    const entry = this.images.get(key)
    if (!entry) return
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl)
    this.bytes -= entry.blob.size
    this.images.delete(key)
  }

  public stopPreloading(): void {
    this.background?.abort()
    this.background = null
  }

  public startPreloading(
    imageUrls: string[], basePath: string,
    onProgress?: (progress: number, total: number) => void,
    onComplete?: () => void
  ): void {
    this.stopPreloading()
    if (this.disposed) return
    const controller = new AbortController()
    this.background = controller
    const urls = [...new Set(imageUrls.map(url => this.normalize(url, basePath)))]
    this.progress = { loaded: 0, total: urls.length }
    void (async () => {
      try {
        // One speculative download at a time, cancelled when navigation starts.
        for (const url of urls) {
          controller.signal.throwIfAborted()
          try {
            await this.loadImage(url, controller.signal)
            controller.signal.throwIfAborted()
            this.progress.loaded++
            onProgress?.(this.progress.loaded, urls.length)
          } catch (error) {
            if (controller.signal.aborted) return
            console.warn('Panorama prefetch failed:', url, error)
          }
        }
        onComplete?.()
      } finally {
        if (this.background === controller) this.background = null
      }
    })().catch(error => {
      if (!controller.signal.aborted) console.warn('Panorama prefetch failed:', error)
    })
  }

  public getPreloadedImage(url: string): string | null {
    const entry = this.touch(this.normalize(url))
    if (!entry) return null
    entry.objectUrl ??= URL.createObjectURL(entry.blob)
    return entry.objectUrl
  }

  public isImagePreloaded(url: string): boolean {
    return this.images.has(this.normalize(url))
  }

  public getPreloadProgress(): { loaded: number; total: number } {
    return { ...this.progress }
  }

  public getCacheStats(): { bytes: number; entries: number } {
    return { bytes: this.bytes, entries: this.images.size }
  }

  public dispose(): void {
    this.disposed = true
    this.stopPreloading()
    for (const request of this.requests) request.abort()
    for (const key of this.images.keys()) this.remove(key)
  }
}
