defmodule Scheduler.CapacityPredictor do
  use GenServer

  @node_count 5
  @max_tasks_per_node 8
  @history_window 24
  @prediction_horizon 12
  @peak_hours [9, 10, 11, 14, 15, 16]

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  def record_task_submission(task_count \\ 1) do
    GenServer.cast(__MODULE__, {:record_submission, task_count})
  end

  def record_task_completion(task_count \\ 1, duration_ms \\ 10000) do
    GenServer.cast(__MODULE__, {:record_completion, task_count, duration_ms})
  end

  def get_prediction do
    GenServer.call(__MODULE__, :get_prediction)
  end

  def get_scheduling_risk do
    GenServer.call(__MODULE__, :get_scheduling_risk)
  end

  @impl true
  def init(_) do
    initial_history = for i <- 1..@history_window do
      hour_ago = @history_window - i
      %{
        timestamp: DateTime.utc_now() |> DateTime.add(-hour_ago * 3600),
        task_submissions: 2 + :rand.uniform(6),
        task_completions: 1 + :rand.uniform(5),
        running_tasks: 2 + :rand.uniform(4),
        avg_duration_ms: 5000 + :rand.uniform(20000),
        node_loads: for(_ <- 1..@node_count, do: 20 + :rand.uniform() * 50)
      }
    end

    schedule_periodic_analysis()

    {:ok, %{history: initial_history, prediction: compute_prediction(initial_history)}}
  end

  @impl true
  def handle_cast({:record_submission, count}, state) do
    now = DateTime.utc_now()
    current_hour = find_or_create_hour(state.history, now)

    updated_current = %{current_hour | task_submissions: current_hour.task_submissions + count}
    updated_history = replace_hour(state.history, now, updated_current)
    prediction = compute_prediction(updated_history)

    {:noreply, %{state | history: updated_history, prediction: prediction}}
  end

  @impl true
  def handle_cast({:record_completion, count, duration_ms}, state) do
    now = DateTime.utc_now()
    current_hour = find_or_create_hour(state.history, now)

    total_completions = current_hour.task_completions + count
    total_duration = current_hour.avg_duration_ms * current_hour.task_completions + duration_ms * count
    new_avg_duration = if total_completions > 0, do: total_duration / total_completions, else: 10000

    updated_current = %{current_hour |
      task_completions: total_completions,
      avg_duration_ms: new_avg_duration
    }
    updated_history = replace_hour(state.history, now, updated_current)
    prediction = compute_prediction(updated_history)

    {:noreply, %{state | history: updated_history, prediction: prediction}}
  end

  @impl true
  def handle_call(:get_prediction, _from, state) do
    {:reply, state.prediction, state}
  end

  @impl true
  def handle_call(:get_scheduling_risk, _from, state) do
    risk = compute_scheduling_risk(state.prediction)
    {:reply, risk, state}
  end

  @impl true
  def handle_info(:periodic_analysis, state) do
    now = DateTime.utc_now()
    running = Scheduler.TaskManager.get_stats().running

    current_hour = find_or_create_hour(state.history, now)
    updated_current = %{current_hour | running_tasks: running}
    updated_history = replace_hour(state.history, now, updated_current)
    trimmed_history = Enum.take(updated_history, -@history_window)

    prediction = compute_prediction(trimmed_history)

    schedule_periodic_analysis()

    {:noreply, %{state | history: trimmed_history, prediction: prediction}}
  end

  defp schedule_periodic_analysis do
    Process.send_after(self(), :periodic_analysis, 30_000)
  end

  defp find_or_create_hour(history, timestamp) do
    hour_key = truncate_to_hour(timestamp)

    Enum.find(history, fn h ->
      truncate_to_hour(h.timestamp) == hour_key
    end) || %{
      timestamp: hour_key,
      task_submissions: 0,
      task_completions: 0,
      running_tasks: 0,
      avg_duration_ms: 10000,
      node_loads: for(_ <- 1..@node_count, do: 0.0)
    }
  end

  defp replace_hour(history, timestamp, new_entry) do
    hour_key = truncate_to_hour(timestamp)

    replaced = Enum.map(history, fn h ->
      if truncate_to_hour(h.timestamp) == hour_key, do: new_entry, else: h
    end)

    if Enum.any?(history, fn h -> truncate_to_hour(h.timestamp) == hour_key end) do
      replaced
    else
      replaced ++ [new_entry]
    end
  end

  defp truncate_to_hour(%DateTime{} = dt) do
    %{dt | minute: 0, second: 0, microsecond: {0, 0}}
  end

  defp compute_prediction(history) do
    submissions = Enum.map(history, & &1.task_submissions)
    completions = Enum.map(history, & &1.task_completions)
    running = Enum.map(history, & &1.running_tasks)
    durations = Enum.map(history, & &1.avg_duration_ms)

    submission_trend = linear_trend(submissions)
    completion_trend = linear_trend(completions)

    avg_submission = average(submissions)
    avg_completion = average(completions)
    avg_running = if length(running) > 0, do: List.last(running), else: average(running)
    avg_duration = average(durations)

    now = DateTime.utc_now()
    current_hour = now.hour

    hourly_pattern = compute_hourly_pattern(history)

    forecasts = for h <- 1..@prediction_horizon do
      future_hour = rem(current_hour + h, 24)
      hour_factor = Map.get(hourly_pattern, future_hour, 1.0)
      is_peak = Enum.member?(@peak_hours, future_hour)

      trend_submissions = max(0, avg_submission + submission_trend.slope * h)
      trend_completions = max(0, avg_completion + completion_trend.slope * h)

      predicted_submissions = trend_submissions * hour_factor
      predicted_completions = trend_completions * hour_factor

      net_new = predicted_submissions - predicted_completions
      predicted_running = max(0, avg_running + net_new)

      per_node_load = predicted_running / @node_count
      node_pressure = min(100, per_node_load / @max_tasks_per_node * 100)

      total_capacity = @node_count * @max_tasks_per_node
      utilization = min(100, predicted_running / total_capacity * 100)

      queue_backlog = max(0, predicted_submissions - predicted_completions)
      backlog_severity = if total_capacity > 0, do: min(100, queue_backlog / total_capacity * 100), else: 0

      risk_level = cond do
        node_pressure > 90 or backlog_severity > 80 -> "critical"
        node_pressure > 75 or backlog_severity > 60 -> "high"
        node_pressure > 50 or backlog_severity > 30 -> "medium"
        true -> "low"
      end

      risk_factors = []
      risk_factors = if node_pressure > 70, do: ["节点负载过高" | risk_factors], else: risk_factors
      risk_factors = if predicted_submissions > predicted_completions * 1.3, do: ["任务积压加速" | risk_factors], else: risk_factors
      risk_factors = if avg_duration > 15000 and node_pressure > 50, do: ["长耗时任务拖慢吞吐" | risk_factors], else: risk_factors
      risk_factors = if is_peak and node_pressure > 40, do: ["处于业务高峰时段" | risk_factors], else: risk_factors
      risk_factors = if submission_trend.slope > 0.3 and node_pressure > 30, do: ["任务量呈上升趋势" | risk_factors], else: risk_factors

      %{
        hour_offset: h,
        hour_of_day: future_hour,
        is_peak_hour: is_peak,
        timestamp: DateTime.utc_now() |> DateTime.add(h * 3600),
        predicted_submissions: Float.round(predicted_submissions, 1),
        predicted_completions: Float.round(predicted_completions, 1),
        predicted_running: Float.round(predicted_running, 1),
        predicted_queue: Float.round(queue_backlog, 1),
        node_pressure: Float.round(node_pressure, 1),
        utilization: Float.round(utilization, 1),
        backlog_severity: Float.round(backlog_severity, 1),
        risk_level: risk_level,
        risk_factors: risk_factors
      }
    end

    node_predictions = for i <- 1..@node_count do
      load_history = Enum.map(history, fn h ->
        Enum.at(h.node_loads, i - 1, 0.0)
      end)
      trend = linear_trend(load_history)
      current_load = if length(load_history) > 0, do: List.last(load_history), else: 0.0
      projected_load = min(100, current_load + trend.slope * @prediction_horizon)

      failure_risk = cond do
        projected_load > 90 -> "high"
        projected_load > 75 -> "medium"
        true -> "low"
      end

      %{
        node_id: "node-#{i}",
        node_name: if(i == 1, do: "scheduler-main", else: "worker-#{i - 1}"),
        current_load: Float.round(current_load, 1),
        projected_load: Float.round(projected_load, 1),
        load_trend: if(trend.slope > 1, do: "rising", else: if(trend.slope < -1, do: "falling", else: "stable")),
        failure_risk: failure_risk,
        status: cond do
          projected_load > 90 -> "critical"
          projected_load > 70 -> "warning"
          true -> "healthy"
        end
      }
    end

    overall_risk = cond do
      Enum.any?(forecasts, & &1.risk_level == "critical") -> "critical"
      Enum.any?(forecasts, & &1.risk_level == "high") -> "high"
      Enum.any?(forecasts, & &1.risk_level == "medium") -> "medium"
      true -> "low"
    end

    scheduling_risks = compute_scheduling_risks(forecasts, node_predictions)

    %{
      forecasts: forecasts,
      node_predictions: node_predictions,
      overall_risk: overall_risk,
      scheduling_risks: scheduling_risks,
      summary: %{
        trend_direction: if(submission_trend.slope > 0.5, do: "increasing", else: if(submission_trend.slope < -0.5, do: "decreasing", else: "stable")),
        avg_hourly_submissions: Float.round(avg_submission, 1),
        avg_hourly_completions: Float.round(avg_completion, 1),
        backlog_rate: Float.round(avg_submission - avg_completion, 2),
        avg_task_duration_ms: Float.round(avg_duration, 0),
        peak_predicted_load: forecasts |> Enum.map(& &1.node_pressure) |> Enum.max() |> Float.round(1),
        peak_hour_offset: forecasts |> Enum.with_index() |> Enum.max_by(fn {f, _} -> f.node_pressure end) |> elem(1) |> Kernel.+(1),
        next_peak_hour: find_next_peak_hour(current_hour),
        capacity_headroom: Float.round(max(0, 100 - (forecasts |> Enum.map(& &1.node_pressure) |> Enum.max())), 1),
        recommended_actions: recommend_actions(overall_risk, forecasts, node_predictions, scheduling_risks)
      }
    }
  end

  defp compute_hourly_pattern(history) do
    hour_groups = Enum.group_by(history, fn h -> h.timestamp.hour end)
    for {hour, entries} <- hour_groups, into: %{} do
      avg_sub = average(Enum.map(entries, & &1.task_submissions))
      {hour, avg_sub}
    end
    |> normalize_pattern()
  end

  defp normalize_pattern(pattern) do
    values = Map.values(pattern)
    avg = if length(values) > 0, do: average(values), else: 1.0
    if avg > 0 do
      for {k, v} <- pattern, into: %{}, do: {k, v / avg}
    else
      pattern
    end
  end

  defp find_next_peak_hour(current_hour) do
    @peak_hours
    |> Enum.sort()
    |> Enum.find(fn h -> h > current_hour end)
    |> case do
      nil -> List.first(@peak_hours)
      h -> h
    end
  end

  defp compute_scheduling_risks(forecasts, node_predictions) do
    high_risk_nodes = Enum.filter(node_predictions, &(&1.status == "critical"))
    warning_nodes = Enum.filter(node_predictions, &(&1.status == "warning"))

    peak_forecast = Enum.max_by(forecasts, & &1.node_pressure)
    peak_risk = peak_forecast.risk_level

    critical_periods = forecasts
    |> Enum.filter(&(&1.risk_level in ["critical", "high"]))
    |> Enum.map(& &1.hour_offset)

    workload_imbalance = compute_workload_imbalance(node_predictions)

    single_point_failure = length(high_risk_nodes) >= length(node_predictions) - 1

    [
      %{
        type: "capacity",
        level: peak_risk,
        description: "未来#{@prediction_horizon}小时内预计最高节点压力达#{peak_forecast.node_pressure}%",
        severity: peak_forecast.node_pressure
      },
      %{
        type: "scheduling",
        level: if(length(critical_periods) > 0, do: "high", else: "low"),
        description: if(length(critical_periods) > 0, do: "第#{Enum.join(critical_periods, "、")}小时存在排班紧张风险", else: "排班压力正常"),
        severity: length(critical_periods) / @prediction_horizon * 100
      },
      %{
        type: "node_health",
        level: if(length(high_risk_nodes) > 0, do: "high", else: if(length(warning_nodes) > 0, do: "medium", else: "low")),
        description: "#{length(high_risk_nodes)}个节点预计过载，#{length(warning_nodes)}个节点预警",
        severity: length(high_risk_nodes) / @node_count * 100
      },
      %{
        type: "load_balance",
        level: if(workload_imbalance > 30, do: "high", else: if(workload_imbalance > 15, do: "medium", else: "low")),
        description: "节点负载不均衡度约#{Float.round(workload_imbalance, 1)}%",
        severity: workload_imbalance
      },
      %{
        type: "single_point",
        level: if(single_point_failure, do: "critical", else: "low"),
        description: if(single_point_failure, do: "存在单点故障风险：多数节点即将过载", else: "节点冗余度充足"),
        severity: if(single_point_failure, do: 100, else: 0)
      }
    ]
  end

  defp compute_workload_imbalance(node_predictions) do
    loads = Enum.map(node_predictions, & &1.projected_load)
    avg_load = average(loads)
    if avg_load > 0 do
      deviations = Enum.map(loads, fn l -> abs(l - avg_load) / avg_load * 100 end)
      average(deviations)
    else
      0.0
    end
  end

  defp compute_scheduling_risk(prediction) do
    prediction.scheduling_risks
  end

  defp linear_trend(values) do
    n = length(values)
    if n < 2 do
      %{slope: 0.0, intercept: 0.0}
    else
      xs = Enum.to_list(1..n)
      sum_x = Enum.sum(xs)
      sum_y = Enum.sum(values)
      sum_xy = Enum.zip(xs, values) |> Enum.map(fn {x, y} -> x * y end) |> Enum.sum()
      sum_x2 = Enum.map(xs, fn x -> x * x end) |> Enum.sum()

      denominator = n * sum_x2 - sum_x * sum_x
      if denominator == 0 do
        %{slope: 0.0, intercept: sum_y / n}
      else
        slope = (n * sum_xy - sum_x * sum_y) / denominator
        intercept = (sum_y - slope * sum_x) / n
        %{slope: slope, intercept: intercept}
      end
    end
  end

  defp average([]), do: 0.0
  defp average(values), do: Enum.sum(values) / length(values)

  defp recommend_actions(overall_risk, forecasts, node_predictions, scheduling_risks) do
    actions = []

    actions = if overall_risk in ["critical", "high"] do
      ["🚨 紧急扩容：当前趋势下集群即将达到容量上限，请立即新增工作节点" | actions]
    else
      actions
    end

    actions = if overall_risk == "medium" do
      ["⚠️ 预警：建议准备扩容方案，密切关注任务量变化" | actions]
    else
      actions
    end

    critical_forecasts = Enum.filter(forecasts, & &1.risk_level == "critical")
    if length(critical_forecasts) > 0 do
      critical_hours = Enum.map(critical_forecasts, & &1.hour_offset)
      peak_pressure = critical_forecasts |> Enum.map(& &1.node_pressure) |> Enum.max()
      actions = ["⏰ 高峰预警：第#{Enum.join(critical_hours, "、")}小时预计达#{peak_pressure}%压力，建议错峰调度" | actions]
    end

    high_risk_nodes = node_predictions |> Enum.filter(&(&1.status == "critical")) |> Enum.map(& &1.node_name)
    actions = if length(high_risk_nodes) > 0 do
      ["🔄 节点优化：节点#{Enum.join(high_risk_nodes, "、")}过载严重，建议立即迁移任务" | actions]
    else
      actions
    end

    warning_nodes = node_predictions |> Enum.filter(&(&1.status == "warning")) |> Enum.map(& &1.node_name)
    actions = if length(warning_nodes) > 0 and length(high_risk_nodes) == 0 do
      ["⚖️ 负载均衡：节点#{Enum.join(warning_nodes, "、")}压力上升，建议均衡任务分布" | actions]
    else
      actions
    end

    load_balance_risk = Enum.find(scheduling_risks, & &1.type == "load_balance")
    actions = if load_balance_risk && load_balance_risk.level in ["high", "medium"] do
      ["📊 负载优化：节点负载不均衡，建议调整调度策略" | actions]
    else
      actions
    end

    sp_risk = Enum.find(scheduling_risks, & &1.type == "single_point")
    actions = if sp_risk && sp_risk.level == "critical" do
      ["🛡️ 容灾建议：存在单点故障风险，建议增加节点冗余" | actions]
    else
      actions
    end

    peak_hour_forecasts = Enum.filter(forecasts, & &1.is_peak_hour)
    avg_peak_pressure = if length(peak_hour_forecasts) > 0, do: average(Enum.map(peak_hour_forecasts, & &1.node_pressure)), else: 0
    actions = if avg_peak_pressure > 50 do
      ["📅 排班建议：高峰时段建议安排弹性资源或提前处理积压任务" | actions]
    else
      actions
    end

    actions = if length(actions) == 0 do
      ["✅ 当前集群运行平稳，容量充足，无紧急操作需要"]
    else
      actions
    end

    Enum.reverse(actions)
  end
end
