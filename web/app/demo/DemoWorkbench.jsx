'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './demo.module.css';

const API_BASE = process.env.NEXT_PUBLIC_SELFAI_API_BASE || 'http://127.0.0.1:8000';

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
  'Tell SelfAI what to do: switch to a task, explain latest result, compare current experiments, or export summary.';

function buildAgentReply(command, activeExperiment) {
  if (/explain|why/i.test(command)) {
    return `For ${activeExperiment.shortName}, I recommend checking recent high-performing trials and then narrowing around similar parameter combinations.`;
  }

  if (/stop|saturated|halt/i.test(command)) {
    return `Current status for ${activeExperiment.shortName} is ${activeExperiment.status}. We can stop once improvement plateaus over several rounds.`;
  }

  if (/compare/i.test(command)) {
    return 'I can compare progress, best metric, and runtime traces across currently loaded category-level experiments.';
  }

  if (/export/i.test(command)) {
    return `Prepared export plan for ${activeExperiment.shortName}: status summary, trial slice, and runtime logs.`;
  }

  return `Action noted for ${activeExperiment.shortName}. I will keep this experiment context active.`;
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
      : []
  };
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
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [conversations, setConversations] = useState(() =>
    Object.fromEntries(FALLBACK_EXPERIMENTS.map((experiment) => [experiment.id, experiment.conversation]))
  );
  const inputRef = useRef(null);
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
        setConversations((prev) => {
          const merged = { ...prev };
          next.forEach((exp) => {
            if (!merged[exp.id]) {
              merged[exp.id] = exp.conversation;
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

  const messages = conversations[selectedExperiment?.id] || selectedExperiment?.conversation || [];

  function findExperimentByCommand(input) {
    const normalized = input.toLowerCase();
    return (
      experiments.find((exp) => `${exp.shortName} ${exp.taskName} ${exp.modelName} ${exp.name}`.toLowerCase().includes(normalized)) ||
      null
    );
  }

  function handleTaskChange(category, taskName) {
    setSelectedCategory(category);
    setSelectedTaskByCategory((prev) => ({ ...prev, [category]: taskName }));
  }

  function handleModelChange(category, taskName, modelName) {
    setSelectedCategory(category);
    setSelectedTaskByCategory((prev) => ({ ...prev, [category]: taskName }));
    setSelectedModelByCategoryTask((prev) => ({ ...prev, [`${category}::${taskName}`]: modelName }));
  }

  function handleCommandSubmit(event) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || !selectedExperiment) return;

    const directExperiment = findExperimentByCommand(trimmed);
    const isSwitchCommand = /switch to|switch|focus on|go to/i.test(trimmed) && directExperiment;
    const nextSelectedId = isSwitchCommand ? directExperiment.id : selectedExperiment.id;
    const targetExperiment = experiments.find((exp) => exp.id === nextSelectedId) || selectedExperiment;

    setConversations((previous) => {
      const nextMessages = [
        ...(previous[nextSelectedId] || []),
        { role: 'user', content: trimmed },
        { role: 'agent', content: buildAgentReply(trimmed, targetExperiment) }
      ];
      return { ...previous, [nextSelectedId]: nextMessages };
    });

    if (isSwitchCommand) {
      setSelectedCategory(directExperiment.category);
      setSelectedTaskByCategory((prev) => ({ ...prev, [directExperiment.category]: directExperiment.taskName }));
      setSelectedModelByCategoryTask((prev) => ({
        ...prev,
        [`${directExperiment.category}::${directExperiment.taskName}`]: directExperiment.modelName
      }));
    }

    setCommand('');
  }

  function focusInput() {
    inputRef.current?.focus();
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
            <div className={styles.conversation}>
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={styles.message}>
                  <label>{message.role === 'user' ? 'User' : 'SelfAI Agent'}</label>
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
            <form onSubmit={handleCommandSubmit} className={styles.commandForm}>
              <div className={styles.commandInputWrap}>
                <textarea
                  ref={inputRef}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder={DEFAULT_PROMPT}
                  rows={3}
                />
                <button type="submit">Send</button>
              </div>
            </form>
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
          <pre>
            {(selectedExperiment?.logs || []).map((line, index) => (
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
