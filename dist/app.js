import { presets } from './presets.js';
import { instrumentCpp } from './instrument.js';
import { looksLikeCpp, normalizeSource, readsProgramInput } from './source.js';
import { planTrace } from './ai.js';
import { drawStage, format, graphLike, same } from './stage.js';
import { normalizeTrace, shortValue } from './frames.js';
import { featured, loadSolution } from './solution-import.js';
import { createCinema } from './cinema.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const source = $('#source');
const stdin = $('#stdin');
const inputPanel = stdin.closest('details');
const timeline = $('#timeline');
const speed = $('#speed');
const languageSelect = $('#language');
const variableSelect = $('#variable');
const definitions = Object.entries(presets);
const icons = { Array: 'grid', Graph: 'graph', Memory: 'memory', Stack: 'layers' };
const viewButtons = $$('[data-view]');
const inspectorButtons = $$('[data-inspector]');
const playbackIds = ['first', 'prev', 'play', 'next', 'last'];
const root = document.documentElement;
const cinema = createCinema(document);
let importJob;
let tickTrace;

const state = {
  language: 'cpp', preset: '', view: 'Cinema', variable: '', imported: null,
  inspector: 'variables', trace: { frames: [], error: '', output: '' },
  index: 0, code: '', title: 'Call tree',
  playing: false, timer: null, job: null, readsInput: false
};

function svg(name) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  element.setAttribute('aria-hidden', 'true');
  element.append(use);
  return element;
}

function setIcon(button, name) {
  const use = button.querySelector('use');
  use.setAttribute('href', '#i-' + name);
}

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function status(message = '', error = false) {
  const paragraph = $('#status');
  paragraph.classList.toggle('error', error);
  paragraph.textContent = message;
  paragraph.hidden = !message;
  const inline = $('#run-status');
  inline.textContent = message;
  inline.classList.toggle('error', error);
  inline.title = message;
}

const keywords = new Set(('def return for in if elif else while break continue from import as class pass try except finally raise ' +
  'lambda None True False not and or is with yield global nonlocal del assert async await void int auto long bool ' +
  'float double char const constexpr unsigned signed short struct public private namespace using include nullptr new delete true false std template').split(' '));
const builtins = new Set('range len print deque input enumerate list set dict tuple sorted min max append add popleft vector map string cout cin endl swap'.split(' '));
const tokens = /(?:\/\/|#).*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_]\w*\b/g;

let previousCode;
let previousLanguage;
let markedLine;

function highlightSource(scroll = false) {
  const mark = source.value === state.code ? state.trace.frames[state.index]?.line : 0;
  const numbers = $('#line-numbers');
  const highlight = $('#highlight');
  if (previousCode !== source.value || previousLanguage !== state.language) {
    const lines = source.value.split('\n');
    const gutter = element('div', undefined, 'gutter-scroll');
    const code = document.createDocumentFragment();
    lines.forEach((line, index) => {
      gutter.append(element('span', index + 1));
      const lineNode = element('span', undefined, 'code-line');
      let cursor = 0;
      for (const match of line.matchAll(tokens)) {
        const [token] = match;
        lineNode.append(line.slice(cursor, match.index));
        const comment = state.language === 'cpp' ? token.startsWith('//') : token.startsWith('#');
        const category = comment ? 'comment' : token.startsWith('#') ? 'kw' : /^[\u0022\u0027]/.test(token) ? 'string' :
          /^\d/.test(token) ? 'num' : keywords.has(token) ? 'kw' : builtins.has(token) || line[match.index + token.length] === '(' ? 'fn' : '';
        lineNode.append(category ? element('span', token, 't-' + category) : token);
        cursor = match.index + token.length;
      }
      lineNode.append(line.slice(cursor));
      code.append(lineNode);
    });
    numbers.replaceChildren(gutter);
    highlight.replaceChildren(code);
    previousCode = source.value;
    previousLanguage = state.language;
    markedLine = undefined;
  }
  if (mark !== markedLine) {
    numbers.querySelector('.active')?.classList.remove('active');
    highlight.querySelector('.active')?.classList.remove('active');
    if (mark) {
      numbers.firstElementChild?.children[mark - 1]?.classList.add('active');
      highlight.children[mark - 1]?.classList.add('active');
    }
    markedLine = mark;
  }
  if (scroll && mark) {
    const top = (mark - 1) * 25 + 13;
    const bottom = top + 25;
    if (top < source.scrollTop || bottom > source.scrollTop + source.clientHeight) {
      source.scrollTop = Math.max(0, top - source.clientHeight / 2 + 13);
    }
  }
  syncScroll();
}

function syncScroll() {
  $('#line-numbers').scrollTop = source.scrollTop;
  $('#highlight').scrollTop = source.scrollTop;
  $('#highlight').scrollLeft = source.scrollLeft;
  const spotlight = $('#active-line');
  const watch = $('#line-watch');
  const frame = state.trace.frames[state.index];
  const top = (markedLine - 1) * 25 + 13 - source.scrollTop;
  const visible = Boolean(markedLine && top >= 0 && top < source.clientHeight);
  spotlight.hidden = !visible;
  watch.hidden = !visible;
  spotlight.style.transform = 'translateY(' + top + 'px)';
  watch.style.transform = 'translateY(' + (top + 3) + 'px)';
  const scalars = Object.entries(frame?.variables || {}).filter(([, value]) => ['number', 'string', 'boolean'].includes(typeof value));
  watch.textContent = scalars.slice(0, 2).map(([name, value]) => name + '=' + shortValue(value, 12)).join('  ');
  watch.hidden ||= !watch.textContent;
}

function inferType(value) {
  if (value === null) return 'null';
  if (value?.$ref) return 'pointer';
  if (value?.$address) return value.$type || 'object';
  if (Array.isArray(value)) return value.length && value.every(Array.isArray) ? 'matrix' : 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'object') return 'map';
  return 'string';
}

function callName(frame) {
  return frame?.callStack[0]?.name || '';
}

function caption(frame) {
  return frame?.caption || '';
}

function renderInspector() {
  const frame = state.trace.frames[state.index];
  const previous = state.trace.frames[state.index - 1];
  const previousVars = frame && previous?.activeNodeId === frame.activeNodeId ? previous.variables : {};
  const variables = Object.entries(frame?.variables || {});
  const body = $('#inspector-body');
  $('#variable-count').textContent = variables.length;
  const scope = callName(frame);
  $('#scope').textContent = scope ? scope === '<module>' ? 'module' : scope + '()' : '';
  $('#scope').title = frame?.callStack.map(call => call.name).join(' ← ') || '';
  const callStack = frame?.callStack || [];
  $('#call-depth').textContent = callStack.length;
  const callList = $('#call-list');
  callList.replaceChildren(...callStack.map(({name}, depth) => {
    const entry = element('li', undefined, depth === 0 ? 'active' : '');
    entry.append(element('span', name === '<module>' ? 'Program' : name + '()'));
    if (!depth) {
      const args = variables.filter(([, val]) => ['number', 'string', 'boolean'].includes(typeof val)).slice(0, 3);
      if (args.length) entry.append(element('small', args.map(([key, val]) => key + '=' + shortValue(val, 14)).join('  ')));
    }
    return entry;
  }));
  if (!callStack.length) callList.append(element('li', 'No active calls', 'call-empty'));
  inspectorButtons.forEach(button => {
    const selected = state.inspector === button.dataset.inspector;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if (state.inspector === 'output') {
    const output = state.trace.output;
    const content = [element('pre', output || 'No output at this step.', 'console')];
    if (state.trace.notice) content.push(element('p', state.trace.notice, 'inspector-empty'));
    if (state.trace.error) content.push(element('pre', state.trace.error, 'console error'));
    body.replaceChildren(...content);
    return;
  }
  if (state.inspector === 'steps') {
    if (!frame) {
      body.replaceChildren(element('p', 'Run a trace to see execution steps.', 'inspector-empty'));
      return;
    }
    if (body.firstElementChild?.dataset.frameCount !== String(state.trace.frames.length) || body.firstElementChild?.sourceTrace !== state.trace) {
      const list = element('ol', undefined, 'step-list');
      list.dataset.frameCount = state.trace.frames.length;
      list.sourceTrace = state.trace;
      state.trace.frames.forEach((step, index) => {
        const button = element('button', undefined);
        button.type = 'button';
        button.dataset.step = index;
        button.append(element('span', String(index + 1).padStart(2, '0') + ' · L' + step.line), caption(step));
        const item = element('li');
        item.append(button);
        list.append(item);
      });
      body.replaceChildren(list);
    }
    const old = body.querySelector('.active');
    old?.classList.remove('active');
    old?.removeAttribute('aria-current');
    const selected = body.querySelector('[data-step="' + state.index + '"]');
    selected?.classList.add('active');
    selected?.setAttribute('aria-current', 'step');
    if (selected) {
      const outer = body.getBoundingClientRect();
      const inner = selected.getBoundingClientRect();
      if (inner.top < outer.top || inner.bottom > outer.bottom) {
        body.scrollTop += inner.top - outer.top - (outer.height - inner.height) / 2;
      }
    }
    return;
  }
  if (!variables.length) {
    body.replaceChildren(element('p', frame ? 'No local variables at this step.' : 'Run a trace to inspect variables.', 'inspector-empty'));
    return;
  }
  const table = element('table', undefined, 'variable-table');
  const headers = table.createTHead().insertRow();
  for (const value of ['Name', 'Type', 'Value']) {
    const th = element('th', value);
    th.scope = 'col';
    headers.append(th);
  }
  const tbody = table.createTBody();
  for (const [name, value] of variables) {
    const row = tbody.insertRow();
    row.insertCell().textContent = name;
    row.insertCell().textContent = inferType(value);
    const cell = row.insertCell();
    cell.classList.toggle('changed', Object.hasOwn(previousVars, name) && !same(value, previousVars[name]));
    cell.textContent = format(value);
  }
  body.replaceChildren(table);
}

function eligibleVariables(view, frame) {
  if (['Cinema', 'Memory', 'Stack'].includes(view) || !frame) return [];
  return Object.entries(frame.variables).filter(([, value]) => view === 'Graph' ? graphLike(value) : Array.isArray(value)).map(([name]) => name);
}

function rangeProgress(input) {
  const max = Number(input.max);
  const min = Number(input.min);
  const percent = max === min ? 0 : ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--progress', percent + '%');
}

function paint() {
  const frame = state.trace.frames[state.index];
  const previous = state.trace.frames[state.index - 1];
  const isCinema = state.view === 'Cinema';
  $('#cinema-scene').hidden = !isCinema;
  $('#scene').hidden = isCinema;
  if (isCinema) {
    cinema.draw(frame, previous);
    return;
  }
  const available = eligibleVariables(state.view, frame);
  const selected = available.includes(state.variable) ? state.variable : available[0];
  drawStage({
    frame, previous, variable: selected, view: state.view,
    code: frame ? state.code.split('\n')[frame.line - 1] || '' : '',
    caption: caption(frame)
  });
}

function renderTimeline() {
  if (tickTrace === state.trace) return;
  tickTrace = state.trace;
  const total = Math.max(1, state.trace.frames.length - 1);
  const important = state.trace.frames.filter(frame => ['FOUND', 'POP', 'PRUNE'].includes(frame.event));
  $('#timeline-ticks').replaceChildren(...important.map(frame => {
    const tick = element('i', undefined, 'tick-' + frame.event.toLowerCase());
    tick.style.left = ((frame.stepId - 1) / total * 100) + '%';
    return tick;
  }));
}

function render(scroll = false) {
  const frame = state.trace.frames[state.index];
  const count = state.trace.frames.length;
  const available = eligibleVariables(state.view, frame);
  const selected = available.includes(state.variable) ? state.variable : available[0];
  if ([...variableSelect.options].map(option => option.value).join('\n') !== available.join('\n')) {
    variableSelect.replaceChildren(...available.map(name => new Option(name, name)));
  }
  if (selected) variableSelect.value = selected;
  $('#variable-field').hidden = !available.length;
  $('#scene-title').textContent = state.title;
  $('#trace-notice').hidden = !state.trace.notice;
  $('#trace-notice').textContent = state.trace.notice || '';
  const busy = Boolean(importJob || state.job);
  $('#tree-loading').hidden = !busy;
  $('#tree-stage').classList.toggle('loading', busy);
  $('#tree-empty').hidden = busy || Boolean(frame?.treeNodes.length);
  $('#empty-title').textContent = state.trace.error ? 'Playback needs a fix' : frame ? 'No calls at this step' : 'Your trace starts here';
  $('#empty-detail').textContent = state.trace.error ? 'See Watch → Output for details. Edit the code and run it again.' :
    frame ? 'Follow the recorded line and its variables in Source code and Watch.' : 'Pick a featured problem or run your own code.';
  $('#step-event').textContent = frame?.event || 'READY';
  $('#subtitle').dataset.event = frame?.event || '';
  $('#step-caption').textContent = frame ? 'Step ' + frame.stepId + ' · ' + caption(frame) : 'Load a problem to start playback.';
  renderTimeline();
  $('#scene-count').textContent = count ? (state.index + 1) + ' / ' + count : '0 / 0';
  timeline.max = Math.max(0, count - 1);
  timeline.value = state.index;
  timeline.disabled = count < 2;
  timeline.setAttribute('aria-valuetext', count ? 'Step ' + (state.index + 1) + ' of ' + count : 'No trace');
  rangeProgress(timeline);
  for (const id of playbackIds) {
    const boundary = id === 'prev' || id === 'first' ? state.index === 0 : id === 'next' || id === 'last' ? state.index >= count - 1 : false;
    $('#' + id).disabled = !count || boundary;
  }
  const play = $('#play');
  setIcon(play, state.playing ? 'pause' : 'play');
  play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  viewButtons.forEach(button => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const legends = state.view === 'Graph'
    ? [['current', 'Current'], ['source', 'Visited'], ['idle', 'Unvisited']]
    : state.view === 'Memory'
      ? [['current', 'Updated'], ['source', 'Reference'], ['idle', 'Unchanged']]
      : state.view === 'Stack'
        ? [['current', 'Active call'], ['idle', 'Caller']]
        : [['current', 'Updated'], ['source', 'Read'], ['idle', 'Unchanged']];
  $('#legend').replaceChildren(...legends.map(([kind, label]) => {
    const entry = element('span');
    entry.append(element('i', undefined, 'swatch ' + kind), label);
    return entry;
  }));
  highlightSource(scroll);
  renderInspector();
  paint();
}

function pause() {
  state.playing = false;
  clearTimeout(state.timer);
}

function jump(index, keepPlaying = false) {
  if (!keepPlaying) pause();
  const step = Number(index);
  state.index = Math.max(0, Math.min(state.trace.frames.length - 1, Number.isFinite(step) ? Math.trunc(step) : 0));
  render(true);
}

function schedule() {
  clearTimeout(state.timer);
  if (!state.playing) return;
  state.timer = setTimeout(() => {
    const next = state.index + 1;
    if (next >= state.trace.frames.length - 1) {
      jump(next);
      return;
    }
    jump(next, true);
    schedule();
  }, 680 / Number(speed.value));
}

function togglePlay() {
  if (!state.trace.frames.length) return;
  if (state.playing) {
    pause();
    render();
    return;
  }
  if (state.index === state.trace.frames.length - 1) state.index = 0;
  state.playing = true;
  render(true);
  schedule();
}

const sandboxCode = `
<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; worker-src blob:; connect-src https://cdn.jsdelivr.net https://raw.githubusercontent.com">
<script>
addEventListener('message', function start(event) {
  if (event.source !== parent || event.data.type !== 'run') return;
  removeEventListener('message', start);
  try {
    const blob = new Blob([event.data.worker], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.onmessage = ({data}) => parent.postMessage(data, '*');
    worker.onerror = (problem) => parent.postMessage({type:'failure', message: problem.message || 'The execution worker could not start.'}, '*');
    worker.postMessage(event.data.request);
    URL.revokeObjectURL(url);
  } catch (problem) {
    parent.postMessage({type:'failure', message: problem.message}, '*');
  }
});
<\/script>`;

const assetCache = new Map();
async function asset(path) {
  if (assetCache.has(path)) return assetCache.get(path);
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error('Unable to load the browser runtime (' + response.status + ').');
  const value = await response.text();
  assetCache.set(path, value);
  return value;
}

async function execute(request, signal) {
  const [worker, support] = await Promise.all([asset('./engine-worker.js'),
    asset(request.language === 'python' ? './trace.py' : './vendor/clang-api.js')]);
  if (signal.aborted) throw signal.reason;
  if (request.language === 'python') request.tracer = support;
  return new Promise((resolve, reject) => {
    const iframe = element('iframe');
    iframe.hidden = true;
    iframe.title = 'Isolated algorithm runtime';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.srcdoc = sandboxCode;
    let partial;
    const timeoutMessage = 'Execution timed out. Try a smaller input or check for a loop that never exits.';
    const timeout = setTimeout(() => {
      if (partial) finish(resolve, { ...partial, error: timeoutMessage });
      else finish(reject, new Error(timeoutMessage));
    }, 50000);
    const abort = () => finish(reject, signal.reason);
    function finish(callback, result) {
      clearTimeout(timeout);
      removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      iframe.remove();
      callback(result);
    }
    function receive(event) {
      if (event.source !== iframe.contentWindow || !event.data) return;
      const { type, trace, message } = event.data;
      if (type === 'status') status(message);
      if (type === 'partial') partial = trace;
      if (type === 'result') finish(resolve, trace);
      if (type === 'failure') finish(reject, new Error(message));
    }
    addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    iframe.addEventListener('load', () => iframe.contentWindow.postMessage({
      type: 'run', worker: request.language === 'python' ? worker : support + '\n' + worker, request
    }, '*'), { once: true });
    document.body.append(iframe);
  });
}

function changeRunButton(active) {
  const button = $('#run');
  setIcon(button, active ? 'stop' : 'play');
  button.querySelector('span').textContent = active ? 'Stop' : 'Run trace';
  $('#ai-open').disabled = active || Boolean(importJob);
}

function clearJob() {
  const job = state.job;
  if (!job) return;
  state.job = null;
  job.abort();
  changeRunButton(false);
  render();
}

function updateExamples() {
  for (const button of $$('#example-grid button')) {
    const active = button.dataset.example === state.preset;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function suggestedView(trace) {
  if (trace.frames.some(frame => frame.callStack.slice(1).some(call => call.name === callName(frame)))) {
    return { kind: 'Cinema', variable: '' };
  }
  const variables = trace.frames.flatMap(frame => Object.entries(frame.variables));
  const graph = variables.find(([name, value]) => /graph|adj/.test(name) && graphLike(value));
  if (graph) return { kind: 'Graph', variable: graph[0] };
  if (variables.some(([, value]) => value?.$ref || value?.$address)) return { kind: 'Memory', variable: '' };
  const array = variables.find(([name, value]) => /^(dp|values|array|arr|matrix|table|nums)$/.test(name) && Array.isArray(value)) ||
    variables.find(([, value]) => Array.isArray(value) && value.length);
  return array ? { kind: 'Array', variable: array[0] } : { kind: 'Memory', variable: '' };
}

function initialFrame(trace, view) {
  const found = trace.frames.findIndex(frame => {
    if (view === 'Memory') return Object.keys(frame.variables).length > 0;
    if (view === 'Stack') return frame.callStack.length > 1;
    if (view === 'Cinema') return true;
    return eligibleVariables(view, frame).length > 0;
  });
  return Math.max(0, found);
}

function updateInputPanel(code = source.value) {
  const readsInput = readsProgramInput(code, state.language);
  if (readsInput && !state.readsInput) inputPanel.open = true;
  $('#stdin-hint').hidden = !readsInput;
  state.readsInput = readsInput;
}

async function run(options) {
  cancelImport();
  clearJob();
  if (state.language === 'python' && looksLikeCpp(source.value)) setLanguage('cpp');
  const code = normalizeSource(source.value, state.language);
  if (code !== source.value) source.value = code;
  updateInputPanel(code);
  const input = stdin.value;
  const missingInput = state.readsInput && !input.trim();
  if (missingInput) inputPanel.open = true;
  if (!code.trim()) return status('Paste some code or choose an example.', true);
  if (code.length > 60000 || input.length > 20000) return status('Keep source under 60,000 characters and input under 20,000 characters.', true);
  pause();
  render();
  const job = new AbortController();
  state.job = job;
  changeRunButton(true);
  render();
  const language = state.language;
  const preset = state.preset ? presets[state.preset] : null;
  try {
    let plan;
    if (options) {
      status('Preparing AI instrumentation…');
      const timeout = setTimeout(() => job.abort(new Error('AI instrumentation timed out. Try again or run a local trace.')), 45000);
      try {
        plan = await planTrace({ source: code, language, key: options.key, model: options.model, signal: job.signal });
      } finally {
        clearTimeout(timeout);
      }
    }
    const prepared = language === 'cpp'
      ? instrumentCpp(plan?.code || code, { probes: plan ? false : undefined })
      : plan?.code || code;
    status('Starting browser runtime…');
    const rawTrace = await execute({ language, source: prepared, stdin: input, labels: plan?.labels }, job.signal);
    if (state.job !== job) return;
    state.job = null;
    changeRunButton(false);
    const trace = normalizeTrace(rawTrace, code);
    const suggested = suggestedView(trace);
    cinema.clear();
    state.trace = trace;
    state.code = code;
    state.title = plan?.title || state.imported?.title || preset?.title || (language === 'python' ? 'Python trace' : 'C++ trace');
    state.view = state.imported ? 'Cinema' : plan?.kind || preset?.kind || suggested.kind;
    state.variable = plan?.variable || preset?.variable || suggested.variable;
    state.index = initialFrame(trace, state.view);
    state.inspector = trace.error && !trace.frames.length ? 'output' : 'variables';
    if (trace.error) showWatch(true);
    render(true);
    if (trace.error) {
      status(/undefined symbol: main|undefined reference to .*main/.test(trace.error)
        ? 'Add a main() that calls your C++ function with sample input.'
        : trace.error.split('\n')[0], true);
    } else if (trace.notice) status();
    else if (missingInput && !trace.output) status('This C++ program reads input. Paste its sample input, including any test-case count, into Program input and rerun.');
    else if (!trace.frames.length) status('The program completed without frames. For C++, place CINE probes in the code to track state.');
    else status(trace.frames.length + ' frames recorded' + (options ? ' with AI instrumentation.' : '.'));
  } catch (error) {
    if (state.job !== job) return;
    state.job = null;
    changeRunButton(false);
    status(error.message || 'Could not record this trace.', true);
    render();
  }
}

function setLanguage(language) {
  state.language = language;
  languageSelect.value = language;
  $('#solution-language').value = language;
  root.dataset.language = language;
  $('#filename').textContent = language === 'python' ? 'algorithm.py' : 'algorithm.cpp';
}

function selectExample(id, shouldRun = true) {
  const preset = presets[id];
  cancelImport();
  setReference(null);
  cinema.clear();
  state.preset = id;
  source.value = preset[state.language];
  stdin.value = preset.input?.[state.language] || '';
  updateInputPanel();
  inputPanel.open = Boolean(stdin.value || state.readsInput);
  state.trace = { frames: [], output: '', error: '' };
  state.index = 0;
  state.inspector = 'variables';
  state.view = preset.kind;
  state.variable = preset.variable;
  state.title = preset.title;
  state.code = source.value;
  source.scrollTop = 0;
  source.scrollLeft = 0;
  pause();
  updateExamples();
  render();
  if (shouldRun) run();
}

function setReference(reference) {
  state.imported = reference;
  const badge = $('#reference-source');
  badge.hidden = !reference;
  if (reference) {
    badge.href = reference.sourceUrl;
    badge.title = 'Doocs LeetCode reference · CC BY-SA 4.0';
  } else badge.removeAttribute('href');
}

function cancelImport() {
  if (!importJob) return;
  importJob.abort();
  importJob = undefined;
  $('#solution-form').setAttribute('aria-busy', 'false');
  $('#load-solution').textContent = 'Load & Animate';
  changeRunButton(Boolean(state.job));
}

function showWatch(visible) {
  $('#watch-panel').hidden = !visible;
  $('#workspace').classList.toggle('watch-hidden', !visible);
  $('#watch-toggle').setAttribute('aria-pressed', String(visible));
}

async function importReference(query) {
  cancelImport();
  clearJob();
  pause();
  const job = new AbortController();
  const language = $('#solution-language').value;
  importJob = job;
  $('#solution-form').setAttribute('aria-busy', 'true');
  $('#load-solution').textContent = 'Loading…';
  $('#ai-open').disabled = true;
  state.view = 'Cinema';
  status('Loading reference source from GitHub…');
  render();
  try {
    const reference = await loadSolution(query, language, job.signal);
    if (importJob !== job) return;
    cancelImport();
    setLanguage(language);
    setReference(reference);
    source.value = reference.code;
    source.scrollTop = 0;
    source.scrollLeft = 0;
    stdin.value = '';
    updateInputPanel();
    inputPanel.open = false;
    state.preset = '';
    state.trace = {frames: [], output: '', error: ''};
    state.index = 0;
    state.inspector = 'variables';
    state.title = reference.title;
    state.code = source.value;
    cinema.clear();
    updateExamples();
    render();
    if (reference.note) status(reference.note, true);
    else {
      await run();
      if (state.imported === reference && !state.job && !importJob && !state.playing &&
          state.trace.frames.length > 1 && !state.trace.error &&
          !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) togglePlay();
    }
  } catch (error) {
    if (importJob !== job) return;
    cancelImport();
    status(error.message || 'GitHub could not load this reference. Try again.', true);
    render();
  }
}

$('#solution-form').addEventListener('submit', event => {
  event.preventDefault();
  const query = $('#problem-query').value.trim();
  if (query) importReference(query);
});
for (const problem of featured) {
  const button = element('button', undefined, 'featured-card');
  button.type = 'button';
  button.dataset.problem = problem.id;
  const icon = element('span', undefined, 'feature-icon');
  icon.append(svg(problem.icon));
  const text = element('span', undefined, 'feature-name');
  text.append(element('strong', problem.title), element('small', problem.category));
  button.append(icon, text, element('span', '#' + problem.id, 'problem-id'));
  button.addEventListener('click', () => {
    $('#problem-query').value = problem.id;
    importReference(String(problem.id));
  });
  $('#featured-grid').append(button);
}
$('#watch-toggle').addEventListener('click', () => showWatch($('#watch-panel').hidden));

for (const [id, preset] of definitions) {
  const button = element('button', undefined, 'example');
  button.type = 'button';
  button.dataset.example = id;
  button.append(svg(icons[preset.kind]), preset.title);
  button.addEventListener('click', () => selectExample(id));
  $('#example-grid').append(button);
}

viewButtons.forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  state.variable = '';
  render();
}));
inspectorButtons.forEach(button => button.addEventListener('click', () => {
  state.inspector = button.dataset.inspector;
  renderInspector();
}));
$('#inspector-body').addEventListener('click', event => {
  const step = event.target.closest('[data-step]');
  if (step) jump(step.dataset.step);
});
variableSelect.addEventListener('change', () => {
  state.variable = variableSelect.value;
  paint();
});
languageSelect.addEventListener('change', () => {
  const preset = state.preset;
  cancelImport();
  clearJob();
  setReference(null);
  cinema.clear();
  setLanguage(languageSelect.value);
  if (preset) selectExample(preset);
  else {
    pause();
    state.trace = { frames: [], output: '', error: '' };
    state.index = 0;
    state.title = state.language === 'python' ? 'Python trace' : 'C++ trace';
    updateInputPanel();
    status();
    render();
  }
});
source.addEventListener('scroll', syncScroll);
source.addEventListener('input', event => {
  if (event.inputType === 'insertFromPaste' && state.language === 'python' && looksLikeCpp(source.value)) {
    setLanguage('cpp');
  }
  if (event.inputType === 'insertFromPaste') {
    const normalized = normalizeSource(source.value, state.language);
    if (normalized !== source.value) source.value = normalized;
  }
  cancelImport();
  if (state.job) clearJob();
  if (event.inputType === 'insertFromPaste' && state.imported && !source.value.includes(state.imported.source.trim())) setReference(null);
  pause();
  updateInputPanel();
  state.preset = definitions.find(([, preset]) => preset[state.language] === source.value)?.[0] || '';
  updateExamples();
  render();
  status(source.value === state.code ? '' : 'Source changed. Run a new trace to sync the stage.');
});
stdin.addEventListener('input', () => {
  if (!state.job) return;
  clearJob();
  status('Program input changed. Run a new trace to use it.');
});
source.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || !event.altKey) return;
  event.preventDefault();
  source.setRangeText(state.language === 'python' ? '    ' : '  ', source.selectionStart, source.selectionEnd, 'end');
  source.dispatchEvent(new Event('input'));
});
$('#run').addEventListener('click', () => {
  if (!state.job) return run();
  clearJob();
  status('Trace stopped.');
});
$('#copy').addEventListener('click', async () => {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(source.value);
    else {
      source.focus();
      source.select();
      if (!document.execCommand('copy')) throw new Error('Copy is unavailable.');
    }
    status('Source copied.');
  } catch {
    status('Select the source and use your browser’s copy command.', true);
  }
});
$('#restore').addEventListener('click', () => {
  if (!state.imported) selectExample(state.preset || 'fibonacci');
  else {
    source.value = state.imported.code;
    run();
  }
});
$('#first').addEventListener('click', () => jump(0));
$('#prev').addEventListener('click', () => jump(state.index - 1));
$('#play').addEventListener('click', togglePlay);
$('#next').addEventListener('click', () => jump(state.index + 1));
$('#last').addEventListener('click', () => jump(state.trace.frames.length - 1));
timeline.addEventListener('input', () => jump(timeline.value));
speed.addEventListener('change', schedule);

$('#expand').addEventListener('click', async () => {
  const panel = $('#studio');
  if (document.fullscreenElement) return document.exitFullscreen();
  if (panel.classList.contains('expanded')) {
    panel.classList.remove('expanded');
    $('#expand').setAttribute('aria-label', 'Expand execution stage');
    return;
  }
  try {
    if (!panel.requestFullscreen) throw new Error('Fullscreen is unavailable.');
    await panel.requestFullscreen();
  } catch {
    panel.classList.add('expanded');
    $('#expand').setAttribute('aria-label', 'Exit expanded execution stage');
  }
});
document.addEventListener('fullscreenchange', () => {
  $('#expand').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Expand execution stage');
  paint();
});
$('#guide-open').addEventListener('click', () => $('#guide').showModal());
$('#ai-open').addEventListener('click', () => {
  if (!source.value.trim()) return status('Paste some code or choose an example.', true);
  $('#ai-dialog').showModal();
});
$$('[data-close]').forEach(button => button.addEventListener('click', () => $('#' + button.dataset.close).close()));
$('#ai-dialog').addEventListener('close', () => {
  $('#api-key').value = '';
});
$('#ai-form').addEventListener('submit', event => {
  event.preventDefault();
  const key = $('#api-key').value.trim();
  const model = $('#model').value.trim();
  if (!key || !model) return;
  $('#ai-dialog').close();
  run({ key, model });
});

const themes = ['dark', 'violet', 'light'];
function applyTheme(theme) {
  root.dataset.theme = themes.includes(theme) ? theme : themes[0];
  $('#theme').title = 'Theme: ' + root.dataset.theme + ' · Click to switch';
  $('#theme').setAttribute('aria-label', 'Switch color theme, current theme ' + root.dataset.theme);
  paint();
}
$('#theme').addEventListener('click', () => {
  const next = themes[(themes.indexOf(root.dataset.theme) + 1) % themes.length];
  applyTheme(next);
  try { localStorage.setItem('cinema-theme', next); } catch { /* Theme stays active for this session. */ }
});
const isApple = /Mac|iPhone|iPad/.test(navigator.platform);
$('#run-key').textContent = isApple ? '⌘' : 'Ctrl';
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#studio').classList.contains('expanded')) {
    $('#studio').classList.remove('expanded');
    $('#expand').setAttribute('aria-label', 'Expand execution stage');
  }
  if ($('dialog[open]')) return;
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    if (!state.job) run();
    return;
  }
  if (event.target.closest?.('textarea,input,select,button,a,summary')) return;
  if (event.key === ' ' && state.trace.frames.length) {
    event.preventDefault();
    togglePlay();
  } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && state.trace.frames.length) {
    event.preventDefault();
    jump(state.index + (event.key === 'ArrowLeft' ? -1 : 1));
  }
});

try { applyTheme(localStorage.getItem('cinema-theme')); } catch { applyTheme('dark'); }
const resize = new ResizeObserver(paint);
resize.observe($('#scene'));
resize.observe($('#tree-stage'));
document.fonts?.ready.then(paint);
setLanguage('cpp');
status();
render();
