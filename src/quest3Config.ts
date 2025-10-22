// Quest 3 VR Tour Configuration
export interface Quest3Config {
  // Performance Settings
  targetFrameRate: {
    vr: number
    desktop: number
    idle: number
  }
  
  // Memory Management
  memory: {
    pressureThreshold: number
    cacheSize: {
      max: number
      cleanup: number
    }
    checkInterval: number
  }
  
  // Texture Quality
  textureQuality: {
    mobile: string
    standard: string
    highQuality: string
  }
  
  // Energy Optimization
  energy: {
    idleTimeout: number
    uiUpdateInterval: number
    memoryCheckInterval: number
  }
  
  // WebGL Settings
  webgl: {
    maxContextLossRecovery: number
    errorCheckInterval: number
  }
}

export const QUEST3_CONFIG: Quest3Config = {
  targetFrameRate: {
    vr: 72,      // Quest 3 native refresh rate
    desktop: 60, // Standard desktop
    idle: 36     // Energy saving when idle
  },
  
  memory: {
    pressureThreshold: 0.8, // 80% memory usage threshold
    cacheSize: {
      max: 10,        // Maximum cached panoramas
      cleanup: 15     // Start cleanup at this size
    },
    checkInterval: 10000 // Check every 10 seconds
  },
  
  textureQuality: {
    mobile: '_mobile.jpg',    // 2K resolution
    standard: '_std.jpg',     // 4K resolution
    highQuality: '_hq.jpg'    // 6K+ resolution
  },
  
  energy: {
    idleTimeout: 5000,      // 5 seconds until idle
    uiUpdateInterval: 100,  // Update UI every 100ms
    memoryCheckInterval: 10000 // Check memory every 10s
  },
  
  webgl: {
    maxContextLossRecovery: 3, // Maximum recovery attempts
    errorCheckInterval: 5000   // Check errors every 5s
  }
}

// Device Detection
export function isQuest3(): boolean {
  const userAgent = navigator.userAgent.toLowerCase()
  return userAgent.includes('quest') || 
         (userAgent.includes('oculus') && userAgent.includes('mobile'))
}

// Performance Profile Detection
export function getPerformanceProfile(): 'low' | 'medium' | 'high' {
  // Estimate device performance based on available information
  const memory = (navigator as any).deviceMemory || 4
  const cores = navigator.hardwareConcurrency || 4
  
  if (memory >= 8 && cores >= 8) return 'high'
  if (memory >= 4 && cores >= 4) return 'medium'
  return 'low'
}

// Adaptive Configuration
export function getAdaptiveConfig(): Quest3Config {
  const profile = getPerformanceProfile()
  const config = { ...QUEST3_CONFIG }
  
  switch (profile) {
    case 'low':
      config.memory.cacheSize.max = 5
      config.targetFrameRate.vr = 60
      config.energy.idleTimeout = 3000
      break
    case 'medium':
      config.memory.cacheSize.max = 8
      break
    case 'high':
      config.memory.cacheSize.max = 15
      config.targetFrameRate.vr = 90 // If supported
      break
  }
  
  return config
}