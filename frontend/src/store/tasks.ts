import { create } from 'zustand'
import type { Task, ClusterNode, MetricsSnapshot, TaskStatus, CapacityPrediction } from '../types'

// Mock data generators
function mockNodes(): ClusterNode[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `node-${i + 1}`,
    name: i === 0 ? 'scheduler-main' : `worker-${i}`,
    type: i === 0 ? 'scheduler' as const : 'worker' as const,
    status: Math.random() > 0.1 ? 'online' as const : 'overloaded' as const,
    cpu: 20 + Math.random() * 60,
    memory: 30 + Math.random() * 50,
    tasks: Math.floor(Math.random() * 8),
    uptime: 3600 + Math.floor(Math.random() * 86400),
  }))
}

function mockTasks(nodes: ClusterNode[]): Task[] {
  const names = ['data_sync', 'email_batch', 'report_gen', 'cache_warm', 'log_rotate', 'db_backup', 'index_rebuild', 'health_check']
  return Array.from({ length: 12 }, (_, i) => {
    const status: TaskStatus[] = ['pending', 'running', 'success', 'failed']
    const s = status[Math.floor(Math.random() * 4)]
    const node = nodes[Math.floor(Math.random() * nodes.length)]
    return {
      id: `task-${1000 + i}`,
      name: names[i % names.length],
      status: s,
      node: node.name,
      createdAt: Date.now() - Math.floor(Math.random() * 600000),
      startedAt: s !== 'pending' ? Date.now() - Math.floor(Math.random() * 300000) : undefined,
      completedAt: (s === 'success' || s === 'failed') ? Date.now() - Math.floor(Math.random() * 60000) : undefined,
      retries: s === 'failed' ? Math.floor(Math.random() * 3) : 0,
      maxRetries: 3,
      duration: s === 'success' ? 1000 + Math.floor(Math.random() * 30000) : undefined,
      logs: [`[INFO] Task ${names[i % names.length]} started`, `[INFO] Processing on ${node.name}`],
    }
  })
}

const initialNodes = mockNodes()

function mockCapacityPrediction(): CapacityPrediction {
  const now = new Date()
  const peakHours = [9, 10, 11, 14, 15, 16]
  const forecasts = Array.from({ length: 12 }, (_, i) => {
    const hourOffset = i + 1
    const hourOfDay = (now.getHours() + hourOffset) % 24
    const isPeak = peakHours.includes(hourOfDay)
    const basePressure = 30 + Math.random() * 40 + (isPeak ? 20 : 0) + hourOffset * 2
    const pressure = Math.min(100, basePressure)
    const riskLevel = pressure > 90 ? 'critical' : pressure > 70 ? 'high' : pressure > 50 ? 'medium' : 'low'
    const riskFactors = []
    if (pressure > 70) riskFactors.push('节点负载过高')
    if (isPeak && pressure > 40) riskFactors.push('处于业务高峰时段')
    if (Math.random() > 0.5) riskFactors.push('任务量呈上升趋势')

    return {
      hourOffset,
      hourOfDay,
      isPeakHour: isPeak,
      timestamp: new Date(now.getTime() + hourOffset * 3600000).toISOString(),
      predictedSubmissions: Math.round((5 + Math.random() * 8 + (isPeak ? 4 : 0)) * 10) / 10,
      predictedCompletions: Math.round((4 + Math.random() * 6) * 10) / 10,
      predictedRunning: Math.round((8 + Math.random() * 15 + hourOffset) * 10) / 10,
      predictedQueue: Math.round(Math.max(0, Math.random() * 8) * 10) / 10,
      nodePressure: Math.round(pressure * 10) / 10,
      utilization: Math.round(pressure * 0.9 * 10) / 10,
      backlogSeverity: Math.round(Math.random() * 40 * 10) / 10,
      riskLevel: riskLevel as any,
      riskFactors,
    }
  })

  const nodePredictions = Array.from({ length: 5 }, (_, i) => {
    const currentLoad = 20 + Math.random() * 50
    const projectedLoad = Math.min(100, currentLoad + Math.random() * 30)
    return {
      nodeId: `node-${i + 1}`,
      nodeName: i === 0 ? 'scheduler-main' : `worker-${i}`,
      currentLoad: Math.round(currentLoad * 10) / 10,
      projectedLoad: Math.round(projectedLoad * 10) / 10,
      loadTrend: (projectedLoad > currentLoad + 5 ? 'rising' : projectedLoad < currentLoad - 5 ? 'falling' : 'stable') as any,
      failureRisk: (projectedLoad > 90 ? 'high' : projectedLoad > 75 ? 'medium' : 'low') as any,
      status: (projectedLoad > 90 ? 'critical' : projectedLoad > 70 ? 'warning' : 'healthy') as any,
    }
  })

  const peakPressure = Math.max(...forecasts.map(f => f.nodePressure))
  const overallRisk = peakPressure > 90 ? 'critical' : peakPressure > 70 ? 'high' : peakPressure > 50 ? 'medium' : 'low'

  const schedulingRisks = [
    {
      type: 'capacity' as const,
      level: overallRisk as any,
      description: `未来12小时内预计最高节点压力达${peakPressure.toFixed(1)}%`,
      severity: peakPressure,
    },
    {
      type: 'scheduling' as const,
      level: (forecasts.filter(f => f.riskLevel === 'high' || f.riskLevel === 'critical').length > 3 ? 'high' : 'medium') as any,
      description: '部分时段存在排班紧张风险',
      severity: forecasts.filter(f => f.riskLevel === 'high' || f.riskLevel === 'critical').length / 12 * 100,
    },
    {
      type: 'node_health' as const,
      level: (nodePredictions.filter(n => n.status === 'critical').length > 0 ? 'high' : nodePredictions.filter(n => n.status === 'warning').length > 0 ? 'medium' : 'low') as any,
      description: `${nodePredictions.filter(n => n.status === 'critical').length}个节点预计过载，${nodePredictions.filter(n => n.status === 'warning').length}个节点预警`,
      severity: nodePredictions.filter(n => n.status !== 'healthy').length / 5 * 100,
    },
    {
      type: 'load_balance' as const,
      level: 'medium' as const,
      description: '节点负载存在一定不均衡',
      severity: 20 + Math.random() * 20,
    },
    {
      type: 'single_point' as const,
      level: 'low' as const,
      description: '节点冗余度充足',
      severity: 0,
    },
  ]

  const recommendedActions = []
  if (overallRisk === 'critical' || overallRisk === 'high') {
    recommendedActions.push('🚨 紧急扩容：当前趋势下集群即将达到容量上限，请立即新增工作节点')
  }
  if (overallRisk === 'medium') {
    recommendedActions.push('⚠️ 预警：建议准备扩容方案，密切关注任务量变化')
  }
  recommendedActions.push('📅 排班建议：高峰时段建议安排弹性资源或提前处理积压任务')
  recommendedActions.push('⚖️ 负载均衡：建议优化任务调度策略，均衡各节点负载')
  if (recommendedActions.length === 0) {
    recommendedActions.push('✅ 当前集群运行平稳，容量充足，无紧急操作需要')
  }

  return {
    forecasts,
    nodePredictions,
    overallRisk: overallRisk as any,
    schedulingRisks,
    summary: {
      trendDirection: 'stable' as const,
      avgHourlySubmissions: 8.5,
      avgHourlyCompletions: 7.2,
      backlogRate: 1.3,
      avgTaskDurationMs: 12500,
      peakPredictedLoad: Math.round(peakPressure * 10) / 10,
      peakHourOffset: forecasts.findIndex(f => f.nodePressure === peakPressure) + 1,
      nextPeakHour: 14,
      capacityHeadroom: Math.round(Math.max(0, 100 - peakPressure) * 10) / 10,
      recommendedActions,
    },
  }
}

interface TaskStore {
  tasks: Task[]
  nodes: ClusterNode[]
  metrics: MetricsSnapshot[]
  capacityPrediction: CapacityPrediction
  selectedTask: Task | null
  addTask: (name: string) => void
  retryTask: (id: string) => void
  cancelTask: (id: string) => void
  selectTask: (t: Task | null) => void
  refreshNodes: () => void
  addMetric: () => void
  refreshPrediction: () => void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: mockTasks(initialNodes),
  nodes: initialNodes,
  capacityPrediction: mockCapacityPrediction(),
  metrics: Array.from({ length: 20 }, (_, i) => ({
    time: Date.now() - (20 - i) * 5000,
    totalTasks: 100 + i * 2,
    runningTasks: 3 + Math.floor(Math.random() * 5),
    successRate: 85 + Math.random() * 14,
    avgLatency: 500 + Math.random() * 2000,
    nodeCount: 5,
  })),
  selectedTask: null,
  addTask: (name) => {
    const task: Task = {
      id: `task-${Date.now()}`,
      name, status: 'pending',
      node: get().nodes[Math.floor(Math.random() * get().nodes.length)].name,
      createdAt: Date.now(), retries: 0, maxRetries: 3, logs: [`[INFO] Task ${name} queued`],
    }
    set({ tasks: [task, ...get().tasks] })
  },
  retryTask: (id) => set({
    tasks: get().tasks.map(t => t.id === id ? { ...t, status: 'pending', retries: t.retries + 1, logs: [...t.logs, '[INFO] Retrying...'] } : t)
  }),
  cancelTask: (id) => set({
    tasks: get().tasks.map(t => t.id === id ? { ...t, status: 'failed' as TaskStatus, logs: [...t.logs, '[WARN] Cancelled by user'] } : t)
  }),
  selectTask: (t) => set({ selectedTask: t }),
  refreshNodes: () => set({ nodes: mockNodes() }),
  addMetric: () => {
    const m: MetricsSnapshot = {
      time: Date.now(),
      totalTasks: get().tasks.length,
      runningTasks: get().tasks.filter(t => t.status === 'running').length,
      successRate: (get().tasks.filter(t => t.status === 'success').length / Math.max(get().tasks.length, 1)) * 100,
      avgLatency: 500 + Math.random() * 2000,
      nodeCount: get().nodes.filter(n => n.status !== 'offline').length,
    }
    set({ metrics: [...get().metrics.slice(-30), m] })
  },
  refreshPrediction: () => set({ capacityPrediction: mockCapacityPrediction() }),
}))
