export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'retry'
export type NodeType = 'scheduler' | 'worker'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type NodeStatus = 'healthy' | 'warning' | 'critical'
export type TrendDirection = 'increasing' | 'decreasing' | 'stable'

export interface Task {
  id: string
  name: string
  status: TaskStatus
  node: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  retries: number
  maxRetries: number
  duration?: number
  logs: string[]
}

export interface ClusterNode {
  id: string
  name: string
  type: NodeType
  status: 'online' | 'offline' | 'overloaded'
  cpu: number
  memory: number
  tasks: number
  uptime: number
}

export interface MetricsSnapshot {
  time: number
  totalTasks: number
  runningTasks: number
  successRate: number
  avgLatency: number
  nodeCount: number
}

export interface ForecastHour {
  hourOffset: number
  hourOfDay: number
  isPeakHour: boolean
  timestamp: string
  predictedSubmissions: number
  predictedCompletions: number
  predictedRunning: number
  predictedQueue: number
  nodePressure: number
  utilization: number
  backlogSeverity: number
  riskLevel: RiskLevel
  riskFactors: string[]
}

export interface NodePrediction {
  nodeId: string
  nodeName: string
  currentLoad: number
  projectedLoad: number
  loadTrend: TrendDirection
  failureRisk: RiskLevel
  status: NodeStatus
}

export interface SchedulingRisk {
  type: 'capacity' | 'scheduling' | 'node_health' | 'load_balance' | 'single_point'
  level: RiskLevel
  description: string
  severity: number
}

export interface PredictionSummary {
  trendDirection: TrendDirection
  avgHourlySubmissions: number
  avgHourlyCompletions: number
  backlogRate: number
  avgTaskDurationMs: number
  peakPredictedLoad: number
  peakHourOffset: number
  nextPeakHour: number
  capacityHeadroom: number
  recommendedActions: string[]
}

export interface CapacityPrediction {
  forecasts: ForecastHour[]
  nodePredictions: NodePrediction[]
  overallRisk: RiskLevel
  schedulingRisks: SchedulingRisk[]
  summary: PredictionSummary
}
