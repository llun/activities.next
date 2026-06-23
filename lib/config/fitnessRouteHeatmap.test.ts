import {
  DEFAULT_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT,
  DEFAULT_ROUTE_HEATMAP_FILE_POINT_LIMIT,
  DEFAULT_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES,
  DEFAULT_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS,
  getFitnessRouteHeatmapConfig
} from './fitnessRouteHeatmap'

describe('Fitness route heatmap config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES
    delete process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT
    delete process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_FILE_POINT_LIMIT
    delete process.env
      .ACTIVITIES_FITNESS_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('uses defaults when tuning env vars are not set', () => {
    expect(getFitnessRouteHeatmapConfig()).toEqual({
      memoryBudgetBytes: DEFAULT_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES,
      accumulationPointLimit: DEFAULT_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT,
      filePointLimit: DEFAULT_ROUTE_HEATMAP_FILE_POINT_LIMIT,
      simplifyToleranceMeters: DEFAULT_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS
    })
  })

  it('parses positive numeric tuning env vars at runtime', () => {
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES = '1024'
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT =
      '256'
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_FILE_POINT_LIMIT = '128'
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS =
      '3.5'

    expect(getFitnessRouteHeatmapConfig()).toEqual({
      memoryBudgetBytes: 1024,
      accumulationPointLimit: 256,
      filePointLimit: 128,
      simplifyToleranceMeters: 3.5
    })
  })

  it('falls back for invalid tuning env vars', () => {
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES = '-1'
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT = '0'
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_FILE_POINT_LIMIT = '1'
    process.env.ACTIVITIES_FITNESS_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS = '0'

    expect(getFitnessRouteHeatmapConfig()).toEqual({
      memoryBudgetBytes: DEFAULT_ROUTE_HEATMAP_MEMORY_BUDGET_BYTES,
      accumulationPointLimit: DEFAULT_ROUTE_HEATMAP_ACCUMULATION_POINT_LIMIT,
      filePointLimit: 2,
      simplifyToleranceMeters: DEFAULT_ROUTE_HEATMAP_SIMPLIFY_TOLERANCE_METERS
    })
  })
})
