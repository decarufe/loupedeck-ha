import type { DashboardConfig } from '../config/schema.js'
import { createCameraDashboard } from './camera.js'
import { createClimateDashboard } from './climate.js'
import { createLightsDashboard } from './lights.js'
import type { Dashboard, DashboardDeps } from './types.js'
import { createWeatherDashboard } from './weather.js'

export function createDashboard(cfg: DashboardConfig, d: DashboardDeps): Dashboard {
  switch (cfg.type) {
    case 'lights': return createLightsDashboard(cfg, d)
    case 'climate': return createClimateDashboard(cfg, d)
    case 'weather': return createWeatherDashboard(cfg, d)
    case 'camera': return createCameraDashboard(cfg, d)
  }
}
