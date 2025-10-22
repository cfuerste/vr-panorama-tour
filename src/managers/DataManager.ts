// Data Manager Module - Handles panorama data loading and management
import type { 
  PanoramaDatabase, 
  PanoramaData, 
  IDataManager,
  ModuleOptions 
} from '../types'

export class DataManager implements IDataManager {
  private panoramaData: PanoramaDatabase = {}
  private currentPanorama: string = 'Panorama_Außenanlagen_001'

  constructor(_options?: Pick<ModuleOptions, 'onEvent'>) {
    // Reserved for future event handling
  }

  public async loadPanoramaData(): Promise<void> {
    try {
      // Use Vite's base URL to handle both dev and production paths
      const basePath = import.meta.env.BASE_URL
      const jsonPath = `${basePath}json/Panoramane_Standorte.json`
      const response = await fetch(jsonPath)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      this.panoramaData = await response.json()
      console.log(`Loaded panorama data: ${Object.keys(this.panoramaData).length} panoramas`)
    } catch (error) {
      console.error('Failed to load panorama data:', error)
      throw error
    }
  }

  public getPanoramaData(): PanoramaDatabase {
    return this.panoramaData
  }

  public getCurrentPanoramaData(): PanoramaData | null {
    return this.panoramaData[this.currentPanorama] || null
  }

  public setCurrentPanorama(panoramaId: string): void {
    if (this.panoramaData[panoramaId]) {
      this.currentPanorama = panoramaId
    } else {
      console.warn(`Panorama not found: ${panoramaId}`)
    }
  }

  public getCurrentPanoramaId(): string {
    return this.currentPanorama
  }

  public panoramaExists(panoramaId: string): boolean {
    return !!this.panoramaData[panoramaId]
  }

  public getAllPanoramaIds(): string[] {
    return Object.keys(this.panoramaData)
  }

  public getPanoramasByFloor(floor: string): Array<{ id: string; data: PanoramaData }> {
    return Object.entries(this.panoramaData)
      .filter(([_, data]) => data.floor === floor)
      .map(([id, data]) => ({ id, data }))
  }

  public getAllFloors(): string[] {
    const floors = new Set<string>()
    Object.values(this.panoramaData).forEach(data => {
      floors.add(data.floor)
    })
    return Array.from(floors).sort()
  }

  public getConnectedPanoramas(panoramaId: string): string[] {
    const panorama = this.panoramaData[panoramaId]
    if (!panorama) return []
    
    return panorama.links.map(link => link.to).filter(id => this.panoramaExists(id))
  }

  public getPanoramaDisplayName(panoramaId: string): string {
    const panorama = this.panoramaData[panoramaId]
    if (!panorama) return panoramaId
    
    // Convert panorama ID to display name
    const parts = panoramaId.split('_')
    return parts.slice(1).join(' ').replace(/([A-Z])/g, ' $1').trim()
  }

  public validatePanoramaData(): { isValid: boolean; errors: string[] } {
    const errors: string[] = []
    
    if (Object.keys(this.panoramaData).length === 0) {
      errors.push('No panorama data loaded')
      return { isValid: false, errors }
    }

    // Check for missing required fields
    for (const [id, data] of Object.entries(this.panoramaData)) {
      if (!data.name) errors.push(`Missing name for panorama: ${id}`)
      if (!data.image) errors.push(`Missing image for panorama: ${id}`)
      if (!data.floor) errors.push(`Missing floor for panorama: ${id}`)
      if (!data.map || typeof data.map.x !== 'number' || typeof data.map.y !== 'number') {
        errors.push(`Invalid map coordinates for panorama: ${id}`)
      }
      if (!Array.isArray(data.links)) {
        errors.push(`Invalid links for panorama: ${id}`)
      } else {
        // Validate links
        data.links.forEach((link, index) => {
          if (!link.to) errors.push(`Missing 'to' field in link ${index} for panorama: ${id}`)
          if (typeof link.yaw !== 'number') errors.push(`Invalid yaw in link ${index} for panorama: ${id}`)
          if (typeof link.pitch !== 'number') errors.push(`Invalid pitch in link ${index} for panorama: ${id}`)
          if (!link.label) errors.push(`Missing label in link ${index} for panorama: ${id}`)
        })
      }
    }

    // Check for broken link references
    for (const [id, data] of Object.entries(this.panoramaData)) {
      data.links.forEach((link, index) => {
        if (!this.panoramaExists(link.to)) {
          errors.push(`Broken link in panorama ${id}, link ${index}: target '${link.to}' does not exist`)
        }
      })
    }

    return { isValid: errors.length === 0, errors }
  }

  public getStatistics(): {
    totalPanoramas: number
    floorsCount: number
    totalLinks: number
    averageLinksPerPanorama: number
    floors: string[]
  } {
    const totalPanoramas = Object.keys(this.panoramaData).length
    const floors = this.getAllFloors()
    const totalLinks = Object.values(this.panoramaData).reduce((sum, data) => sum + data.links.length, 0)
    
    return {
      totalPanoramas,
      floorsCount: floors.length,
      totalLinks,
      averageLinksPerPanorama: totalPanoramas > 0 ? totalLinks / totalPanoramas : 0,
      floors
    }
  }

  public dispose(): void {
    this.panoramaData = {}
    this.currentPanorama = ''
    console.log('DataManager disposed')
  }
}