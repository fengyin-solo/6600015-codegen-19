import { useState } from 'react'
import { Layout, Tabs, Statistic, Row, Col, Card, Tag, Button, Input, Table, Drawer, Descriptions, Space, Progress } from 'antd'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { useTaskStore } from '../store/tasks'
import type { Task, TaskStatus } from '../types'

const { Header, Content } = Layout

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'default', running: 'processing', success: 'success', failed: 'error', retry: 'warning'
}

export default function Dashboard() {
  const store = useTaskStore()
  const [newTaskName, setNewTaskName] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const taskColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 100 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: TaskStatus) => <Tag color={STATUS_COLORS[s]}>{s}</Tag> },
    { title: '节点', dataIndex: 'node', key: 'node' },
    { title: '重试', key: 'retries', render: (_: any, r: Task) => `${r.retries}/${r.maxRetries}` },
    { title: '耗时', key: 'duration', render: (_: any, r: Task) => r.duration ? `${(r.duration / 1000).toFixed(1)}s` : '-' },
    { title: '操作', key: 'actions', render: (_: any, r: Task) => (
      <Space>
        {r.status === 'failed' && <Button size="small" type="primary" onClick={() => store.retryTask(r.id)}>重试</Button>}
        {r.status === 'running' && <Button size="small" danger onClick={() => store.cancelTask(r.id)}>取消</Button>}
        <Button size="small" onClick={() => { store.selectTask(r); setDrawerOpen(true) }}>详情</Button>
      </Space>
    )},
  ]

  const successCount = store.tasks.filter(t => t.status === 'success').length
  const failedCount = store.tasks.filter(t => t.status === 'failed').length
  const runningCount = store.tasks.filter(t => t.status === 'running').length

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ color: 'white', margin: 0, fontSize: 18 }}>🔧 分布式任务调度与监控平台</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Input placeholder="任务名称" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} style={{ width: 160 }} />
          <Button type="primary" onClick={() => { if (newTaskName) { store.addTask(newTaskName); setNewTaskName('') } }}>
            添加任务
          </Button>
        </div>
      </Header>
      <Content style={{ padding: 16 }}>
        {/* Stats */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card><Statistic title="总任务" value={store.tasks.length} /></Card></Col>
          <Col span={6}><Card><Statistic title="运行中" value={runningCount} valueStyle={{ color: '#1890ff' }} /></Card></Col>
          <Col span={6}><Card><Statistic title="成功" value={successCount} valueStyle={{ color: '#52c41a' }} /></Card></Col>
          <Col span={6}><Card><Statistic title="失败" value={failedCount} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
        </Row>

        <Tabs items={[
          { key: 'metrics', label: '监控指标', children: (
            <Row gutter={16}>
              <Col span={12}>
                <Card title="运行中任务数">
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis fontSize={10} />
                      <Tooltip labelFormatter={t => new Date(t as number).toLocaleString()} />
                      <Area type="monotone" dataKey="runningTasks" stroke="#1890ff" fill="#1890ff" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col span={12}>
                <Card title="成功率 %">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis domain={[0, 100]} fontSize={10} />
                      <Tooltip labelFormatter={t => new Date(t as number).toLocaleString()} />
                      <Line type="monotone" dataKey="successRate" stroke="#52c41a" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col span={24} style={{ marginTop: 16 }}>
                <Card title="平均延迟 (ms)">
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis fontSize={10} />
                      <Tooltip />
                      <Area type="monotone" dataKey="avgLatency" stroke="#faad14" fill="#faad14" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>
          )},
          { key: 'tasks', label: '任务列表', children: (
            <Table dataSource={store.tasks} columns={taskColumns} rowKey="id" size="small" pagination={{ pageSize: 10 }} />
          )},
          { key: 'nodes', label: '集群节点', children: (
            <Row gutter={16}>
              {store.nodes.map(node => (
                <Col span={8} key={node.id} style={{ marginBottom: 16 }}>
                  <Card title={<span>{node.type === 'scheduler' ? '🎯' : '⚙️'} {node.name}</span>}
                    extra={<Tag color={node.status === 'online' ? 'green' : node.status === 'overloaded' ? 'orange' : 'red'}>{node.status}</Tag>}>
                    <Progress percent={Math.round(node.cpu)} strokeColor={node.cpu > 80 ? '#ff4d4f' : '#1890ff'} format={v => `CPU ${v}%`} />
                    <Progress percent={Math.round(node.memory)} strokeColor={node.memory > 80 ? '#ff4d4f' : '#52c41a'} format={v => `MEM ${v}%`} />
                    <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                      任务数: {node.tasks} | 运行时间: {Math.floor(node.uptime / 3600)}h
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          )},
          { key: 'capacity', label: '容量预测', children: (
            <div>
              {/* 风险概览 */}
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={6}>
                  <Card>
                    <Statistic
                      title="整体风险等级"
                      value={store.capacityPrediction.overallRisk === 'critical' ? '严重' : store.capacityPrediction.overallRisk === 'high' ? '较高' : store.capacityPrediction.overallRisk === 'medium' ? '中等' : '低'}
                      valueStyle={{ color: store.capacityPrediction.overallRisk === 'critical' ? '#ff4d4f' : store.capacityPrediction.overallRisk === 'high' ? '#fa8c16' : store.capacityPrediction.overallRisk === 'medium' ? '#faad14' : '#52c41a', fontWeight: 'bold' }}
                      prefix={store.capacityPrediction.overallRisk === 'critical' ? '🚨' : store.capacityPrediction.overallRisk === 'high' ? '⚠️' : store.capacityPrediction.overallRisk === 'medium' ? '📊' : '✅'}
                    />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card>
                    <Statistic
                      title="预计峰值压力"
                      value={store.capacityPrediction.summary.peakPredictedLoad}
                      suffix="%"
                      valueStyle={{ color: store.capacityPrediction.summary.peakPredictedLoad > 80 ? '#ff4d4f' : store.capacityPrediction.summary.peakPredictedLoad > 60 ? '#faad14' : '#52c41a' }}
                      prefix="📈"
                    />
                    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                      第 {store.capacityPrediction.summary.peakHourOffset} 小时达到峰值
                    </div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card>
                    <Statistic
                      title="容量余量"
                      value={store.capacityPrediction.summary.capacityHeadroom}
                      suffix="%"
                      valueStyle={{ color: store.capacityPrediction.summary.capacityHeadroom < 10 ? '#ff4d4f' : store.capacityPrediction.summary.capacityHeadroom < 30 ? '#faad14' : '#52c41a' }}
                      prefix="📦"
                    />
                    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                      下一个高峰: {store.capacityPrediction.summary.nextPeakHour}:00
                    </div>
                  </Card>
                </Col>
                <Col span={6}>
                  <Card>
                    <Statistic
                      title="积压速率"
                      value={store.capacityPrediction.summary.backlogRate}
                      suffix="任务/小时"
                      valueStyle={{ color: store.capacityPrediction.summary.backlogRate > 2 ? '#ff4d4f' : store.capacityPrediction.summary.backlogRate > 0.5 ? '#faad14' : '#52c41a' }}
                      prefix={store.capacityPrediction.summary.backlogRate > 0 ? '📥' : '📤'}
                    />
                    <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                      趋势: {store.capacityPrediction.summary.trendDirection === 'increasing' ? '上升' : store.capacityPrediction.summary.trendDirection === 'decreasing' ? '下降' : '稳定'}
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* 压力预测图表 */}
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={16}>
                  <Card title="未来12小时节点压力预测" extra={<Button size="small" onClick={() => store.refreshPrediction()}>刷新预测</Button>}>
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={store.capacityPrediction.forecasts}>
                        <defs>
                          <linearGradient id="pressureGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#1890ff" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#1890ff" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="hourOffset" tickFormatter={h => `+${h}h`} fontSize={10} />
                        <YAxis domain={[0, 100]} fontSize={10} />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            `${value.toFixed(1)}%`,
                            name === 'nodePressure' ? '节点压力' : name === 'utilization' ? '利用率' : name
                          ]}
                          labelFormatter={h => `未来第 ${h} 小时`}
                        />
                        <Area type="monotone" dataKey="nodePressure" stroke="#1890ff" strokeWidth={2} fill="url(#pressureGradient)" name="nodePressure" />
                        <Line type="monotone" dataKey="utilization" stroke="#52c41a" strokeWidth={2} dot={false} name="utilization" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card title="排班风险分析">
                    {store.capacityPrediction.schedulingRisks.map((risk, idx) => (
                      <div key={idx} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 500 }}>
                            {risk.type === 'capacity' ? '📦 容量风险' :
                             risk.type === 'scheduling' ? '📅 排班风险' :
                             risk.type === 'node_health' ? '🩺 节点健康' :
                             risk.type === 'load_balance' ? '⚖️ 负载均衡' : '🛡️ 单点故障'}
                          </span>
                          <Tag color={risk.level === 'critical' ? 'red' : risk.level === 'high' ? 'orange' : risk.level === 'medium' ? 'gold' : 'green'}>
                            {risk.level === 'critical' ? '严重' : risk.level === 'high' ? '较高' : risk.level === 'medium' ? '中等' : '低'}
                          </Tag>
                        </div>
                        <Progress percent={Math.round(risk.severity)} size="small"
                          strokeColor={risk.severity > 70 ? '#ff4d4f' : risk.severity > 40 ? '#faad14' : '#52c41a'}
                          showInfo={false} />
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{risk.description}</div>
                      </div>
                    ))}
                  </Card>
                </Col>
              </Row>

              {/* 节点预测 & 建议操作 */}
              <Row gutter={16}>
                <Col span={16}>
                  <Card title="节点负载预测">
                    <Row gutter={12}>
                      {store.capacityPrediction.nodePredictions.map(node => (
                        <Col span={12} key={node.nodeId} style={{ marginBottom: 12 }}>
                          <Card size="small" title={
                            <span style={{ fontSize: 13 }}>
                              {node.nodeName.includes('scheduler') ? '🎯' : '⚙️'} {node.nodeName}
                            </span>
                          } extra={
                            <Tag color={node.status === 'critical' ? 'red' : node.status === 'warning' ? 'orange' : 'green'} style={{ fontSize: 11 }}>
                              {node.status === 'critical' ? '过载' : node.status === 'warning' ? '预警' : '健康'}
                            </Tag>
                          }>
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>当前负载</div>
                              <Progress percent={Math.round(node.currentLoad)} size="small"
                                strokeColor={node.currentLoad > 70 ? '#ff4d4f' : '#1890ff'} />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                                预测负载
                                <span style={{ marginLeft: 8, color: node.loadTrend === 'rising' ? '#ff4d4f' : node.loadTrend === 'falling' ? '#52c41a' : '#888' }}>
                                  {node.loadTrend === 'rising' ? '↑上升' : node.loadTrend === 'falling' ? '↓下降' : '→稳定'}
                                </span>
                              </div>
                              <Progress percent={Math.round(node.projectedLoad)} size="small"
                                strokeColor={node.projectedLoad > 70 ? '#ff4d4f' : node.projectedLoad > 50 ? '#faad14' : '#52c41a'} />
                            </div>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card title="建议操作">
                    <div style={{ maxHeight: 320, overflow: 'auto' }}>
                      {store.capacityPrediction.summary.recommendedActions.map((action, idx) => (
                        <div key={idx} style={{
                          padding: '10px 12px',
                          marginBottom: 8,
                          background: action.includes('🚨') ? '#fff1f0' : action.includes('⚠️') ? '#fffbe6' : '#f6ffed',
                          borderRadius: 6,
                          borderLeft: `3px solid ${action.includes('🚨') ? '#ff4d4f' : action.includes('⚠️') ? '#faad14' : '#52c41a'}`,
                          fontSize: 13,
                          lineHeight: 1.5
                        }}>
                          {action}
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* 逐小时预测详情 */}
              <Card title="逐小时预测详情" style={{ marginTop: 16 }}>
                <Table
                  dataSource={store.capacityPrediction.forecasts}
                  rowKey="hourOffset"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '时间', dataIndex: 'hourOffset', key: 'hour', width: 80, render: (h: number) => `+${h}小时` },
                    { title: '时段', dataIndex: 'hourOfDay', key: 'hourOfDay', width: 80, render: (h: number, record: any) => (
                      <span>
                        {h}:00
                        {record.isPeakHour && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>高峰</Tag>}
                      </span>
                    )},
                    { title: '预测提交', dataIndex: 'predictedSubmissions', key: 'submissions', width: 90, render: (v: number) => v.toFixed(1) },
                    { title: '预测完成', dataIndex: 'predictedCompletions', key: 'completions', width: 90, render: (v: number) => v.toFixed(1) },
                    { title: '运行中', dataIndex: 'predictedRunning', key: 'running', width: 90, render: (v: number) => v.toFixed(1) },
                    { title: '等待队列', dataIndex: 'predictedQueue', key: 'queue', width: 90, render: (v: number) => v.toFixed(1) },
                    { title: '节点压力', dataIndex: 'nodePressure', key: 'pressure', width: 120, render: (v: number) => (
                      <Progress percent={Math.round(v)} size="small"
                        strokeColor={v > 70 ? '#ff4d4f' : v > 50 ? '#faad14' : '#52c41a'} />
                    )},
                    { title: '风险等级', dataIndex: 'riskLevel', key: 'risk', width: 90, render: (level: string) => (
                      <Tag color={level === 'critical' ? 'red' : level === 'high' ? 'orange' : level === 'medium' ? 'gold' : 'green'}>
                        {level === 'critical' ? '严重' : level === 'high' ? '较高' : level === 'medium' ? '中等' : '低'}
                      </Tag>
                    )},
                    { title: '风险因素', dataIndex: 'riskFactors', key: 'factors', render: (factors: string[]) => (
                      factors.map((f, i) => <Tag key={i} color="default" style={{ fontSize: 11 }}>{f}</Tag>)
                    )},
                  ]}
                />
              </Card>
            </div>
          )},
        ]} />

        {/* Task Detail Drawer */}
        <Drawer title="任务详情" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={480}>
          {store.selectedTask && (
            <>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="ID">{store.selectedTask.id}</Descriptions.Item>
                <Descriptions.Item label="名称">{store.selectedTask.name}</Descriptions.Item>
                <Descriptions.Item label="状态"><Tag color={STATUS_COLORS[store.selectedTask.status]}>{store.selectedTask.status}</Tag></Descriptions.Item>
                <Descriptions.Item label="执行节点">{store.selectedTask.node}</Descriptions.Item>
                <Descriptions.Item label="重试次数">{store.selectedTask.retries}/{store.selectedTask.maxRetries}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{new Date(store.selectedTask.createdAt).toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label="耗时">{store.selectedTask.duration ? `${(store.selectedTask.duration / 1000).toFixed(1)}s` : '-'}</Descriptions.Item>
              </Descriptions>
              <h4 style={{ marginTop: 16 }}>执行日志</h4>
              <pre style={{ background: '#1f1f1f', padding: 12, borderRadius: 8, fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
                {store.selectedTask.logs.join('\n')}
              </pre>
            </>
          )}
        </Drawer>
      </Content>
    </Layout>
  )
}
