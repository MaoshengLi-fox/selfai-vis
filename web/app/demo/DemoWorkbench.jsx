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
    status: 'Running',
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
  '{\n  "max_trials": 4,\n  "search_space": {\n    "dropout": [0.0, 0.5],\n    "lr": ["0.0001", "1"]\n  }\n}';

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

function MetricChart({ values }) {
  if (!values || values.length < 2) {
    return <div className={styles.cardHint}>Not enough points to render curve.</div>;
  }

  const width = 640;
  const height = 220;
  const padding = 20;
  const min = Math.min(...values) - 0.02;
  const max = Math.max(...values) + 0.02;
  const xStep = (width - padding * 2) / Math.max(values.length - 1, 1);

  const points = values
    .map((value, index) => {
      const x = padding + index * xStep;
      const y = height - padding - ((value - min) / (max - min || 1)) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chart} role="img" aria-label="Best so far metric curve">
      <polyline className={styles.chartLine} points={points} />
      {values.map((value, index) => {
        const x = padding + index * xStep;
        const y = height - padding - ((value - min) / (max - min || 1)) * (height - padding * 2);
        return <circle key={`${value}-${index}`} cx={x} cy={y} r="3.2" className={styles.chartDot} />;
      })}
    </svg>
  );
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
    objective: String(item?.objective || 'Optimize metric'),
    status: String(item?.status || 'Running'),
    progress: {
      done: Number(item?.progress?.done || 0),
      total: Number(item?.progress?.total || 0)
    },
    metricName: String(item?.metricName || 'metric'),
    bestMetric: typeof item?.bestMetric === 'number' ? item.bestMetric : null,
    curve: Array.isArray(item?.curve) ? item.curve.filter((v) => typeof v === 'number') : [],
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
  const [errorText, setErrorText] = useState('');
  const [userMessages, setUserMessages] = useState({});
  const [liveLogsByKey, setLiveLogsByKey] = useState({});
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
    const nextMaxTrials =
      Number.isFinite(Number(selectedExperiment.maxTrials)) && Number(selectedExperiment.maxTrials) > 0
        ? Number(selectedExperiment.maxTrials)
        : Number(selectedExperiment?.progress?.total || 20);
    const nextSearchSpace =
      selectedExperiment?.searchSpace && typeof selectedExperiment.searchSpace === 'object'
        ? selectedExperiment.searchSpace
        : {};
    setCommand(
      JSON.stringify(
        {
          max_trials: nextMaxTrials,
          search_space: nextSearchSpace
        },
        null,
        2
      )
    );
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
      setErrorText('Please input JSON containing max_trials and search_space');
      return;
    }
    if (!selectedExperiment || submitting) return;
    const targetExperiment = selectedExperiment;

    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(trimmed);
    } catch (error) {
      setErrorText(`Invalid JSON: ${error?.message || 'parse failed'}`);
      return;
    }

    const parsedMaxTrials = Number.parseInt(parsedPayload?.max_trials, 10);
    if (!Number.isFinite(parsedMaxTrials) || parsedMaxTrials <= 0) {
      setErrorText('max_trials must be a positive integer');
      return;
    }
    const parsedSearchSpace = parsedPayload?.search_space;
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
          command: typeof parsedPayload?.command === 'string' ? parsedPayload.command : null,
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
      setCommand(JSON.stringify(parsedPayload, null, 2));
    } catch (error) {
      setErrorText(`Failed to run demo optimize: ${error?.message || 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  }

  function focusInput() {
    if (!inputRef.current) return;
    const firstEditable = inputRef.current.querySelector('input, select, textarea');
    firstEditable?.focus();
  }

  function handleLogScroll() {
    const node = logPanelRef.current;
    if (!node) return;
    const gapToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    logAutoFollowRef.current = gapToBottom <= 24;
  }

  if (!selectedExperiment) {
    return null;
  }

  return (
    <main className={`${styles.page} demo-page`}>
      <div className={`${styles.shell} demo-layout`}>
        <a href="/#abstract" className={styles.backButton}>
          Back
        </a>

        <header className={styles.topHeader}>
          <h1>SelfAI Scientific Discovery Console</h1>
          <div className={styles.headerStatus}>
            <span title={selectedExperiment?.shortName || 'N/A'}>Active: {selectedExperiment?.shortName || 'N/A'}</span>
          </div>
          {errorText ? <p className={styles.cardHint}>{errorText}</p> : null}
        </header>

        <section className={styles.switcherWrap}>
          <div className={styles.switcher}>
            {categoryGroups.map((group) => {
              const selectedTask = selectedTaskByCategory[group.category] || group.tasks[0];
              const task = group.byTask.get(selectedTask) || group.byTask.get(group.tasks[0]);
              const modelKey = `${group.category}::${task?.taskName || ''}`;
              const selectedModel = task ? selectedModelByCategoryTask[modelKey] || task.models[0] : '';
              const experiment = task ? task.byModel.get(selectedModel) || task.byModel.get(task.models[0]) : null;
              const isActive = selectedCategory === group.category;
              return (
              <button
                key={group.category}
                type="button"
                onClick={() => setSelectedCategory(group.category)}
                className={`${styles.experimentCard} ${isActive ? styles.experimentCardActive : ''}`}
              >
                <strong>{group.category}</strong>
                <div className={styles.pickerRow}>
                  <label className={styles.modelPickerLabel}>
                    Task
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
                  </label>
                  <label className={styles.modelPickerLabel}>
                    Model
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
                  </label>
                </div>
                <span>
                  {experiment?.status || 'Running'} · {experiment?.progress.done || 0}/{experiment?.progress.total || 0}
                </span>
                <em>
                  Best: {typeof experiment?.bestMetric === 'number' ? experiment.bestMetric.toFixed(3) : '-'}
                </em>
              </button>
              );
            })}
            <button type="button" onClick={focusInput} className={`${styles.experimentCard} ${styles.newCard}`}>
              <strong>+ Ask in Context</strong>
              <span>Agent Input</span>
              <em>Focus command box</em>
            </button>
          </div>
        </section>

        <section className={styles.mainGrid}>
          <article className={`${styles.panel} ${styles.workspacePanel}`}>
            <h2>Agent Workspace</h2>
            <p className={styles.workspaceHint}>Send JSON only. This panel keeps user requests sent to backend.</p>
            <div className={styles.editorSection}>
              <div className={styles.sectionHeader}>
                <span>Messages</span>
                <small>{messages.length}</small>
              </div>
              <div className={styles.conversation}>
                {messages.length === 0 ? (
                  <div className={styles.emptyMessage}>No messages sent yet.</div>
                ) : (
                  messages.map((message, index) => (
                    <div key={`${message.role}-${index}`} className={`${styles.message} ${styles.messageUser}`}>
                      <label>User</label>
                      <JsonTextBlock text={message.content} />
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className={styles.editorSection}>
              <div className={styles.sectionHeader}>
                <span>JSON Input</span>
                <small>{submitting ? 'Running' : 'Ready'}</small>
              </div>
              <form onSubmit={handleCommandSubmit} className={styles.commandForm}>
                <div className={styles.commandInputWrap}>
                  <div className={styles.commandTreeWrap} ref={inputRef}>
                    <JsonEditorBlock text={command} defaultOpenDepth={2} onChange={setCommand} />
                  </div>
                  <button type="submit" disabled={loading || submitting}>
                    {submitting ? 'Running...' : 'Send'}
                  </button>
                </div>
              </form>
            </div>
          </article>

          <article className={`${styles.panel} ${styles.experimentPanel}`}>
            <h2>Selected Experiment View</h2>
            <div className={styles.experimentScroll}>
              <section className={styles.card}>
                <h3>Experiment Status</h3>
                <dl className={styles.statusList}>
                  <div>
                    <dt>Name</dt>
                    <dd>{selectedExperiment?.name}</dd>
                  </div>
                  <div>
                    <dt>Objective</dt>
                    <dd>{selectedExperiment?.objective}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{selectedExperiment?.status}</dd>
                  </div>
                  <div>
                    <dt>Progress</dt>
                    <dd>
                      {selectedExperiment?.progress.done} / {selectedExperiment?.progress.total} trials
                    </dd>
                  </div>
                  <div>
                    <dt>Metric</dt>
                    <dd>{selectedExperiment?.metricName}</dd>
                  </div>
                  <div>
                    <dt>Best Metric</dt>
                    <dd>{typeof selectedExperiment?.bestMetric === 'number' ? selectedExperiment.bestMetric.toFixed(3) : '-'}</dd>
                  </div>
                </dl>
              </section>

              <section className={styles.card}>
                <div className={styles.cardHeaderInline}>
                  <h3>Performance Curve</h3>
                  <p className={styles.cardHint}>Metric: Best-so-far value per trial</p>
                </div>
                <MetricChart values={selectedExperiment?.curve || []} />
              </section>

              <section className={styles.card}>
                <h3>Trial Results</h3>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Trial</th>
                        <th>Proposal</th>
                        <th>Metric</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedExperiment?.trials || []).map((trial) => (
                        <tr key={`${selectedExperiment.id}-${trial.id}`}>
                          <td>{trial.id}</td>
                          <td>{trial.proposal}</td>
                          <td>{typeof trial.metric === 'number' ? trial.metric.toFixed(3) : '-'}</td>
                          <td>{trial.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </article>
        </section>

        <section className={`${styles.panel} ${styles.logPanel}`}>
          <h2>Runtime Logs and Agent Trace</h2>
          <pre ref={logPanelRef} onScroll={handleLogScroll}>
            {runtimeLogs.map((line, index) => (
              <code key={`${selectedExperiment.id}-log-${index}`}>
                {line}
                {'\n'}
              </code>
            ))}
          </pre>
        </section>
      </div>
    </main>
  );
}
