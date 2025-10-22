// Performance Profiling System for Quest 3 VR Tour
export interface PerformanceMetrics {
  frameTime: number
  memoryUsage: number
  gpuMemoryUsage?: number
  activeTextures: number
  cacheSize: number
  renderCalls: number
  timestamp: number
}

export class PerformanceProfiler {
  private metrics: PerformanceMetrics[] = []
  private maxMetricsHistory = 1000 // Keep last 1000 frame metrics

  private frameStartTime = 0
  private isProfilingEnabled = false

  constructor() {
    // Enable profiling in development or when URL parameter is present
    this.isProfilingEnabled = 
      import.meta.env.DEV || 
      new URLSearchParams(window.location.search).has('profile')
  }

  public startFrame(): void {
    if (!this.isProfilingEnabled) return
    this.frameStartTime = performance.now()
  }

  public endFrame(additionalMetrics: Partial<PerformanceMetrics> = {}): void {
    if (!this.isProfilingEnabled) return

    const now = performance.now()
    const frameTime = now - this.frameStartTime

    // Get memory usage
    const memInfo = (performance as any).memory
    const memoryUsage = memInfo ? memInfo.usedJSHeapSize / (1024 * 1024) : 0 // MB

    const metrics: PerformanceMetrics = {
      frameTime,
      memoryUsage,
      activeTextures: 0,
      cacheSize: 0,
      renderCalls: 0,
      timestamp: now,
      ...additionalMetrics
    }

    this.metrics.push(metrics)

    // Trim history if needed
    if (this.metrics.length > this.maxMetricsHistory) {
      this.metrics.shift()
    }

    // Log performance warnings for Quest 3
    this.checkPerformanceWarnings(metrics)
  }

  private checkPerformanceWarnings(metrics: PerformanceMetrics): void {
    // Frame time warnings (Quest 3 target: ~13.89ms for 72fps)
    if (metrics.frameTime > 20) {
      console.warn(`Quest 3 Performance: High frame time ${metrics.frameTime.toFixed(2)}ms`)
    }

    // Memory warnings (Quest 3 has 8GB total)
    if (metrics.memoryUsage > 500) { // 500MB threshold
      console.warn(`Quest 3 Performance: High memory usage ${metrics.memoryUsage.toFixed(1)}MB`)
    }

    // Cache size warnings
    if (metrics.cacheSize > 15) {
      console.warn(`Quest 3 Performance: Large cache size ${metrics.cacheSize}`)
    }
  }

  public getAverageFrameTime(samples: number = 60): number {
    if (this.metrics.length === 0) return 0
    
    const recentMetrics = this.metrics.slice(-samples)
    const total = recentMetrics.reduce((sum, m) => sum + m.frameTime, 0)
    return total / recentMetrics.length
  }

  public getCurrentFPS(samples: number = 60): number {
    const avgFrameTime = this.getAverageFrameTime(samples)
    return avgFrameTime > 0 ? 1000 / avgFrameTime : 0
  }

  public getMemoryTrend(samples: number = 100): 'increasing' | 'decreasing' | 'stable' {
    if (this.metrics.length < samples) return 'stable'

    const recentMetrics = this.metrics.slice(-samples)
    const firstHalf = recentMetrics.slice(0, samples / 2)
    const secondHalf = recentMetrics.slice(samples / 2)

    const firstAvg = firstHalf.reduce((sum, m) => sum + m.memoryUsage, 0) / firstHalf.length
    const secondAvg = secondHalf.reduce((sum, m) => sum + m.memoryUsage, 0) / secondHalf.length

    const diff = secondAvg - firstAvg
    const threshold = 5 // 5MB threshold

    if (diff > threshold) return 'increasing'
    if (diff < -threshold) return 'decreasing'
    return 'stable'
  }

  public getPerformanceReport(): string {
    if (this.metrics.length === 0) return 'No performance data available'

    const avgFrameTime = this.getAverageFrameTime()
    const currentFPS = this.getCurrentFPS()
    const memoryTrend = this.getMemoryTrend()
    const latestMetrics = this.metrics[this.metrics.length - 1]

    return `
Quest 3 Performance Report:
- Average FPS: ${currentFPS.toFixed(1)} (Target: 72fps)
- Frame Time: ${avgFrameTime.toFixed(2)}ms (Target: <13.89ms)
- Memory Usage: ${latestMetrics.memoryUsage.toFixed(1)}MB
- Memory Trend: ${memoryTrend}
- Cache Size: ${latestMetrics.cacheSize}
- Active Textures: ${latestMetrics.activeTextures}
- Samples: ${this.metrics.length}
    `.trim()
  }

  public exportMetrics(): PerformanceMetrics[] {
    return [...this.metrics]
  }

  public clearMetrics(): void {
    this.metrics = []
  }

  public isEnabled(): boolean {
    return this.isProfilingEnabled
  }

  // Quest 3 specific performance checks
  public checkQuest3Performance(): {
    isOptimal: boolean
    warnings: string[]
    recommendations: string[]
  } {
    const warnings: string[] = []
    const recommendations: string[] = []

    if (this.metrics.length === 0) {
      return { isOptimal: false, warnings: ['No performance data'], recommendations: [] }
    }

    const currentFPS = this.getCurrentFPS()
    const memoryTrend = this.getMemoryTrend()
    const latestMetrics = this.metrics[this.metrics.length - 1]

    // Frame rate checks
    if (currentFPS < 60) {
      warnings.push('FPS below 60 - may cause motion sickness in VR')
      recommendations.push('Reduce texture quality or cache size')
    }

    // Frame time consistency
    const frameTimeVariance = this.getFrameTimeVariance()
    if (frameTimeVariance > 5) {
      warnings.push('Inconsistent frame times detected')
      recommendations.push('Enable render-on-demand mode')
    }

    // Memory usage
    if (latestMetrics.memoryUsage > 400) {
      warnings.push('High memory usage detected')
      recommendations.push('Enable aggressive cache cleanup')
    }

    if (memoryTrend === 'increasing') {
      warnings.push('Memory usage is increasing over time')
      recommendations.push('Check for memory leaks in texture management')
    }

    const isOptimal = warnings.length === 0 && currentFPS >= 72

    return { isOptimal, warnings, recommendations }
  }

  private getFrameTimeVariance(samples: number = 60): number {
    if (this.metrics.length < samples) return 0

    const recentMetrics = this.metrics.slice(-samples)
    const frameTimes = recentMetrics.map(m => m.frameTime)
    const avg = frameTimes.reduce((sum, t) => sum + t, 0) / frameTimes.length
    
    const variance = frameTimes.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / frameTimes.length
    return Math.sqrt(variance)
  }
}