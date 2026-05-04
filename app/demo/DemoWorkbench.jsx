'use client';

import { useMemo, useRef, useState } from 'react';
import styles from './demo.module.css';

const EXPERIMENTS = [
  {
    id: 'siren',
    shortName: 'SIREN Segmentation',
    name: 'SIREN Image Segmentation',
    objective: 'Improve Dice Score',
    status: 'Running',
    progress: { done: 12, total: 25 },
    bestMetric: 0.892,
    score: 0.814,
    aupd: 0.238,
    runtime: '00:23:41',
    curve: [0.701, 0.721, 0.803, 0.812, 0.846, 0.892, 0.892, 0.892, 0.892, 0.892, 0.892, 0.892],
    trials: [
      { id: 1, proposal: 'broad initial trial', metric: 0.721, score: 0.693, aupd: 0.118, status: 'Done' },
      { id: 2, proposal: 'lower learning rate', metric: 0.803, score: 0.741, aupd: 0.151, status: 'Done' },
      { id: 3, proposal: 'refine candidate', metric: 0.812, score: 0.759, aupd: 0.179, status: 'Done' },
      { id: 4, proposal: 'larger hidden dim', metric: 0.846, score: 0.791, aupd: 0.221, status: 'Done' },
      { id: 5, proposal: 'local refinement', metric: 0.892, score: 0.814, aupd: 0.238, status: 'Best' }
    ],
    logs: [
      '[SIREN][00:00:01] Agent received user request: optimize SIREN image segmentation.',
      '[SIREN][00:00:03] Internal YAML configuration generated from conversation.',
      '[SIREN][00:00:04] Python runner started by Experiment Manager.',
      '[SIREN][00:08:01] Trial 1 completed: metric=0.721.',
      '[SIREN][00:17:01] Trial 5 completed: metric=0.892, current best.'
    ],
    conversation: [
      { role: 'user', content: 'Optimize SIREN image segmentation.' },
      {
        role: 'agent',
        content:
          'Context: SIREN Segmentation\nAction: Continue experiment\nReason: Recent trials still improve metric.\nNext focus: lower learning rate region.\nDisplay: Updated curve and trial table.'
      },
      { role: 'user', content: 'Explain why Trial 5 improved.' },
      {
        role: 'agent',
        content:
          'Trial 5 uses a lower learning rate with a larger hidden dimension, improving optimization stability and representation quality.'
      }
    ]
  },
  {
    id: 'boston',
    shortName: 'Boston RF',
    name: 'Boston RF Regression',
    objective: 'Maximize Validation R2',
    status: 'Completed',
    progress: { done: 162, total: 162 },
    bestMetric: 0.937,
    score: 0.902,
    aupd: 0.164,
    runtime: '01:54:20',
    curve: [0.71, 0.78, 0.83, 0.88, 0.903, 0.918, 0.926, 0.933, 0.937],
    trials: [
      { id: 154, proposal: 'narrow max_depth', metric: 0.926, score: 0.881, aupd: 0.152, status: 'Done' },
      { id: 159, proposal: 'wider min_samples_leaf', metric: 0.933, score: 0.894, aupd: 0.161, status: 'Done' },
      { id: 162, proposal: 'final local search', metric: 0.937, score: 0.902, aupd: 0.164, status: 'Best' }
    ],
    logs: [
      '[BOSTON][00:00:01] Agent switched context from SIREN to Boston RF.',
      '[BOSTON][00:02:00] Trial 154 completed: r2=0.926.',
      '[BOSTON][01:37:10] Trial 162 completed: r2=0.937.',
      '[BOSTON][01:54:20] Experiment completed with max trial budget.'
    ],
    conversation: [
      { role: 'user', content: 'Switch to Boston RF and summarize final results.' },
      {
        role: 'agent',
        content:
          'Context switched to Boston RF. Final best metric is 0.937 with score 0.902. The search converged after local depth and leaf refinements.'
      }
    ]
  },
  {
    id: 'nnunet',
    shortName: 'nnU-Net BTCV',
    name: 'nnU-Net BTCV Segmentation',
    objective: 'Improve Mean Dice',
    status: 'Failed',
    progress: { done: 7, total: 19 },
    bestMetric: 0.741,
    score: 0.602,
    aupd: 0.107,
    runtime: '00:19:08',
    curve: [0.61, 0.642, 0.684, 0.705, 0.728, 0.741, 0.741],
    trials: [
      { id: 5, proposal: 'augment crop ratio', metric: 0.728, score: 0.587, aupd: 0.094, status: 'Done' },
      { id: 6, proposal: 'lower warmup', metric: 0.741, score: 0.602, aupd: 0.107, status: 'Done' },
      { id: 7, proposal: 'mixed precision retry', metric: 0.0, score: 0.0, aupd: 0.0, status: 'Failed' }
    ],
    logs: [
      '[BTCV][00:00:01] Experiment initialized from prior template.',
      '[BTCV][00:12:48] Trial 6 completed: metric=0.741.',
      '[BTCV][00:19:08] Trial 7 failed: CUDA out of memory while training epoch 2.',
      '[BTCV][00:19:08] Agent suggests reducing patch size and retrying.'
    ],
    conversation: [
      { role: 'user', content: 'Why did BTCV fail?' },
      {
        role: 'agent',
        content:
          'Trial 7 exceeded GPU memory after the last augmentation update. Recommended next step: reduce patch size and cap batch size for a safe retry.'
      }
    ]
  }
];

const DEFAULT_PROMPT =
  'Tell SelfAI what to do: start a new experiment, switch to Boston RF, continue exploration, stop if saturated, explain latest result, export current results...';

function buildAgentReply(command, activeExperiment, switchedExperiment) {
  if (switchedExperiment) {
    return `Context switched to ${switchedExperiment.shortName}. Status: ${switchedExperiment.status}. Progress ${switchedExperiment.progress.done}/${switchedExperiment.progress.total}, best metric ${switchedExperiment.bestMetric.toFixed(3)}.`;
  }

  if (/explain|why/i.test(command)) {
    return `For ${activeExperiment.shortName}, recent gain came from a tighter local search around successful trials. I kept the same promising region and reduced step size to improve stability.`;
  }

  if (/stop|saturated|halt/i.test(command)) {
    return `I can stop ${activeExperiment.shortName} if improvements saturate. Current best is ${activeExperiment.bestMetric.toFixed(3)}; I recommend one short confirmation run before stopping.`;
  }

  if (/compare/i.test(command)) {
    return 'Comparison snapshot: Boston RF has the strongest final metric (0.937), while SIREN has the highest recent improvement velocity. BTCV currently needs a recovery retry.';
  }

  if (/export/i.test(command)) {
    return `Prepared export plan for ${activeExperiment.shortName}: status summary, curve points, trial table, and runtime trace.`;
  }

  return `Action queued for ${activeExperiment.shortName}. I will update internal YAML, adjust strategy, and reflect changes in status, curve, and logs.`;
}

function findExperimentByCommand(command) {
  const normalized = command.toLowerCase();
  if (normalized.includes('siren')) return 'siren';
  if (normalized.includes('boston')) return 'boston';
  if (normalized.includes('btcv') || normalized.includes('nnu-net') || normalized.includes('nnunet')) return 'nnunet';
  return null;
}

function MetricChart({ values }) {
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

export default function DemoWorkbench() {
  const [selectedId, setSelectedId] = useState('siren');
  const [command, setCommand] = useState('');
  const [conversations, setConversations] = useState(() =>
    Object.fromEntries(EXPERIMENTS.map((experiment) => [experiment.id, experiment.conversation]))
  );
  const inputRef = useRef(null);

  const selectedExperiment = useMemo(
    () => EXPERIMENTS.find((experiment) => experiment.id === selectedId) || EXPERIMENTS[0],
    [selectedId]
  );

  const runningCount = useMemo(
    () => EXPERIMENTS.filter((experiment) => experiment.status === 'Running').length,
    []
  );

  const messages = conversations[selectedId] || [];

  function handleCommandSubmit(event) {
    event.preventDefault();
    const trimmed = command.trim();
    if (!trimmed) return;

    const intentExpId = findExperimentByCommand(trimmed);
    const isSwitchCommand = /switch to|switch|focus on|go to/i.test(trimmed) && intentExpId;
    const switched = isSwitchCommand ? EXPERIMENTS.find((exp) => exp.id === intentExpId) : null;
    const nextSelectedId = switched ? switched.id : selectedId;
    const targetExperiment = switched || selectedExperiment;

    setConversations((previous) => {
      const nextMessages = [
        ...(previous[nextSelectedId] || []),
        { role: 'user', content: trimmed },
        { role: 'agent', content: buildAgentReply(trimmed, targetExperiment, switched) }
      ];
      return { ...previous, [nextSelectedId]: nextMessages };
    });

    if (switched) {
      setSelectedId(switched.id);
    }

    setCommand('');
  }

  function focusInput() {
    setSelectedId('siren');
    inputRef.current?.focus();
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
            <span>Agent: Ready</span>
            <span>Python: Connected</span>
            <span>Active: {selectedExperiment.shortName}</span>
            <span>Running Exps: {runningCount}</span>
          </div>
        </header>

        <section>
          <div className={styles.switcher}>
          {EXPERIMENTS.map((experiment) => (
            <button
              key={experiment.id}
              type="button"
              onClick={() => setSelectedId(experiment.id)}
              className={`${styles.experimentCard} ${selectedId === experiment.id ? styles.experimentCardActive : ''}`}
            >
              <strong>{experiment.shortName}</strong>
              <span>
                {experiment.status} · {experiment.progress.done}/{experiment.progress.total}
              </span>
              <em>Best: {experiment.bestMetric.toFixed(3)}</em>
            </button>
          ))}
          <button type="button" onClick={focusInput} className={`${styles.experimentCard} ${styles.newCard}`}>
            <strong>+ New via AI</strong>
            <span>Ask Agent</span>
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
              <textarea
                ref={inputRef}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder={DEFAULT_PROMPT}
                rows={3}
              />
              <button type="submit">Send</button>
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
                    <dd>{selectedExperiment.name}</dd>
                  </div>
                  <div>
                    <dt>Objective</dt>
                    <dd>{selectedExperiment.objective}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{selectedExperiment.status}</dd>
                  </div>
                  <div>
                    <dt>Progress</dt>
                    <dd>
                      {selectedExperiment.progress.done} / {selectedExperiment.progress.total} trials
                    </dd>
                  </div>
                  <div>
                    <dt>Best Metric</dt>
                    <dd>{selectedExperiment.bestMetric.toFixed(3)}</dd>
                  </div>
                  <div>
                    <dt>Score</dt>
                    <dd>{selectedExperiment.score.toFixed(3)}</dd>
                  </div>
                  <div>
                    <dt>AUP_D</dt>
                    <dd>{selectedExperiment.aupd.toFixed(3)}</dd>
                  </div>
                  <div>
                    <dt>Runtime</dt>
                    <dd>{selectedExperiment.runtime}</dd>
                  </div>
                </dl>
              </section>

              <section className={styles.card}>
                <div className={styles.cardHeaderInline}>
                  <h3>Performance Curve</h3>
                  <p className={styles.cardHint}>Metric: Best-so-far score per trial</p>
                </div>
                <MetricChart values={selectedExperiment.curve} />
              </section>

              <section className={styles.card}>
                <h3>Trial Results</h3>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Trial</th>
                        <th>Agent Proposal</th>
                        <th>Metric</th>
                        <th>Score</th>
                        <th>AUP_D</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedExperiment.trials.map((trial) => (
                        <tr key={`${selectedExperiment.id}-${trial.id}`}>
                          <td>{trial.id}</td>
                          <td>{trial.proposal}</td>
                          <td>{trial.metric === 0 ? '-' : trial.metric.toFixed(3)}</td>
                          <td>{trial.score === 0 ? '-' : trial.score.toFixed(3)}</td>
                          <td>{trial.aupd === 0 ? '-' : trial.aupd.toFixed(3)}</td>
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
            {selectedExperiment.logs.map((line) => (
              <code key={line}>{line}{'\n'}</code>
            ))}
          </pre>
        </section>
      </div>
    </main>
  );
}
