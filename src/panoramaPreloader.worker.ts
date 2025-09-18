// Web Worker for preloading panorama images
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

// Cache for loaded images
const imageCache = new Map<string, ArrayBuffer>()

self.addEventListener('message', async (event: MessageEvent<PreloadRequest>) => {
  const { data } = event

  if (data.type === 'PRELOAD_IMAGES') {
    await preloadImages(data.images, data.basePath)
  }
})

async function preloadImages(imageUrls: string[], basePath: string) {
  const total = imageUrls.length
  let completed = 0

  console.log(`[Worker] Starting preload of ${total} images`)

  for (const imageUrl of imageUrls) {
    try {
      const fullUrl = `${basePath}${imageUrl}`
      
      // Skip if already cached
      if (imageCache.has(fullUrl)) {
        completed++
        postMessage({
          type: 'PRELOAD_PROGRESS',
          imageUrl: fullUrl,
          progress: completed,
          total
        } as PreloadResponse)
        continue
      }

      console.log(`[Worker] Preloading: ${fullUrl}`)
      
      // Fetch the image
      const response = await fetch(fullUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch ${fullUrl}: ${response.status}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      
      // Cache the image data
      imageCache.set(fullUrl, arrayBuffer)
      
      completed++

      // Send progress update
      postMessage({
        type: 'PRELOAD_PROGRESS',
        imageUrl: fullUrl,
        imageData: arrayBuffer,
        progress: completed,
        total
      } as PreloadResponse)

    } catch (error) {
      console.error(`[Worker] Failed to preload ${imageUrl}:`, error)
      
      postMessage({
        type: 'PRELOAD_ERROR',
        imageUrl: imageUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      } as PreloadResponse)
    }
  }

  console.log(`[Worker] Preload complete: ${completed}/${total} images`)
  
  postMessage({
    type: 'PRELOAD_COMPLETE',
    progress: completed,
    total
  } as PreloadResponse)
}

// Export type for TypeScript
export type { PreloadRequest, PreloadResponse }