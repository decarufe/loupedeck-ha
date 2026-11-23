import type { DashboardConfig } from '../config/schema.js'
import { createCameraDashboard } from './camera.js'
import { createClimateDashboard } from './climate.js'
import { createCustomDashboard } from './custom.js'
import { createGraphDashboard } from './graph.js'
import type { Dashboard, DashboardDeps } from './types.js'
import { createWeatherDashboard } from './weather.js'

export function createDashboard(cfg: DashboardConfig, d: DashboardDeps): Dashboard {
  switch (cfg.type) {
    case 'custom': return createCustomDashboard(cfg, d)
    case 'climate': return createClimateDashboard(cfg, d)
    case 'weather': return createWeatherDashboard(cfg, d)
    case 'camera': return createCameraDashboard(cfg, d)
    case 'graph': return createGraphDashboard(cfg, d)
  }
}
