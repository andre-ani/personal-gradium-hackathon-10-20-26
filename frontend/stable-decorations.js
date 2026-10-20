import { animate } from 'motion';

const DEFAULT_STAGE_1_MS = 12_000;
const DEFAULT_STAGE_2_MS = 35_000;
const DEFAULT_ADDITION_SPACING_MS = 6_000;
const DEFAULT_TICK_MS = 1_000;
const DEFAULT_ANIMATION_MS = 700;
const DEFAULT_MAX_NODES = 6;

const TEXT_FIELDS = ['label', 'heading', 'title', 'body', 'description'];
const FINGERPRINT_FIELDS = ['label', 'heading', 'title', 'body', 'description', 'kind', 'status'];

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map || value instanceof Set) return [...value.values()];
  if (typeof value[Symbol.iterator] === 'function' && typeof value !== 'string') return [...value];
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function dataOf(item) {
  return item?.data && typeof item.data === 'object' ? item.data : {};
}

function valueOf(item, key) {
  const data = dataOf(item);
  if (item && item[key] !== undefined) return item[key];
  if (data[key] !== undefined) return data[key];
  return undefined;
}

function nodeId(node) {
  const id = node?.id ?? dataOf(node).id;
  return id == null ? '' : String(id);
}

function edgeValue(edge, key) {
  const data = dataOf(edge);
  if (edge && edge[key] !== undefined) return edge[key];
  return data[key];
}

function endpointId(value) {
  return value == null ? '' : String(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value === undefined ? null : value;
}

function textValue(node, key) {
  const value = valueOf(node, key);
  return value == null ? '' : String(value);
}

function semanticFingerprint(node, incidentEdges) {
  const semantic = {};
  for (const field of FINGERPRINT_FIELDS) semantic[field] = stableValue(valueOf(node, field));
  const parent = valueOf(node, 'parent') ?? valueOf(node, 'parent_id');
  semantic.parent = stableValue(parent);
  semantic.edges = incidentEdges.map((edge) => ({
    source: edge.source,
    target: edge.target,
    label: stableValue(edge.label),
  }));
  return JSON.stringify(semantic);
}

function hasTextLabel(node) {
  return TEXT_FIELDS.some((field) => textValue(node, field).trim());
}

function eligibleNode(node) {
  const status = textValue(node, 'status').trim().toLowerCase();
  return hasTextLabel(node) && (status === 'named' || status === 'provisional');
}

function nodePriority(node) {
  const variant = textValue(node, 'nodeVariant')
    || textValue(dataOf(node), 'nodeVariant')
    || textValue(node?.presentation, 'variant');
  const kind = textValue(node, 'kind').toLowerCase();
  if (kind === 'root' || variant === 'anchor') return 4;
  if (variant === 'note') return 3;
  if (variant === 'annotation') return 0;
  if (variant === 'section' || variant === 'action') return 2;
  return 1;
}

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function readOption(options, names, fallback) {
  for (const name of names) {
    if (options[name] !== undefined) return options[name];
  }
  return fallback;
}

function readRevision(source, id, fallback) {
  if (source instanceof Map) return source.has(id) ? source.get(id) : fallback;
  if (source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, id)) return source[id];
  return fallback;
}

/**
 * Wait for a node's meaning to settle before adding the two washi strips that
 * make the paper feel collected over time. The graph remains the owner of
 * rendering; this module only owns decoration state and serialized updates.
 */
export function createStableDecorations(graph, options = {}) {
  const stage1Ms = Number(readOption(
    options,
    ['stage1Ms', 'stageOneMs', 'stage1AfterMs', 'firstStageMs', 'stabilityStage1Ms'],
    DEFAULT_STAGE_1_MS,
  ));
  const stage2Ms = Number(readOption(
    options,
    ['stage2Ms', 'stageTwoMs', 'stage2AfterMs', 'secondStageMs', 'stabilityStage2Ms'],
    DEFAULT_STAGE_2_MS,
  ));
  const additionSpacingMs = Number(readOption(
    options,
    ['additionSpacingMs', 'globalAdditionSpacingMs', 'spacingMs'],
    DEFAULT_ADDITION_SPACING_MS,
  ));
  const tickMs = Math.max(1, Number(readOption(options, ['tickMs', 'schedulerMs'], DEFAULT_TICK_MS)));
  const animationMs = Math.max(1, Number(readOption(options, ['animationMs', 'duration'], DEFAULT_ANIMATION_MS)));
  const maxDecoratedNodes = Math.max(0, Number(readOption(
    options,
    ['maxDecoratedNodes', 'maxNodes'],
    DEFAULT_MAX_NODES,
  )));
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const timers = options.timers && typeof options.timers === 'object' ? options.timers : {};
  const timerSet = options.setTimeout || options.setTimer || timers.setTimeout || timers.setTimer || globalThis.setTimeout;
  const timerClear = options.clearTimeout || options.clearTimer || timers.clearTimeout || timers.clearTimer || globalThis.clearTimeout;
  const reducedMotion = typeof options.reducedMotion === 'function'
    ? options.reducedMotion
    : () => Boolean(options.reducedMotion);
  const animateDriver = typeof options.animateDriver === 'function' ? options.animateDriver : animate;
  const ready = typeof options.isReady === 'function'
    ? options.isReady
    : (typeof options.ready === 'function' ? options.ready : () => true);
  const runExclusive = typeof options.runExclusive === 'function' ? options.runExclusive : null;

  const onApplied = typeof options.onApplied === 'function' ? options.onApplied : () => {};
  const onError = typeof options.onError === 'function'
    ? options.onError
    : (error) => {
      if (typeof console !== 'undefined' && typeof console.error === 'function') console.error(error);
    };

  let disposed = false;
  let epoch = 0;
  let timer = null;
  let states = new Map();
  let currentNodeRevisions;
  let currentRenderedRevision;
  let lastAdditionAt = Number.NEGATIVE_INFINITY;
  let activeJob = null;

  // There is one graph draw pump for all tape frames. Each node has at most
  // one pending patch, so a slow G6 draw cannot create an unbounded backlog.
  const pendingStyles = new Map();
  let drawPromise = null;

  function report(error) {
    try {
      onError(error);
    } catch (reportError) {
      if (typeof console !== 'undefined' && typeof console.error === 'function') console.error(reportError);
    }
  }

  function getRenderedRevision() {
    if (typeof options.getRenderedRevision === 'function') {
      try {
        return options.getRenderedRevision();
      } catch (error) {
        report(error);
      }
    }
    return currentRenderedRevision;
  }

  function getNodeRevision(id, node) {
    const revision = readRevision(currentNodeRevisions, id, undefined);
    return revision !== undefined ? revision : (node?.nodeRevision ?? node?.revision);
  }

  function edgeSignatures(edges) {
    const byNode = new Map();
    const add = (id, edge) => {
      if (!id) return;
      if (!byNode.has(id)) byNode.set(id, []);
      byNode.get(id).push(edge);
    };
    for (const edge of edges) {
      const source = endpointId(edgeValue(edge, 'source'));
      const target = endpointId(edgeValue(edge, 'target'));
      const signature = {
        source,
        target,
        label: edgeValue(edge, 'label') ?? null,
      };
      add(source, signature);
      add(target, signature);
    }
    for (const list of byNode.values()) {
      list.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return byNode;
  }

  function cancelJob(job, { detachQueued = true } = {}) {
    if (!job || job.canceled) return;
    job.canceled = true;
    job.epoch = -1;
    if (job.controls && typeof job.controls.stop === 'function') {
      try {
        job.controls.stop();
      } catch (error) {
        report(error);
      }
    }
    if (typeof job.resolveAnimation === 'function') job.resolveAnimation(false);
    const pending = pendingStyles.get(job.id);
    if (pending?.job === job) pendingStyles.delete(job.id);
    if (detachQueued && job.queued && !job.started) {
      const state = states.get(job.id);
      if (state?.inFlight === job) state.inFlight = null;
      if (activeJob === job) activeJob = null;
    }
  }

  function stateIsCurrent(state, job) {
    return !disposed
      && !job.canceled
      && job.epoch === epoch
      && states.get(job.id) === state
      && state.inFlight === job
      && state.fingerprint === job.fingerprint;
  }

  function markDrawFailure(job, error) {
    if (!job.drawError) {
      job.drawError = error;
      report(error);
    }
    job.reportedError = true;
    if (job.controls && typeof job.controls.stop === 'function') {
      try {
        job.controls.stop();
      } catch (stopError) {
        report(stopError);
      }
    }
    if (typeof job.resolveAnimation === 'function') job.resolveAnimation(false);
  }

  async function flushPending() {
    // Let synchronous onUpdate bursts collapse into one G6 patch.
    await Promise.resolve();
    while (pendingStyles.size) {
      const entries = [...pendingStyles.values()];
      pendingStyles.clear();
      const live = entries.filter((entry) => stateIsCurrent(entry.state, entry.job));
      if (!live.length) continue;
      try {
        if (typeof graph?.updateNodeData !== 'function') throw new Error('Stable decorations require graph.updateNodeData().');
        graph.updateNodeData(live.map((entry) => ({ id: entry.id, style: { [entry.key]: entry.value } })));
        if (typeof graph?.draw !== 'function') throw new Error('Stable decorations require graph.draw().');
        await graph.draw();
        for (const entry of live) entry.job.lastDrawnValue = entry.value;
      } catch (error) {
        for (const entry of live) markDrawFailure(entry.job, error);
        // Do not retry a failed frame in this flush. The scheduler may retry
        // the stage later after the app is ready again.
        pendingStyles.clear();
        return false;
      }
    }
    return true;
  }

  function ensureFlush() {
    if (!drawPromise) {
      drawPromise = flushPending().finally(() => {
        drawPromise = null;
        if (pendingStyles.size && !disposed) ensureFlush();
      });
    }
    return drawPromise;
  }

  function requestProgress(state, job, value) {
    if (!stateIsCurrent(state, job)) return null;
    const clamped = clamp(value);
    state[job.key] = clamped;
    if (job.lastDrawnValue === clamped && !pendingStyles.has(job.id)) return Promise.resolve(true);
    pendingStyles.set(job.id, { id: job.id, key: job.key, value: clamped, state, job });
    return ensureFlush();
  }

  function stageAnimation(state, job) {
    if (reducedMotion()) {
      return requestProgress(state, job, 1)?.then(() => true) || Promise.resolve(false);
    }
    return new Promise((resolve) => {
      job.resolveAnimation = resolve;
      const animationOptions = {
        // Motion's duration is seconds; the lifecycle option is milliseconds.
        duration: animationMs / 1000,
        ease: 'easeOut',
        onUpdate: (value) => {
          requestProgress(state, job, value);
        },
        onComplete: () => resolve(true),
      };
      try {
        job.controls = animateDriver(0, 1, animationOptions);
        if (job.controls?.finished && typeof job.controls.finished.then === 'function') {
          job.controls.finished.then(() => resolve(true), (error) => {
            job.drawError = error;
            resolve(false);
          });
        }
      } catch (error) {
        job.drawError = error;
        resolve(false);
      }
    });
  }

  function emitApplied(state, job) {
    const event = {
      node_id: job.id,
      level: job.level,
      node_revision: job.nodeRevision,
      rendered_revision: getRenderedRevision(),
    };
    const eventKey = `${job.id}\u0000${String(event.node_revision)}\u0000${job.level}`;
    if (state.appliedEvents.has(eventKey)) return;
    state.appliedEvents.add(eventKey);
    try {
      const result = onApplied(event);
      if (result && typeof result.catch === 'function') result.catch(report);
    } catch (error) {
      // Callback failures must never strand the scheduler or duplicate a
      // completed visual stage.
      report(error);
    }
  }

  async function runStage(state, job) {
    if (!stateIsCurrent(state, job)) return false;
    job.started = true;
    job.queued = false;
    job.nodeRevision = getNodeRevision(job.id, state.node);
    lastAdditionAt = Number(now());

    const animated = await stageAnimation(state, job);
    if (!animated || job.drawError || !stateIsCurrent(state, job)) return false;

    // Some animation drivers invoke onComplete without a final onUpdate.
    // Request 1 explicitly so completion can only follow a final draw.
    const finalDraw = requestProgress(state, job, 1);
    if (finalDraw) {
      const succeeded = await finalDraw;
      if (!succeeded || job.drawError || !stateIsCurrent(state, job)) return false;
    }
    if (!stateIsCurrent(state, job)) return false;

    state[job.key] = 1;
    if (job.level === 1) state.applied1 = true;
    else state.applied2 = true;
    emitApplied(state, job);
    return true;
  }

  function handleStageFailure(state, job) {
    if (states.get(job.id) !== state || state.inFlight !== job) return;
    state[job.key] = 0;
    if (job.drawError && !job.reportedError) {
      job.reportedError = true;
      report(job.drawError);
    }
  }

  function finishJob(state, job) {
    if (state.inFlight === job) state.inFlight = null;
    if (activeJob === job) activeJob = null;
    schedule();
  }

  function startStage(state, level) {
    const job = {
      id: state.id,
      level,
      key: level === 1 ? 'tape1Progress' : 'tape2Progress',
      state,
      fingerprint: state.fingerprint,
      epoch,
      queued: Boolean(runExclusive),
      started: false,
      canceled: false,
      drawError: null,
      controls: null,
      nodeRevision: undefined,
    };
    state.inFlight = job;
    activeJob = job;

    const work = async () => {
      // A render or semantic update may have superseded this item while it
      // waited in the shared queue. The callback is intentionally cheap.
      if (!stateIsCurrent(state, job)) return false;
      if (!ready({ owner: 'stableDecorations', exclusive: true })) return false;
      if (!eligibleNode(state.node)) return false;
      const elapsed = Number(now()) - state.lastChange;
      const threshold = level === 1 ? stage1Ms : stage2Ms;
      if (elapsed < threshold) return false;
      if (Number(now()) - lastAdditionAt < additionSpacingMs) return false;
      if (level === 1 && !state.applied1
        && decoratedCount() - (job.level === 1 ? 1 : 0) >= maxDecoratedNodes) return false;
      return runStage(state, job);
    };

    let queued;
    try {
      queued = runExclusive ? runExclusive(work) : work();
    } catch (error) {
      job.drawError = error;
      handleStageFailure(state, job);
      finishJob(state, job);
      return Promise.resolve(false);
    }
    const completion = Promise.resolve(queued).then((result) => {
      if (!result && !job.canceled) handleStageFailure(state, job);
      return result;
    }).catch((error) => {
      if (!job.canceled) {
        job.drawError = error;
        handleStageFailure(state, job);
      }
      return false;
    }).finally(() => finishJob(state, job));
    job.promise = completion;
    return completion;
  }

  function decoratedCount() {
    let count = 0;
    for (const state of states.values()) {
      if (state.applied1 || (state.inFlight?.level === 1)) count += 1;
    }
    return count;
  }

  function candidates(at) {
    const activeCount = decoratedCount();
    const result = [];
    for (const state of states.values()) {
      if (!state.eligible || state.inFlight) continue;
      const elapsed = at - state.lastChange;
      if (state.applied1 && !state.applied2 && elapsed >= stage2Ms
        && at - lastAdditionAt >= additionSpacingMs) {
        result.push({ state, level: 2 });
      } else if (!state.applied1 && activeCount < maxDecoratedNodes && elapsed >= stage1Ms
        && at - lastAdditionAt >= additionSpacingMs) {
        result.push({ state, level: 1 });
      }
    }
    result.sort((left, right) => {
      const priority = nodePriority(right.state.node) - nodePriority(left.state.node);
      if (priority) return priority;
      if (right.level !== left.level) return right.level - left.level;
      if (left.state.lastChange !== right.state.lastChange) return left.state.lastChange - right.state.lastChange;
      return left.state.id.localeCompare(right.state.id);
    });
    return result;
  }

  function hasWork() {
    if (activeJob) return true;
    const activeCount = decoratedCount();
    for (const state of states.values()) {
      if (!state.eligible) continue;
      if (state.applied1 && !state.applied2) return true;
      if (!state.applied1 && activeCount < maxDecoratedNodes) return true;
    }
    return false;
  }

  function schedule() {
    if (disposed || timer || !hasWork()) return;
    timer = timerSet(() => {
      timer = null;
      tick();
    }, tickMs);
    // Node's test runner should not stay alive just because a canvas has a
    // long stability window. Browsers simply ignore this optional method.
    timer?.unref?.();
  }

  function tick() {
    if (disposed) return Promise.resolve(false);
    if (!activeJob) {
      let canStart = false;
      try {
        canStart = Boolean(ready());
      } catch (error) {
        report(error);
      }
      if (canStart) {
        const candidate = candidates(Number(now()))[0];
        if (candidate) {
          const completion = startStage(candidate.state, candidate.level);
          schedule();
          return completion;
        }
      }
    }
    schedule();
    return activeJob?.promise || Promise.resolve(false);
  }

  function sync(nodesInput, edgesInput, metadata = {}) {
    if (disposed) return;
    metadata ||= {};
    const nodes = asArray(nodesInput);
    const edges = asArray(edgesInput);
    const nextNodes = new Map();
    for (const node of nodes) {
      const id = nodeId(node);
      if (id) nextNodes.set(id, node);
    }
    const edgeMap = edgeSignatures(edges);
    if (Object.prototype.hasOwnProperty.call(metadata, 'nodeRevisions')) currentNodeRevisions = metadata.nodeRevisions;
    if (Object.prototype.hasOwnProperty.call(metadata, 'renderedRevision')) currentRenderedRevision = metadata.renderedRevision;

    for (const [id, state] of states) {
      if (!nextNodes.has(id)) {
        cancelJob(state.inFlight);
        states.delete(id);
      }
    }

    const timestamp = Number(now());
    const nextStates = new Map();
    for (const [id, node] of nextNodes) {
      const fingerprint = semanticFingerprint(node, edgeMap.get(id) || []);
      const previous = states.get(id);
      if (!previous || previous.fingerprint !== fingerprint) {
        cancelJob(previous?.inFlight);
        nextStates.set(id, {
          id,
          node,
          fingerprint,
          lastChange: timestamp,
          eligible: eligibleNode(node),
          tape1Progress: 0,
          tape2Progress: 0,
          applied1: false,
          applied2: false,
          inFlight: null,
          appliedEvents: new Set(),
        });
      } else {
        previous.node = node;
        previous.eligible = eligibleNode(node);
        nextStates.set(id, previous);
      }
    }
    states = nextStates;
    schedule();
  }

  function styleFor(id) {
    const state = states.get(String(id));
    return {
      tape1Progress: state ? clamp(state.tape1Progress) : 0,
      tape2Progress: state ? clamp(state.tape2Progress) : 0,
    };
  }

  function reset() {
    if (disposed) return;
    epoch += 1;
    if (timer != null) {
      timerClear(timer);
      timer = null;
    }
    for (const state of states.values()) cancelJob(state.inFlight);
    states = new Map();
    pendingStyles.clear();
    lastAdditionAt = Number.NEGATIVE_INFINITY;
    if (!drawPromise) schedule();
  }

  function dispose() {
    if (disposed) return;
    reset();
    disposed = true;
    epoch += 1;
    if (timer != null) {
      timerClear(timer);
      timer = null;
    }
    pendingStyles.clear();
  }

  return { sync, styleFor, reset, dispose, tick };
}

export default createStableDecorations;
