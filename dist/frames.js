/** @typedef {'ENTER'|'STEP'|'PUSH'|'POP'|'FOUND'|'PRUNE'|'EXIT'} AnimationEvent */
/** @typedef {null|boolean|number|string|TraceValue[]|{[name: string]: TraceValue}} TraceValue */
/** @typedef {{id: string, name: string}} StackEntry */
/** @typedef {{id: string, name: string, parentId: string|null, label: string, born: number, found: number, pruned: number, ended: number, x: number, y: number}} TreeNode */
/** @typedef {{from: string, to: string}} TreeEdge */
/**
 * @typedef {object} AnimationFrame
 * @property {number} stepId
 * @property {number} line
 * @property {AnimationEvent} event
 * @property {StackEntry[]} callStack Most recent call first.
 * @property {string|null} activeNodeId
 * @property {TreeNode[]} treeNodes Bounded view of the recorded execution tree.
 * @property {TreeEdge[]} treeEdges
 * @property {Record<string, TraceValue>} variables
 * @property {Record<string, TraceValue>} containers
 * @property {string} caption
 * @property {number} outputEnd
 */
export const FRAME_LIMIT = 1500;
const events = new Set(['ENTER', 'STEP', 'PUSH', 'POP', 'FOUND', 'PRUNE', 'EXIT']);
const resultNames = /^(?:ans|answers?|res|results?|solutions?|output)$/i;
const pathNames = /^(?:t|curr(?:ent)?(?:_path)?|paths?|track|stack|board|dp|combination|subset|permutation)$/i;

function clean(value, budget, depth = 0) {
  if (--budget.count < 0 || depth > 5) return '…';
  if (value == null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? value : String(value);
  }
  if (typeof value === 'string') return value.slice(0, 450);
  if (Array.isArray(value)) return value.slice(0, depth ? 56 : 192).map(item => clean(item, budget, depth + 1));
  if (typeof value !== 'object') return null;
  const entries = Object.entries(value).slice(0, 64).filter(([name]) => !['__proto__', 'constructor', 'prototype'].includes(name));
  return Object.fromEntries(entries.map(([name, item]) => [name.slice(0, 100), clean(item, budget, depth + 1)]));
}

function variableMap(value) {
  const result = value && typeof value === 'object' && !Array.isArray(value) ? clean(value, {count: 900}) : {};
  return result;
}

const collection = value => value !== null && typeof value === 'object';
const sized = value => Array.isArray(value) || typeof value === 'string';
const displayName = name => name === '<module>' ? 'Program' : name;

export function shortValue(value, max = 60) {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? '—';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function readStack(raw) {
  const names = Array.isArray(raw.callStack) ? raw.callStack : Array.isArray(raw.stack) ? raw.stack : [];
  const ids = Array.isArray(raw.callIds) ? raw.callIds : [];
  const limit = names.length ? names.slice(0, 20) : typeof raw.scope === 'string' ? [raw.scope] : [];
  return limit.map((item, depth) => {
    const name = (typeof item === 'string' ? item : typeof item?.name === 'string' ? item.name : 'Program').slice(0, 80);
    const id = item?.id ?? ids[depth] ?? (depth === 0 ? raw.callId : null);
    return { name, id: (typeof id === 'string' && id.length) || (Number.isSafeInteger(id) && id > 0)
      ? 'call-' + String(id).slice(0, 64)
      : 'scope-' + (limit.length - depth) + '-' + name };
  });
}

function summarize(event, scope, code, change, variables) {
  if (event === 'ENTER') return scope === '<module>' ? 'Start the program.' : 'Enter ' + scope + ' and read its arguments.';
  if (event === 'EXIT') return scope === '<module>' ? 'The program finished.' : 'Return from ' + scope + ' to its caller.';
  if (event === 'PRUNE') return 'Skip this branch. Its stopping condition was met.';
  if (event === 'FOUND') return change ? 'Found ' + shortValue(change.value.at(-1), 110) + '. Save it in ' + change.name + '.' : 'Record a valid result.';
  if (event === 'PUSH' && change) return 'Add ' + shortValue(change.value.at(-1), 36) + ' to ' + change.name + '. Current value ' + shortValue(change.value, 110) + '.';
  if (event === 'POP' && change) return 'Backtrack by removing ' + shortValue(change.before.at(-1), 36) + ' from ' + change.name + '.';
  const assignment = code.match(/^([\w.]+)(?:\[[^\]]+\])*\s*=(?!=)/);
  if (assignment && Object.hasOwn(variables, assignment[1])) {
    return 'Update ' + assignment[1] + ' to ' + shortValue(variables[assignment[1]], 86) + '.';
  }
  if (/^(?:if|elif|else if|while)\b/.test(code)) return 'Check the condition in ' + scope + '.';
  if (/^for\b/.test(code)) return 'Continue the loop in ' + scope + '.';
  if (!code || code === '}' || code === '{') return 'Continue in ' + displayName(scope) + '.';
  return 'Execute ' + code.replace(/;$/, '').slice(0, 130) + '.';
}

function classify(raw, code, variables, previous) {
  const original = typeof raw.event === 'string' ? raw.event.toUpperCase() : '';
  if (original === 'CALL' || original === 'ENTER') return {event: 'ENTER'};
  if (original === 'RETURN' || original === 'EXIT') return {event: 'EXIT'};
  if (original !== 'STEP' && events.has(original)) return {event: original};
  const receiver = code.match(/([A-Za-z_]\w*)\.(?:push|push_back|emplace_back|append|add|pop|pop_back|remove|discard|clear|insert)\s*\(/)?.[1];
  const changes = Object.entries(variables).filter(([name, value]) =>
    sized(value) && sized(previous[name]) && value.length !== previous[name].length
  ).map(([name, value]) => ({name, value, before: previous[name]}));
  const result = changes.find(item => item.name === receiver && resultNames.test(item.name) && item.value.length > item.before.length);
  if (result) return {event: 'FOUND', change: result};
  const movement = changes.find(item => item.name === receiver) || (!receiver && changes.find(item =>
    pathNames.test(item.name) && /\b(?:push_back|append|pop_back|pop)\s*\(/.test(code)));
  if (movement) return {event: movement.value.length > movement.before.length ? 'PUSH' : 'POP', change: movement};
  const queen = code.match(/^([A-Za-z_]\w*)((?:\[[^\]]+\]){2})\s*=\s*['"]([Q.])['"]/);
  if (queen && Object.hasOwn(variables, queen[1]) && JSON.stringify(variables[queen[1]]) !== JSON.stringify(previous[queen[1]])) {
    return queen[3] === 'Q'
      ? {event: 'PUSH', detail: 'Place a queen at ' + queen[1] + queen[2] + '.'}
      : {event: 'POP', detail: 'Remove the queen at ' + queen[1] + queen[2] + ' and backtrack.'};
  }
  return {event: 'STEP'};
}

function positionTree(nodes) {
  const byParent = new Map();
  for (const node of nodes.values()) {
    const siblings = byParent.get(node.parentId) || [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }
  let column = 0;
  function place(node, depth) {
    const children = byParent.get(node.id) || [];
    for (const child of children) place(child, depth + 1);
    node.x = children.length ? (children[0].x + children.at(-1).x) / 2 : column++ * 140;
    node.y = depth * 82;
  }
  for (const node of byParent.get(null) || []) place(node, 0);
}

/** @returns {{frames: AnimationFrame[], error: string, output: string, notice: string}} */
export function normalizeTrace(raw, source = '') {
  const trace = raw && typeof raw === 'object' ? raw : {};
  const input = Array.isArray(trace.frames) ? trace.frames : [];
  const output = typeof trace.output === 'string' ? trace.output.slice(0, 12000) : '';
  const lines = typeof source === 'string' ? source.split('\n') : [];
  /** @type {AnimationFrame[]} */
  const frames = [];
  /** @type {Map<string, TreeNode>} */
  const nodes = new Map();
  const snapshots = new Map();
  for (const item of input.slice(0, FRAME_LIMIT)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const stepId = frames.length + 1;
    const line = Number.isInteger(item.line) && item.line > 0 && item.line <= lines.length ? item.line : 0;
    const code = line ? lines[line - 1].trim() : '';
    const callStack = readStack(item);
    const activeNodeId = callStack[0]?.id ?? null;
    const scope = callStack[0]?.name || 'Program';
    const prior = snapshots.get(activeNodeId) || {};
    const values = variableMap(item.variables ?? item.vars);
    const variables = item.partialVars === true ? {...prior, ...values} : values;
    const {event, change, detail} = classify(item, code, variables, prior);
    const caption = typeof item.caption === 'string' && item.caption.trim() ? item.caption.slice(0, 250) :
      typeof item.label === 'string' && item.label.trim() ? item.label.slice(0, 250) :
      detail || summarize(event, scope, code, change, variables);
    for (let depth = callStack.length - 1; depth >= 0; depth--) {
      const {id, name} = callStack[depth];
      if (nodes.has(id)) continue;
      const parameters = depth === 0 ? Object.entries(variables)
        .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) && value !== '<object>')
        .slice(0, 2).map(([key, value]) => key + '=' + shortValue(value, 14)) : [];
      nodes.set(id, {
        id, name, label: parameters.join(' · '), parentId: callStack[depth + 1]?.id || null,
        x: 0, y: 0, born: stepId, found: Infinity, pruned: Infinity, ended: Infinity
      });
    }
    const active = nodes.get(activeNodeId);
    if (active && event === 'FOUND') active.found = Math.min(active.found, stepId);
    if (active && event === 'PRUNE') active.pruned = Math.min(active.pruned, stepId);
    if (active && event === 'EXIT') active.ended = stepId;
    if (event === 'EXIT') snapshots.delete(activeNodeId);
    else snapshots.set(activeNodeId, variables);
    const containers = Object.fromEntries(Object.entries(variables).filter(([name, value]) =>
      collection(value) || (typeof value === 'string' && pathNames.test(name))
    ));
    const outputEnd = Number.isInteger(item.outputEnd) ? Math.min(output.length, Math.max(0, item.outputEnd)) :
      typeof item.output === 'string' ? Math.min(output.length, item.output.length) : 0;
    frames.push({stepId, line, event, callStack, activeNodeId, treeNodes: [], treeEdges: [], variables, containers, caption, outputEnd});
  }
  positionTree(nodes);
  const allNodes = [...nodes.values()];
  let boundary = 0;
  for (const frame of frames) {
    while (allNodes[boundary]?.born <= frame.stepId) boundary++;
    const visible = new Map(allNodes.slice(Math.max(0, boundary - 110), boundary).map(node => [node.id, node]));
    for (const {id} of frame.callStack) if (nodes.has(id)) visible.set(id, nodes.get(id));
    frame.treeNodes = [...visible.values()];
    frame.treeEdges = frame.treeNodes.filter(node => node.parentId && visible.has(node.parentId))
      .map(node => ({from: node.parentId, to: node.id}));
  }
  return {
    frames, output, error: typeof trace.error === 'string' ? trace.error.slice(0, 12000) : '',
    notice: typeof trace.notice === 'string' && trace.notice ? trace.notice.slice(0, 300) :
      input.length > FRAME_LIMIT ? 'Trace capped at 1,500 steps for smooth playback.' : ''
  };
}
