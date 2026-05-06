'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './demo.module.css';

const RAW_API_BASE = process.env.NEXT_PUBLIC_SELFAI_API_BASE || 'http://127.0.0.1:8000';
const API_BASE = RAW_API_BASE.replace(/\/+$/, '');

const FALLBACK_EXPERIMENTS = [
  {
    id: 'fallback-ml',
    category: 'ML',
    taskKey: 'ml-boston',
    taskName: 'boston',
    modelName: 'local-fallback',
    shortName: 'ML · boston',
    name: 'boston / local fallback',
    objective: 'Optimize mean_score',
    status: 'Fallback',
    progress: { done: 0, total: 0 },
    metricName: 'mean_score',
    bestMetric: null,
    curve: [],
    trials: [],
    logs: ['Backend not connected. Showing fallback mode.'],
    conversation: [{ role: 'agent', content: 'Waiting for backend demo data...' }]
  }
];

const DEFAULT_PROMPT =
  'Optimize this experiment. Try a conservative local refinement, then explain why the next trials should improve the score.';

function parseJsonText(text) {
  if (typeof text !== 'string') {
    return { ok: false, value: null };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, value: null };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, value: null };
  }
}

function primitiveType(value) {
  if (value === null) return 'Null';
  if (typeof value === 'string') return 'String';
  if (typeof value === 'number') return 'Number';
  if (typeof value === 'boolean') return 'Boolean';
  return 'Other';
}

function formatPrimitive(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

function setValueAtPath(source, path, nextValue) {
  if (!Array.isArray(path) || path.length === 0) {
    return nextValue;
  }
  const [head, ...rest] = path;
  if (Array.isArray(source)) {
    const clone = [...source];
    clone[head] = setValueAtPath(clone[head], rest, nextValue);
    return clone;
  }
  const clone = { ...(source || {}) };
  clone[head] = setValueAtPath(clone[head], rest, nextValue);
  return clone;
}

function JsonNode({ nodeKey, value, depth = 0, defaultOpenDepth = 1 }) {
  const isArray = Array.isArray(value);
  const isObject = value && typeof value === 'object';

  if (isObject) {
    const entries = isArray ? value.map((item, index) => [index, item]) : Object.entries(value);
    const keyLabel = nodeKey === null ? 'root' : isArray ? `[${nodeKey}]` : `"${nodeKey}"`;
    const typeLabel = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

    return (
      <details className={styles.jsonNode} open={depth < defaultOpenDepth}>
        <summary>
          <span className={styles.jsonKey}>{keyLabel}</span>
          <span className={styles.jsonHint}>{typeLabel}</span>
        </summary>
        <div className={styles.jsonChildren}>
          {entries.map(([childKey, childValue]) => (
            <JsonNode
              key={`${depth}-${String(childKey)}`}
              nodeKey={childKey}
              value={childValue}
              depth={depth + 1}
              defaultOpenDepth={defaultOpenDepth}
            />
          ))}
        </div>
      </details>
    );
  }

  const type = primitiveType(value);
  const className =
    type === 'String'
      ? styles.jsonValueString
      : type === 'Number'
        ? styles.jsonValueNumber
        : type === 'Boolean'
          ? styles.jsonValueBoolean
          : type === 'Null'
            ? styles.jsonValueNull
            : styles.jsonValueOther;
  const keyLabel = nodeKey === null ? '' : typeof nodeKey === 'number' ? `[${nodeKey}]` : `"${nodeKey}"`;

  return (
    <div className={styles.jsonLeaf}>
      {keyLabel ? <span className={styles.jsonKey}>{keyLabel}</span> : null}
      {keyLabel ? <span className={styles.jsonColon}>:</span> : null}
      <span className={className}>{formatPrimitive(value)}</span>
    </div>
  );
}

function JsonTextBlock({ text, defaultOpenDepth = 1 }) {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    return <pre className={styles.jsonRaw}>{text || '(empty)'}</pre>;
  }
  return (
    <div className={styles.jsonTree}>
      <JsonNode nodeKey={null} value={parsed.value} defaultOpenDepth={defaultOpenDepth} />
    </div>
  );
}

function JsonEditorNode({ nodeKey, value, path, depth = 0, defaultOpenDepth = 1, onValueChange }) {
  const isArray = Array.isArray(value);
  const isObject = value && typeof value === 'object';

  if (isObject) {
    const entries = isArray ? value.map((item, index) => [index, item]) : Object.entries(value);
    const keyLabel = nodeKey === null ? 'root' : isArray ? `[${nodeKey}]` : `"${nodeKey}"`;
    const typeLabel = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

    return (
      <details className={styles.jsonNode} open={depth < defaultOpenDepth}>
        <summary>
          <span className={styles.jsonKey}>{keyLabel}</span>
          <span className={styles.jsonHint}>{typeLabel}</span>
        </summary>
        <div className={styles.jsonChildren}>
          {entries.map(([childKey, childValue]) => (
            <JsonEditorNode
              key={`${depth}-${String(childKey)}`}
              nodeKey={childKey}
              value={childValue}
              path={[...path, childKey]}
              depth={depth + 1}
              defaultOpenDepth={defaultOpenDepth}
              onValueChange={onValueChange}
            />
          ))}
        </div>
      </details>
    );
  }

  const keyLabel = nodeKey === null ? '' : typeof nodeKey === 'number' ? `[${nodeKey}]` : `"${nodeKey}"`;
  const type = primitiveType(value);

  return (
    <div className={styles.jsonLeaf}>
      {keyLabel ? <span className={styles.jsonKey}>{keyLabel}</span> : null}
      {keyLabel ? <span className={styles.jsonColon}>:</span> : null}
      {type === 'String' ? (
        <input
          className={styles.jsonValueEditor}
          type="text"
          value={value}
          onChange={(event) => onValueChange(path, event.target.value)}
        />
      ) : null}
      {type === 'Number' ? (
        <input
          className={styles.jsonValueEditor}
          type="number"
          step="any"
          value={value}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
              return;
            }
            const nextNumber = Number(raw);
            if (Number.isFinite(nextNumber)) {
              onValueChange(path, nextNumber);
            }
          }}
        />
      ) : null}
      {type === 'Boolean' ? (
        <select
          className={styles.jsonValueEditor}
          value={String(value)}
          onChange={(event) => onValueChange(path, event.target.value === 'true')}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : null}
      {type === 'Null' ? (
        <select className={styles.jsonValueEditor} value="null" onChange={() => {}}>
          <option value="null">null</option>
        </select>
      ) : null}
      {type === 'Other' ? <span className={styles.jsonValueOther}>{formatPrimitive(value)}</span> : null}
    </div>
  );
}

function JsonEditorBlock({ text, defaultOpenDepth = 2, onChange }) {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    return (
      <textarea
        className={styles.jsonRawEditor}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        placeholder={DEFAULT_PROMPT}
        rows={9}
      />
    );
  }
  return (
    <div className={styles.jsonTree}>
      <JsonEditorNode
        nodeKey={null}
        value={parsed.value}
        path={[]}
        defaultOpenDepth={defaultOpenDepth}
        onValueChange={(path, nextValue) => {
          const nextJson = setValueAtPath(parsed.value, path, nextValue);
          onChange(JSON.stringify(nextJson, null, 2));
        }}
      />
    </div>
  );
}

function MetricChart({ series, metricName = 'Metric', yTickCount = 3, yMinInput = '', yMaxInput = '', yStepInput = '', onYZoom, chartKey = 'chart' }) {
  if (!series || series.length < 2) {
    return <div className={styles.cardHint}>Not enough points to render curve.</div>;
  }

  const width = 640;
  const height = 220;
  const padding = { top: 18, right: 18, bottom: 42, left: 52 };
  const values = series.map((point) => point.value);
  const autoMin = Math.min(...values) - 0.02;
  const autoMax = Math.max(...values) + 0.02;
  const parsedYMin = Number(yMinInput);
  const parsedYMax = Number(yMaxInput);
  const parsedYStep = Number(yStepInput);
  const hasManualMin = yMinInput !== '' && Number.isFinite(parsedYMin);
  const hasManualMax = yMaxInput !== '' && Number.isFinite(parsedYMax);
  let min = hasManualMin ? parsedYMin : autoMin;
  let max = hasManualMax ? parsedYMax : autoMax;
  if (min >= max) {
    min = autoMin;
    max = autoMax;
  }
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xStep = chartWidth / Math.max(values.length - 1, 1);
  const hasManualStep = yStepInput !== '' && Number.isFinite(parsedYStep) && parsedYStep > 0;
  const yTicks = hasManualStep
    ? (() => {
        const ticks = [];
        const precisionGuard = 1e-9;
        for (let tick = min; tick <= max + precisionGuard && ticks.length < 40; tick += parsedYStep) {
          ticks.push(Number(tick.toFixed(6)));
        }
        if (ticks[ticks.length - 1] !== max) {
          ticks.push(max);
        }
        return ticks.reverse();
      })()
    : Array.from({ length: Math.min(8, Math.max(2, Number(yTickCount) || 3)) }, (_, index) => {
        const normalizedYTickCount = Math.min(8, Math.max(2, Number(yTickCount) || 3));
        return max - ((max - min) * index) / (normalizedYTickCount - 1);
      });

  const points = series
    .map((point, index) => {
      const x = padding.left + index * xStep;
      const y = padding.top + chartHeight - ((point.value - min) / (max - min || 1)) * chartHeight;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={styles.chart}
      role="img"
      aria-label="Best so far metric curve"
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onYZoom?.(event.deltaY > 0 ? 'out' : 'in', { min, max });
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
    >
      <defs>
        <clipPath id="metric-chart-clip">
          <rect x={padding.left} y={padding.top} width={chartWidth} height={chartHeight} />
        </clipPath>
      </defs>
      <line className={styles.axisLine} x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + chartHeight} />
      <line className={styles.axisLine} x1={padding.left} y1={padding.top + chartHeight} x2={padding.left + chartWidth} y2={padding.top + chartHeight} />
      {yTicks.map((tick) => {
        const y = padding.top + chartHeight - ((tick - min) / (max - min || 1)) * chartHeight;
        return (
          <g key={`y-${tick}`}>
            <line className={styles.gridLine} x1={padding.left} y1={y} x2={padding.left + chartWidth} y2={y} />
            <text className={styles.axisTick} x={padding.left - 8} y={y + 4} textAnchor="end">{tick.toFixed(2)}</text>
          </g>
        );
      })}
      {[0, Math.floor((series.length - 1) / 2), series.length - 1].map((index) => {
        const x = padding.left + index * xStep;
        return (
          <g key={`x-${index}`}>
            <line className={styles.tickLine} x1={x} y1={padding.top + chartHeight} x2={x} y2={padding.top + chartHeight + 5} />
            <text className={styles.axisTick} x={x} y={padding.top + chartHeight + 20} textAnchor="middle">{series[index].trial}</text>
          </g>
        );
      })}
      <text className={styles.axisLabel} x={padding.left + chartWidth / 2} y={height - 8} textAnchor="middle">Trial</text>
      <text className={styles.axisLabel} x={14} y={padding.top + chartHeight / 2} textAnchor="middle" transform={`rotate(-90 14 ${padding.top + chartHeight / 2})`}>
        {metricName}
      </text>
      <g clipPath="url(#metric-chart-clip)">
        <polyline className={styles.chartLine} points={points} />
        {series.map((point, index) => {
          const x = padding.left + index * xStep;
          const y = padding.top + chartHeight - ((point.value - min) / (max - min || 1)) * chartHeight;
        return <circle key={`${chartKey}-${point.trial}-${index}-${point.value}`} cx={x} cy={y} r="3.2" className={styles.chartDot} />;
      })}
      </g>
    </svg>
  );
}

function sampleCurve(values, stride) {
  const normalizedStride = Math.min(5, Math.max(1, Number(stride) || 1));
  const points = values.map((value, index) => ({ trial: index + 1, value }));
  if (normalizedStride <= 1 || points.length <= 2) {
    return points;
  }
  const sampled = points.filter((point, index) => index === 0 || index % normalizedStride === 0 || index === points.length - 1);
  const uniqueByTrial = new Map(sampled.map((point) => [point.trial, point]));
  return Array.from(uniqueByTrial.values()).sort((a, b) => a.trial - b.trial);
}

function clampGranularity(value) {
  return Math.min(5, Math.max(1, Number(value) || 1));
}

function clampYAxisTicks(value) {
  return Math.min(8, Math.max(2, Number(value) || 3));
}

function sanitizeAxisNumber(value) {
  if (value === '') return '';
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? value : '';
}

function formatAxisValue(value) {
  return Number(value.toFixed(6)).toString();
}

function autoYAxisDomain(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { min: 0, max: 1 };
  }
  const min = Math.min(...values) - 0.02;
  const max = Math.max(...values) + 0.02;
  if (min >= max) {
    return { min: min - 0.5, max: max + 0.5 };
  }
  return { min, max };
}

function toSafeExperiment(item) {
  const category = String(item?.category || 'NA');
  const shortName = String(item?.shortName || 'Unknown Task');
  const name = String(item?.name || 'Unknown Experiment');
  const derivedTaskName = shortName.includes('·') ? shortName.split('·').slice(1).join('·').trim() : shortName;
  const derivedModelName = name.includes('/') ? name.split('/').slice(1).join('/').trim() : 'unknown-model';
  const taskName = String(item?.taskName || derivedTaskName || 'task');
  const modelName = String(item?.modelName || derivedModelName || 'model');
  const taskKey = String(item?.taskKey || `${category}-${taskName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'));

  return {
    id: String(item?.id || Math.random().toString(36).slice(2)),
    category,
    taskKey,
    taskName,
    modelName,
    shortName,
    name,
    runFile: String(item?.runFile || ''),
    taskVariant: String(item?.taskVariant || ''),
    objective: String(item?.objective || 'Optimize metric'),
    status: String(item?.status || 'Unknown'),
    progress: {
      done: Number(item?.progress?.done || 0),
      total: Number(item?.progress?.total || 0)
    },
    metricName: String(item?.metricName || 'metric'),
    bestMetric: typeof item?.bestMetric === 'number' ? item.bestMetric : null,
    curve: Array.isArray(item?.curve) ? item.curve.filter((v) => typeof v === 'number') : [],
    metricValues: Array.isArray(item?.metricValues) ? item.metricValues.filter((v) => typeof v === 'number') : [],
    trials: Array.isArray(item?.trials)
      ? item.trials.map((trial, idx) => ({
          id: trial?.id ?? idx + 1,
          proposal: String(trial?.proposal || '-'),
          metric: typeof trial?.metric === 'number' ? trial.metric : null,
          status: String(trial?.status || 'Done')
        }))
      : [],
    logs: Array.isArray(item?.logs) ? item.logs.map((line) => String(line)) : [],
    conversation: Array.isArray(item?.conversation)
      ? item.conversation.map((msg) => ({
          role: msg?.role === 'user' ? 'user' : 'agent',
          content: String(msg?.content || '')
        }))
      : [],
    maxTrials: Number.isFinite(Number(item?.maxTrials)) ? Number(item.maxTrials) : null,
    completedTrials: Number.isFinite(Number(item?.completedTrials)) ? Number(item.completedTrials) : null,
    searchSpace: item?.searchSpace && typeof item.searchSpace === 'object' ? item.searchSpace : null
  };
}

function experimentMessageKey(experiment) {
  if (!experiment) return '';
  return `${experiment.category}::${experiment.taskName}::${experiment.modelName}`;
}

function areLogLinesEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function mergeLogLines(previousLogs, nextLogs) {
  const previous = Array.isArray(previousLogs) ? previousLogs : [];
  const next = Array.isArray(nextLogs) ? nextLogs : [];

  if (areLogLinesEqual(previous, next)) {
    return previous;
  }
  if (next.length < previous.length) {
    return next;
  }

  let prefixMatched = true;
  for (let i = 0; i < previous.length; i += 1) {
    if (previous[i] !== next[i]) {
      prefixMatched = false;
      break;
    }
  }
  if (prefixMatched) {
    return [...previous, ...next.slice(previous.length)];
  }
  return next;
}

function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('complete') || value.includes('succeed') || value.includes('done')) return 'ok';
  if (value.includes('fail') || value.includes('error')) return 'bad';
  if (value.includes('run') || value.includes('queue') || value.includes('pending')) return 'live';
  return 'idle';
}

export default function DemoWorkbench() {
  const [experiments, setExperiments] = useState(FALLBACK_EXPERIMENTS);
  const [selectedCategory, setSelectedCategory] = useState(FALLBACK_EXPERIMENTS[0].category);
  const [selectedTaskByCategory, setSelectedTaskByCategory] = useState(() =>
    Object.fromEntries(FALLBACK_EXPERIMENTS.map((experiment) => [experiment.category, experiment.taskName]))
  );
  const [selectedModelByCategoryTask, setSelectedModelByCategoryTask] = useState(() =>
    Object.fromEntries(FALLBACK_EXPERIMENTS.map((experiment) => [`${experiment.category}::${experiment.taskName}`, experiment.modelName]))
  );
  const [command, setCommand] = useState(DEFAULT_PROMPT);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [apiConnected, setApiConnected] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [userMessages, setUserMessages] = useState({});
  const [liveLogsByKey, setLiveLogsByKey] = useState({});
  const [showAllTrials, setShowAllTrials] = useState(false);
  const [curveStride, setCurveStride] = useState(1);
  const [curveMode, setCurveMode] = useState('raw');
  const [yAxisTicks, setYAxisTicks] = useState(3);
  const [yAxisMin, setYAxisMin] = useState('');
  const [yAxisMax, setYAxisMax] = useState('');
  const [yAxisStep, setYAxisStep] = useState('');
  const inputRef = useRef(null);
  const logPanelRef = useRef(null);
  const logAutoFollowRef = useRef(true);
  const hasLoadedRef = useRef(false);

  const categoryGroups = useMemo(() => {
    const groups = new Map();
    for (const experiment of experiments) {
      const categoryKey = experiment.category || 'NA';
      if (!groups.has(categoryKey)) {
        groups.set(categoryKey, {
          category: categoryKey,
          tasks: [],
          byTask: new Map()
        });
      }
      const group = groups.get(categoryKey);
      if (!group.byTask.has(experiment.taskName)) {
        group.tasks.push(experiment.taskName);
        group.byTask.set(experiment.taskName, {
          taskName: experiment.taskName,
          shortName: experiment.shortName,
          models: [],
          byModel: new Map()
        });
      }
      const task = group.byTask.get(experiment.taskName);
      if (!task.byModel.has(experiment.modelName)) {
        task.models.push(experiment.modelName);
      }
      task.byModel.set(experiment.modelName, experiment);
    }
    return Array.from(groups.values())
      .map((group) => {
        group.tasks.sort((a, b) => a.localeCompare(b));
        return group;
      })
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [experiments]);

  useEffect(() => {
    if (!categoryGroups.length) {
      return;
    }

    setSelectedCategory((prev) => (categoryGroups.some((group) => group.category === prev) ? prev : categoryGroups[0].category));

    setSelectedTaskByCategory((prev) => {
      const next = { ...prev };
      for (const group of categoryGroups) {
        const current = next[group.category];
        if (!current || !group.byTask.has(current)) {
          next[group.category] = group.tasks[0];
        }
      }
      return next;
    });

    setSelectedModelByCategoryTask((prev) => {
      const next = { ...prev };
      for (const group of categoryGroups) {
        for (const taskName of group.tasks) {
          const task = group.byTask.get(taskName);
          const key = `${group.category}::${taskName}`;
          const current = next[key];
          if (!current || !task.byModel.has(current)) {
            next[key] = task.models[0];
          }
        }
      }
      return next;
    });
  }, [categoryGroups]);

  useEffect(() => {
    if (hasLoadedRef.current) {
      return undefined;
    }
    hasLoadedRef.current = true;

    let active = true;
    const controller = new AbortController();

    async function loadExperiments() {
      try {
        setLoading(true);
        setErrorText('');
        const response = await fetch(`${API_BASE}/api/v1/demo/experiments`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (!active) return;

        const next = Array.isArray(payload) && payload.length ? payload.map(toSafeExperiment) : FALLBACK_EXPERIMENTS;
        setApiConnected(true);
        setExperiments(next);
        setSelectedCategory(next[0].category);
        setSelectedTaskByCategory((prev) => {
          const merged = { ...prev };
          next.forEach((exp) => {
            if (!merged[exp.category]) {
              merged[exp.category] = exp.taskName;
            }
          });
          return merged;
        });
        setSelectedModelByCategoryTask((prev) => {
          const merged = { ...prev };
          next.forEach((exp) => {
            const key = `${exp.category}::${exp.taskName}`;
            if (!merged[key]) {
              merged[key] = exp.modelName;
            }
          });
          return merged;
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
        if (!active) return;
        setApiConnected(false);
        setErrorText(`Failed to load backend demo data: ${error?.message || 'Unknown error'}`);
        setExperiments(FALLBACK_EXPERIMENTS);
        setSelectedCategory(FALLBACK_EXPERIMENTS[0].category);
        setSelectedTaskByCategory({ [FALLBACK_EXPERIMENTS[0].category]: FALLBACK_EXPERIMENTS[0].taskName });
        setSelectedModelByCategoryTask({
          [`${FALLBACK_EXPERIMENTS[0].category}::${FALLBACK_EXPERIMENTS[0].taskName}`]: FALLBACK_EXPERIMENTS[0].modelName
        });
      } finally {
        if (active) setLoading(false);
      }
    }

    loadExperiments();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const selectedExperiment = useMemo(() => {
    const currentCategoryGroup = categoryGroups.find((group) => group.category === selectedCategory) || categoryGroups[0];
    if (!currentCategoryGroup) {
      return experiments[0];
    }

    const selectedTask = selectedTaskByCategory[currentCategoryGroup.category] || currentCategoryGroup.tasks[0];
    const task = currentCategoryGroup.byTask.get(selectedTask) || currentCategoryGroup.byTask.get(currentCategoryGroup.tasks[0]);
    if (!task) {
      return experiments[0];
    }
    const modelKey = `${currentCategoryGroup.category}::${task.taskName}`;
    const selectedModel = selectedModelByCategoryTask[modelKey] || task.models[0];
    return task.byModel.get(selectedModel) || task.byModel.get(task.models[0]) || experiments[0];
  }, [categoryGroups, experiments, selectedCategory, selectedModelByCategoryTask, selectedTaskByCategory]);

  const messageKey = experimentMessageKey(selectedExperiment);
  const messages = userMessages[messageKey] || [];
  const runtimeLogs = useMemo(() => {
    const liveLogs = liveLogsByKey[messageKey];
    if (Array.isArray(liveLogs)) {
      return liveLogs;
    }
    return selectedExperiment?.logs || [];
  }, [liveLogsByKey, messageKey, selectedExperiment]);
  const agentStatus = submitting ? 'Running' : loading ? 'Loading' : apiConnected ? 'Ready' : 'Fallback';
  const backendStatus = loading ? 'Checking' : apiConnected ? 'Connected' : 'Offline';

  useEffect(() => {
    if (!selectedExperiment) return;
    const key = experimentMessageKey(selectedExperiment);
    const nextLogs = Array.isArray(selectedExperiment.logs) ? selectedExperiment.logs : [];
    setLiveLogsByKey((previous) => {
      const merged = mergeLogLines(previous[key], nextLogs);
      if (previous[key] === merged) {
        return previous;
      }
      return { ...previous, [key]: merged };
    });
  }, [selectedExperiment]);

  useEffect(() => {
    if (!selectedExperiment) {
      return undefined;
    }
    const statusText = String(selectedExperiment.status || '').toLowerCase();
    const shouldPoll = submitting || statusText.includes('running') || statusText.includes('pending') || statusText.includes('queued');
    if (!shouldPoll) {
      return undefined;
    }

    let stopped = false;
    const key = experimentMessageKey(selectedExperiment);

    async function refreshSelectedExperiment() {
      try {
        const response = await fetch(`${API_BASE}/api/v1/demo/experiments`);
        if (!response.ok) return;
        const payload = await response.json();
        if (!Array.isArray(payload) || stopped) return;
        const next = payload.map(toSafeExperiment);
        const fresh = next.find((item) => experimentMessageKey(item) === key);
        if (!fresh) return;
        setLiveLogsByKey((previous) => {
          const merged = mergeLogLines(previous[key], fresh.logs);
          if (previous[key] === merged) {
            return previous;
          }
          return { ...previous, [key]: merged };
        });

        setExperiments((previous) => {
          const filtered = previous.filter((item) => experimentMessageKey(item) !== key);
          return [...filtered, fresh];
        });
      } catch {
        // keep silent during polling
      }
    }

    refreshSelectedExperiment();
    const timer = setInterval(refreshSelectedExperiment, 700);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [submitting, selectedExperiment]);

  useEffect(() => {
    logAutoFollowRef.current = true;
    setShowAllTrials(false);
  }, [messageKey]);

  useEffect(() => {
    const node = logPanelRef.current;
    if (!node) return;
    if (logAutoFollowRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [runtimeLogs.length, messageKey]);

  useEffect(() => {
    if (!selectedExperiment) {
      return;
    }
    setCommand(`Optimize ${selectedExperiment.shortName}. Focus on the next promising trials and explain the expected improvement.`);
    setCurveMode('raw');
    setCurveStride(1);
    setYAxisMin('');
    setYAxisMax('');
  }, [selectedExperiment?.id]);

  function handleTaskChange(category, taskName) {
    setSelectedCategory(category);
    setSelectedTaskByCategory((prev) => ({ ...prev, [category]: taskName }));
  }

  function handleModelChange(category, taskName, modelName) {
    setSelectedCategory(category);
    setSelectedTaskByCategory((prev) => ({ ...prev, [category]: taskName }));
    setSelectedModelByCategoryTask((prev) => ({ ...prev, [`${category}::${taskName}`]: modelName }));
  }

  async function handleCommandSubmit(event) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) {
      setErrorText('Please enter a message for the SelfAI agent');
      return;
    }
    if (!selectedExperiment || submitting) return;
    const targetExperiment = selectedExperiment;

    let parsedPayload = null;
    let isJsonCommand = false;
    try {
      parsedPayload = JSON.parse(trimmed);
      isJsonCommand = parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload);
    } catch {
      parsedPayload = null;
    }

    const defaultMaxTrials =
      Number.isFinite(Number(targetExperiment.maxTrials)) && Number(targetExperiment.maxTrials) > 0
        ? Number(targetExperiment.maxTrials)
        : Number(targetExperiment?.progress?.total || 4) || 4;
    const defaultSearchSpace =
      targetExperiment?.searchSpace && typeof targetExperiment.searchSpace === 'object' ? targetExperiment.searchSpace : {};
    const parsedMaxTrials = isJsonCommand ? Number.parseInt(parsedPayload?.max_trials, 10) : defaultMaxTrials;
    if (!Number.isFinite(parsedMaxTrials) || parsedMaxTrials <= 0) {
      setErrorText('max_trials must be a positive integer');
      return;
    }
    const parsedSearchSpace = isJsonCommand ? parsedPayload?.search_space : defaultSearchSpace;
    if (!parsedSearchSpace || typeof parsedSearchSpace !== 'object' || Array.isArray(parsedSearchSpace)) {
      setErrorText('search_space must be a JSON object');
      return;
    }

    setErrorText('');
    setSubmitting(true);
    setUserMessages((previous) => {
      const userMessage = trimmed
        ? { role: 'user', content: trimmed }
        : { role: 'user', content: `Run demo with max_trials=${parsedMaxTrials}` };
      const key = experimentMessageKey(targetExperiment);
      const nextMessages = [...(previous[key] || []), userMessage];
      return { ...previous, [key]: nextMessages };
    });

    try {
      const response = await fetch(`${API_BASE}/api/v1/demo/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: targetExperiment.category,
          taskName: targetExperiment.taskName,
           modelName: targetExperiment.modelName,
           model: targetExperiment.modelName,
           max_trials: parsedMaxTrials,
           search_space: parsedSearchSpace,
          command: isJsonCommand && typeof parsedPayload?.command === 'string' ? parsedPayload.command : trimmed,
           n_jobs: 1
         })
       });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.detail || `HTTP ${response.status}`);
      }
      const payload = await response.json();
      const updatedExperiment = payload?.experiment ? toSafeExperiment(payload.experiment) : null;

      if (updatedExperiment) {
        setExperiments((previous) => {
          const filtered = previous.filter(
            (item) =>
              !(
                item.category === updatedExperiment.category &&
                item.taskName === updatedExperiment.taskName &&
                item.modelName === updatedExperiment.modelName
              )
          );
          return [...filtered, updatedExperiment];
        });
      }
      setCommand('');
    } catch (error) {
      setErrorText(`Failed to run demo optimize: ${error?.message || 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  }

  function focusInput() {
    if (!inputRef.current) return;
    inputRef.current.focus();
  }

  function handleLogScroll() {
    const node = logPanelRef.current;
    if (!node) return;
    const gapToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    logAutoFollowRef.current = gapToBottom <= 24;
  }

  const selectedProgressTotal = selectedExperiment?.progress?.total || selectedExperiment?.maxTrials || 0;
  const selectedProgressDone = selectedExperiment?.progress?.done || selectedExperiment?.completedTrials || 0;
  const selectedProgressPercent = selectedProgressTotal > 0 ? Math.min(100, (selectedProgressDone / selectedProgressTotal) * 100) : 0;
  const activeTone = statusTone(selectedExperiment?.status);
  const timelineMessages = [
    ...(selectedExperiment?.conversation || []),
    ...messages
  ].slice(-7);
  const allTrials = selectedExperiment?.trials || [];
  const displayedTrials = showAllTrials ? allTrials : allTrials.slice(-6);
  const rawMetricValues = selectedExperiment?.metricValues?.length
    ? selectedExperiment.metricValues
    : allTrials.map((trial) => trial.metric).filter((value) => typeof value === 'number');
  const curveValues = curveMode === 'best' ? selectedExperiment?.curve || [] : rawMetricValues;
  const chartSeries = sampleCurve(curveValues, curveStride);
  const chartRenderKey = `${selectedExperiment.id}-${selectedExperiment.runFile || ''}-${curveMode}-${curveStride}`;
  const chartValues = chartSeries.map((point) => point.value);
  function handleYZoom(direction, currentDomain) {
    const fallbackDomain = autoYAxisDomain(chartValues);
    const min = Number.isFinite(Number(yAxisMin)) && yAxisMin !== '' ? Number(yAxisMin) : currentDomain?.min ?? fallbackDomain.min;
    const max = Number.isFinite(Number(yAxisMax)) && yAxisMax !== '' ? Number(yAxisMax) : currentDomain?.max ?? fallbackDomain.max;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return;
    const center = (min + max) / 2;
    const nextRange = (max - min) * (direction === 'in' ? 0.82 : 1.22);
    const minRange = Math.max(Math.abs(center) * 0.0001, 0.000001);
    const boundedRange = Math.max(nextRange, minRange);
    setYAxisMin(formatAxisValue(center - boundedRange / 2));
    setYAxisMax(formatAxisValue(center + boundedRange / 2));
  }
  const bestTrialMetric = allTrials.reduce((best, trial) => {
    if (typeof trial.metric !== 'number') return best;
    if (best === null || trial.metric > best) return trial.metric;
    return best;
  }, null);

  if (!selectedExperiment) {
    return null;
  }

  return (
    <main className={`${styles.page} demo-page`}>
      <div className={styles.appShell}>
        <header className={styles.topBar}>
          <div className={styles.brandBlock}>
            <a href="/#abstract" className={styles.brand}>SelfAI</a>
            <span className={styles.topTitle}>Scientific Discovery Console</span>
          </div>
          <div className={styles.statusRow}>
            <span className={styles.statusChip}>
              <i className={`${styles.dot} ${submitting ? styles.dotLive : apiConnected ? styles.dotOk : styles.dotBad}`} />
              Agent: {agentStatus}
            </span>
            <span className={styles.statusChip}>
              <i className={`${styles.dot} ${apiConnected ? styles.dotOk : loading ? styles.dotLive : styles.dotBad}`} />
              Backend: {backendStatus}
            </span>
            <span className={styles.statusChip}>Active: {selectedExperiment?.shortName || 'N/A'}</span>
          </div>
          <div className={styles.topTools}>
            <span>?</span>
            <span>◎</span>
            <span>U</span>
            <strong>User</strong>
          </div>
        </header>

        <div className={styles.body}>
          <aside className={styles.sidebar}>
            <nav className={styles.sideNav}>
              {['Home', 'Experiments', 'Search Space', 'Trials', 'Visualizations', 'Artifacts', 'Reports', 'Settings'].map((item, idx) => (
                <button key={item} type="button" className={`${styles.sideItem} ${idx === 1 ? styles.sideItemActive : ''}`}>
                  <span className={styles.sideIcon}>{idx === 0 ? '⌂' : idx === 1 ? '⌁' : idx === 2 ? '⌕' : idx === 3 ? '⎈' : idx === 4 ? '⌁' : idx === 5 ? '□' : idx === 6 ? '◫' : '⚙'}</span>
                  {item}
                </button>
              ))}
            </nav>
            <div className={styles.quickActions}>
              <h4>Quick Actions</h4>
              <button type="button" onClick={focusInput}><strong>Ask SelfAI</strong><span>Start a new experiment</span></button>
              <button type="button"><strong>Explain Result</strong><span>Why did this improve?</span></button>
              <button type="button" className={styles.stopButton}><strong>Stop Experiment</strong><span>Halt running trials</span></button>
              <button type="button"><strong>Compare Experiments</strong><span>Side-by-side analysis</span></button>
            </div>
          </aside>

          <section className={styles.workspace}>
            <div className={styles.cardGrid}>
              {categoryGroups.map((group) => {
                const selectedTask = selectedTaskByCategory[group.category] || group.tasks[0];
                const task = group.byTask.get(selectedTask) || group.byTask.get(group.tasks[0]);
                const modelKey = `${group.category}::${task?.taskName || ''}`;
                const selectedModel = task ? selectedModelByCategoryTask[modelKey] || task.models[0] : '';
                const experiment = task ? task.byModel.get(selectedModel) || task.byModel.get(task.models[0]) : null;
                const isActive = selectedCategory === group.category;
                const tone = statusTone(experiment?.status);
                return (
                  <button
                    key={group.category}
                    type="button"
                    onClick={() => setSelectedCategory(group.category)}
                    className={`${styles.expCard} ${isActive ? styles.expCardActive : ''}`}
                  >
                    <div className={styles.expCardHead}>
                      <span className={styles.expIcon}>{group.category.slice(0, 2)}</span>
                      <strong>{experiment?.shortName || group.category}</strong>
                      <span className={styles.moreDots}>⋮</span>
                    </div>
                    <div className={styles.expMetaRow}>
                      <i className={`${styles.dot} ${tone === 'ok' ? styles.dotOk : tone === 'bad' ? styles.dotBad : styles.dotLive}`} />
                      <span>{experiment?.status || 'Unknown'}</span>
                      <b>{experiment?.progress.done || 0}/{experiment?.progress.total || 0} trials</b>
                    </div>
                    <div className={styles.progressTrack}>
                      <span style={{ width: `${experiment?.progress?.total ? Math.min(100, (experiment.progress.done / experiment.progress.total) * 100) : 0}%` }} />
                    </div>
                    <div className={styles.expSelectRow}>
                      <select
                        className={styles.modelPicker}
                        value={selectedTask}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          handleTaskChange(group.category, event.target.value);
                        }}
                      >
                        {group.tasks.map((taskName) => (
                          <option key={`${group.category}-${taskName}`} value={taskName}>
                            {taskName}
                          </option>
                        ))}
                      </select>
                      <select
                        className={styles.modelPicker}
                        value={selectedModel}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          handleModelChange(group.category, selectedTask, event.target.value);
                        }}
                      >
                        {(task?.models || []).map((modelName) => (
                          <option key={`${group.category}-${selectedTask}-${modelName}`} value={modelName}>
                            {modelName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </button>
                );
              })}
              <button type="button" onClick={focusInput} className={`${styles.expCard} ${styles.newCard}`}>
                <span className={styles.newPlus}>+</span>
                <strong>New via AI</strong>
                <span>Ask Agent</span>
              </button>
            </div>

            {errorText ? <p className={styles.inlineError}>{errorText}</p> : null}

            <div className={styles.coreGrid}>
              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Agent Workspace</h2>
                  <span>⋮</span>
                </div>
                <div className={styles.conversation}>
                  {timelineMessages.length === 0 ? (
                    <div className={styles.emptyMessage}>No messages sent yet.</div>
                  ) : (
                    timelineMessages.map((message, index) => (
                      <div key={`${message.role}-${index}`} className={`${styles.message} ${message.role === 'user' ? styles.messageUser : styles.messageAgent}`}>
                        <span className={styles.avatar}>{message.role === 'user' ? 'U' : 'S'}</span>
                        <div>
                          <label>{message.role === 'user' ? 'You' : 'SelfAI Agent'}</label>
                          <JsonTextBlock text={message.content} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={handleCommandSubmit} className={styles.commandForm}>
                  <div className={styles.commandInputWrap}>
                    <textarea
                      ref={inputRef}
                      className={styles.chatInput}
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      placeholder="Tell SelfAI what to explore, compare, explain, or optimize..."
                      rows={5}
                    />
                    <button type="submit" disabled={loading || submitting} aria-label="Send command">
                      {submitting ? 'Running...' : '➤'}
                    </button>
                  </div>
                </form>
              </article>

              <div className={styles.experimentArea}>
                <article className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <h2>{selectedExperiment?.shortName || 'Experiment'}</h2>
                    <span>Refresh ⋯</span>
                  </div>
                  <section className={styles.statusStrip}>
                    <div><span>Objective</span><strong>{selectedExperiment?.objective}</strong></div>
                    <div><span>Status</span><strong className={styles[`tone_${activeTone}`]}>{selectedExperiment?.status}</strong></div>
                    <div><span>Progress</span><strong>{selectedProgressDone}/{selectedProgressTotal} trials</strong><i><b style={{ width: `${selectedProgressPercent}%` }} /></i></div>
                    <div>
                      <span>Best ({selectedExperiment?.metricName})</span>
                      <strong className={styles.bestMetric}>{typeof selectedExperiment?.bestMetric === 'number' ? selectedExperiment.bestMetric.toFixed(3) : '-'}</strong>
                    </div>
                  </section>
                  <div className={styles.tabs}>
                    {['Overview', 'Trials', 'Metrics', 'Params', 'Artifacts'].map((tab, index) => <button key={tab} className={index === 0 ? styles.tabActive : ''} type="button">{tab}</button>)}
                  </div>
                  <div className={styles.analyticsGrid}>
                    <section className={styles.card}>
                      <div className={styles.cardHeaderInline}>
                        <div>
                          <h3>Performance</h3>
                          <p className={styles.cardHint}>
                            {curveMode === 'best' ? 'Best-so-far' : 'Raw trial'} {selectedExperiment?.metricName} · {chartSeries.length} points
                            {selectedExperiment?.taskVariant ? ` · ${selectedExperiment.taskVariant}` : ''}
                            {selectedExperiment?.runFile ? ` · ${selectedExperiment.runFile}` : ''}
                          </p>
                        </div>
                        <label className={styles.granularityControl}>
                          Curve
                          <select value={curveMode} onChange={(event) => setCurveMode(event.target.value)}>
                            <option value="raw">Raw trials</option>
                            <option value="best">Best-so-far</option>
                          </select>
                        </label>
                        <label className={styles.granularityControl}>
                          X Granularity
                          <input
                            type="number"
                            min="1"
                            max="5"
                            step="1"
                            value={curveStride}
                            onChange={(event) => {
                              setCurveStride(clampGranularity(event.target.value));
                            }}
                            onWheel={(event) => {
                              event.preventDefault();
                              const direction = event.deltaY > 0 ? 1 : -1;
                              setCurveStride((value) => clampGranularity(value + direction));
                            }}
                            aria-label="Curve granularity from 1 to 5 trials"
                          />
                        </label>
                        <label className={styles.granularityControl}>
                          Y Ticks
                          <input
                            type="number"
                            min="2"
                            max="8"
                            step="1"
                            value={yAxisTicks}
                            onChange={(event) => {
                              setYAxisTicks(clampYAxisTicks(event.target.value));
                            }}
                            onWheel={(event) => {
                              event.preventDefault();
                              const direction = event.deltaY > 0 ? 1 : -1;
                              setYAxisTicks((value) => clampYAxisTicks(value + direction));
                            }}
                            aria-label="Y axis tick count from 2 to 8"
                          />
                        </label>
                        <label className={styles.granularityControl}>
                          Y Step
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={yAxisStep}
                            onChange={(event) => setYAxisStep(sanitizeAxisNumber(event.target.value))}
                            placeholder="Auto"
                            aria-label="Y axis minimum tick step"
                          />
                        </label>
                        <div className={styles.zoomControls} aria-label="Y axis zoom controls">
                          <button type="button" onClick={() => handleYZoom('in')}>Zoom In</button>
                          <button type="button" onClick={() => handleYZoom('out')}>Zoom Out</button>
                          <button type="button" onClick={() => { setYAxisMin(''); setYAxisMax(''); }}>Reset</button>
                        </div>
                      </div>
                      <MetricChart
                        key={chartRenderKey}
                        chartKey={chartRenderKey}
                        series={chartSeries}
                        metricName={selectedExperiment?.metricName}
                        yTickCount={yAxisTicks}
                        yMinInput={yAxisMin}
                        yMaxInput={yAxisMax}
                        yStepInput={yAxisStep}
                        onYZoom={handleYZoom}
                      />
                      <div className={styles.metricChips}>
                        <span>Dice Score <b>Minimize</b></span>
                        <span>AUP_D <b>Maximize</b></span>
                        <span>Hausdorff (95) <b>Minimize</b></span>
                        <button type="button">+ Add Metric</button>
                      </div>
                    </section>
                    <section className={styles.card}>
                      <div className={styles.cardHeaderInline}>
                        <div>
                          <h3>Trial Results</h3>
                          <p className={styles.cardHint}>{showAllTrials ? `Showing all ${displayedTrials.length} trials` : `Showing latest ${displayedTrials.length} trials`}</p>
                        </div>
                        <button type="button" className={styles.linkButton} onClick={() => setShowAllTrials((value) => !value)}>
                          {showAllTrials ? 'Show Latest' : 'View All Trials'}
                        </button>
                      </div>
                      <div className={styles.tableWrap}>
                        <table>
                          <thead>
                            <tr>
                              <th>Trial</th>
                              <th>{selectedExperiment?.metricName}</th>
                              <th>Proposal</th>
                              <th>State</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayedTrials.map((trial) => (
                              <tr key={`${selectedExperiment.id}-${trial.id}`}>
                                <td>{trial.id}</td>
                                <td>{typeof trial.metric === 'number' ? trial.metric.toFixed(3) : '-'}</td>
                                <td>{trial.proposal}</td>
                                <td><span className={styles.stateBadge}><i className={`${styles.dot} ${trial.metric === bestTrialMetric ? styles.dotLive : styles.dotOk}`} />{trial.metric === bestTrialMetric ? 'Best' : trial.status}</span></td>
                                <td><span className={styles.actionIcons}>◎ ▥</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                </article>
              </div>
            </div>

            <section className={styles.logPanel}>
              <div className={styles.logHeader}>
                <div><h2>Runtime Logs</h2><span>Agent Trace</span></div>
                <div className={styles.logControls}><span>All Levels</span><span>Search logs...</span></div>
              </div>
              <pre ref={logPanelRef} onScroll={handleLogScroll}>
                {runtimeLogs.map((line, index) => (
                  <code key={`${selectedExperiment.id}-log-${index}`}>
                    {line}
                    {'\n'}
                  </code>
                ))}
              </pre>
            </section>
          </section>
        </div>
      </div>
    </main>
  );
}
