// Manager Module Exports - Clean barrel export pattern
export { DataManager } from './DataManager'
export { NavigationManager } from './NavigationManager'
export { WebXRManager } from './WebXRManager'
export { UIManager } from './UIManager'
export { RenderEngine } from './RenderEngine'

// Re-export types for convenience
export type {
  IDataManager,
  INavigationManager,
  IWebXRManager,
  IUIManager,
  IRenderEngine
} from '../types'