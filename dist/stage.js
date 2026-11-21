const canvas = document.querySelector('#canvas');
const context = canvas.getContext('2d');
let theme;
let width;
let height;
const mono = '"IBM Plex Mono", monospace';

export const same = (first, second) => Object.is(first, second) ||
  (typeof first === 'object' && typeof second === 'object' && JSON.stringify(first) === JSON.stringify(second));

export function graphLike(value) {
  return value !== null && typeof value === 'object' &&
    Object.keys(value).length > 0 && Object.values(value).every(row => Array.isArray(row) &&
      row.every(node => typeof node === 'number' || typeof node === 'string'));
}

export function format(value) {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (value?.$ref) return '↦ ' + value.$ref;
  if (value?.$address) return (value.$type || 'Node') + ' ' + value.$address;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function colors() {
  const style = getComputedStyle(document.documentElement);
  const keys = ['accent', 'purple', 'fg', 'sub', 'muted', 'panel', 'panel-soft', 'tile', 'tile-line',
    'source-tile', 'source-line', 'current-tile', 'current-line', 'canvas', 'ink'];
  return Object.fromEntries(keys.map(key => [key, style.getPropertyValue('--' + key).trim()]));
}

function text(value, x, y, { color = theme.fg, size = 13, align = 'center', weight = 500, max = Infinity } = {}) {
  context.font = weight + ' ' + size + 'px ' + mono;
  context.textAlign = align;
  context.textBaseline = 'middle';
  context.fillStyle = color;
  const full = String(value);
  let content = full;
  while (content.length && context.measureText(content + (content === full ? '' : '…')).width > max) {
    content = content.slice(0, -1);
  }
  context.fillText(content === full ? content : content + '…', x, y);
}

function box(x, y, w, h, kind, radius = 8) {
  context.beginPath();
  context.roundRect(x, y, w, h, radius);
  context.fillStyle = theme[kind === 'current' ? 'current-tile' : kind === 'source' ? 'source-tile' : 'tile'];
  context.strokeStyle = theme[kind === 'current' ? 'current-line' : kind === 'source' ? 'source-line' : 'tile-line'];
  context.lineWidth = kind === 'current' ? 1.5 : 1;
  if (kind === 'current') {
    context.shadowColor = theme['current-line'] + '32';
    context.shadowBlur = 15;
  }
  context.fill();
  context.shadowBlur = 0;
  context.stroke();
}

function arrowhead(x, y, angle, color, size = 5) {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x - size * Math.cos(angle - .54), y - size * Math.sin(angle - .54));
  context.lineTo(x - size * Math.cos(angle + .54), y - size * Math.sin(angle + .54));
  context.closePath();
  context.fill();
}

function route(from, to, y, lift, active) {
  const color = active ? theme['current-line'] : theme['source-line'];
  context.beginPath();
  context.moveTo(from, y - 3);
  context.bezierCurveTo(from, y - lift, to, y - lift, to, y - 5);
  context.strokeStyle = color;
  context.lineWidth = 1.15;
  context.setLineDash(active ? [] : [4, 3]);
  context.stroke();
  context.setLineDash([]);
  arrowhead(to, y - 4, Math.PI / 2, color, 6);
}

function oneDimension(value, previous, name, codeLine, caption) {
  const runtimeChange = Array.isArray(previous) ? value.map((item, index) => !same(item, previous[index])) : [];
  const changed = runtimeChange.reduce((indices, item, index) => item ? [...indices, index] : indices, []);
  const maxColumns = Math.max(3, Math.min(12, Math.floor((width - 30) / 37)));
  const columns = Math.max(1, Math.min(maxColumns, value.length));
  const limit = Math.min(value.length, columns * (value.length > columns ? 2 : 1));
  const offset = Math.max(0, Math.min(changed[0] || 0, value.length - limit));
  const sliced = value.slice(offset, offset + limit);
  const rows = Math.max(1, Math.ceil(sliced.length / columns));
  const gap = width < 430 ? 5 : 9;
  const tileWidth = Math.min(rows === 1 ? 65 : 55, (width - 34 - gap * (columns - 1)) / columns);
  const tileHeight = rows === 1 ? 55 : 37;
  const rowHeight = tileHeight + 24;
  const y = Math.max(81, height / 2 - (rows === 1 ? 10 : 30));
  const left = (width - ((tileWidth + gap) * columns - gap)) / 2;
  const next = changed.length === 1 ? changed[0] : -1;
  const fibonacci = name === 'dp' && /dp\[\s*i\s*-\s*1\s*\]\s*\+\s*dp\[\s*i\s*-\s*2\s*\]/.test(codeLine) && next >= 2;
  const dependencies = fibonacci ? [next - 1, next - 2] : [];
  const center = index => left + (index - offset) * (tileWidth + gap) + tileWidth / 2;
  text(name + '[' + value.length + ']', left, y - 36, { align: 'left', color: theme.sub, size: 12 });
  if (fibonacci && rows === 1 && dependencies.at(-1) >= offset && next < offset + limit) {
    for (const index of dependencies) route(center(index), center(next), y, index === next - 1 ? 26 : 42, index === next - 1);
  }
  sliced.forEach((cell, position) => {
    const index = position + offset;
    const column = position % columns;
    const row = Math.floor(position / columns);
    const x = left + column * (tileWidth + gap);
    const top = y + row * rowHeight;
    const kind = runtimeChange[index] ? 'current' : dependencies.includes(index) ? 'source' : 'idle';
    box(x, top, tileWidth, tileHeight, kind, width < 430 ? 5 : 7);
    text(format(cell), x + tileWidth / 2, top + tileHeight / 2,
      { size: width < 430 ? 16 : 23, max: tileWidth - 9, color: kind === 'current' ? theme.accent : kind === 'source' ? theme.purple : theme.fg, weight: 600 });
    text(index, x + tileWidth / 2, top + tileHeight + 13, { size: 11, color: kind === 'current' ? theme.accent : theme.muted });
  });
  if (!value.length) text('Empty array', width / 2, height / 2 + 15, { color: theme.sub });
  if (value.length > limit && rows > 1) {
    text('Showing indices ' + offset + '–' + (offset + sliced.length - 1), width / 2, 61, { color: theme.muted, size: 11 });
  }
  if (rows === 1) {
    const message = fibonacci ? 'dp[' + next + '] = dp[' + dependencies[0] + '] + dp[' + dependencies[1] + ']' : caption;
    if (message) text(message, width / 2, y + tileHeight + 39, { color: fibonacci ? theme.accent : theme.sub, size: 12, max: width - 32 });
  }
  return 'Array ' + name + ' contains ' + value.map(format).join(', ') + '. ' +
    (changed.length ? 'Updated indices ' + changed.join(', ') + '.' : '');
}

function matrix(value, previous, name) {
  const columns = Math.min(13, Math.max(1, ...value.map(row => row.length)), Math.max(3, Math.floor((width - 50) / 24)));
  const changedRow = Array.isArray(previous) ? value.findIndex((row, index) => !same(row, previous[index])) : -1;
  const rowCount = Math.max(1, Math.min(value.length, Math.floor((height - 104) / 26), 8));
  const offset = Math.max(0, Math.min(changedRow, value.length - rowCount));
  const size = Math.min(43, (width - 49) / columns, (height - 97) / rowCount);
  const x = (width - columns * (size + 3)) / 2;
  const y = (height - rowCount * (size + 3)) / 2 + 4;
  text(name + '[' + value.length + '][' + Math.max(0, ...value.map(row => row.length)) + ']', x, y - 22, { color: theme.sub, size: 12, align: 'left' });
  for (let row = 0; row < rowCount; row++) {
    text(row + offset, x - 15, y + row * (size + 3) + size / 2, { color: theme.muted, size: 10 });
    for (let column = 0; column < columns; column++) {
      const cell = value[row + offset]?.[column];
      if (cell === undefined) continue;
      const left = x + column * (size + 3);
      const top = y + row * (size + 3);
      const changed = previous?.[row + offset] && !same(cell, previous[row + offset][column]);
      box(left, top, size, size, changed ? 'current' : 'idle', 5);
      text(format(cell), left + size / 2, top + size / 2, { color: changed ? theme.accent : theme.fg, size: 13, max: size - 7 });
    }
  }
  return 'Matrix ' + name + ' has ' + value.length + ' rows. ' + value.map(row => row.map(format).join(', ')).join('. ');
}

function drawGraph(graph, vars) {
  const neighbors = name => Object.hasOwn(graph, name) ? graph[name] : [];
  const nodeNames = [...new Set([...Object.keys(graph), ...Object.values(graph).flat().map(String)])].slice(0, 24);
  const incoming = new Set(Object.values(graph).flat().map(String));
  const start = nodeNames.find(name => !incoming.has(name)) || nodeNames[0];
  const levels = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const head = queue.shift();
    for (const child of neighbors(head)) {
      const name = String(child);
      if (!nodeNames.includes(name) || levels.has(name)) continue;
      levels.set(name, Math.min(4, levels.get(head) + 1));
      queue.push(name);
    }
  }
  nodeNames.filter(name => !levels.has(name)).forEach((name, index) => levels.set(name, index % 4));
  const groups = Array.from({ length: Math.max(...levels.values()) + 1 }, (_, level) => nodeNames.filter(name => levels.get(name) === level));
  const points = new Map();
  const span = Math.min(width - 40, groups.length === 1 ? 340 : width - 70);
  const radius = Math.min(23, Math.max(10, span / Math.max(...groups.map(row => row.length), 1) / 2.7), (height - 105) / groups.length / 2.6);
  const firstY = 66 + radius;
  const lastY = height - 44 - radius;
  groups.forEach((group, level) => group.forEach((name, index) => {
    const x = width / 2 + span * ((index + 1) / (group.length + 1) - .5);
    const y = groups.length === 1 ? (firstY + lastY) / 2 : firstY + (lastY - firstY) * level / (groups.length - 1);
    points.set(name, { x, y });
  }));
  const activeValue = vars.node ?? vars.current ?? vars.u ?? vars.vertex;
  const active = activeValue === undefined || activeValue === null ? null : String(activeValue);
  const visited = Array.isArray(vars.visited) && !vars.visited.every(value => typeof value === 'boolean')
    ? vars.visited.map(String)
    : Object.keys(vars.visited || {}).filter(key => vars.visited[key]);
  for (const name of nodeNames) {
    const from = points.get(name);
    for (const child of neighbors(name).map(String)) {
      if (!points.has(child)) continue;
      const to = points.get(child);
      if (name === child) {
        context.strokeStyle = theme['tile-line'];
        context.beginPath();
        context.arc(from.x + radius * .7, from.y - radius * .65, radius * .55, 0, Math.PI * 2);
        context.stroke();
        continue;
      }
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const endX = to.x - Math.cos(angle) * radius;
      const endY = to.y - Math.sin(angle) * radius;
      const color = name === active ? theme['source-line'] : theme['tile-line'];
      context.strokeStyle = color;
      context.lineWidth = 1.35;
      context.beginPath();
      context.moveTo(from.x + Math.cos(angle) * radius, from.y + Math.sin(angle) * radius);
      context.lineTo(endX, endY);
      context.stroke();
      arrowhead(endX, endY, angle, color);
    }
  }
  for (const [name, { x, y }] of points) {
    const kind = name === active ? 'current' : visited.includes(name) ? 'source' : 'idle';
    box(x - radius, y - radius, radius * 2, radius * 2, kind, radius);
    text(name, x, y, { color: kind === 'current' ? theme.accent : kind === 'source' ? theme.purple : theme.fg, size: Math.min(16, radius), max: radius * 1.5 });
  }
  return 'Graph with nodes ' + nodeNames.join(', ') + '.' + (active === null ? '' : ' Current node ' + active + '.');
}

function memory(vars, oldVars) {
  const entries = Object.entries(vars);
  const nodes = new Map();
  function collect(value) {
    if (!value || typeof value !== 'object' || !value.$address || nodes.has(value.$address)) return;
    nodes.set(value.$address, value);
    collect(value.next);
  }
  entries.forEach(([, value]) => collect(value));
  if (nodes.size && [...nodes.values()].some(value => Object.hasOwn(value, 'next'))) {
    const visible = [...nodes.values()].slice(0, Math.min(7, Math.max(3, Math.floor((width - 25) / 66))));
    const boxWidth = Math.min(84, (width - 32) / visible.length * .74);
    const y = height / 2 + 6;
    const locations = new Map(visible.map((node, index) => [node.$address, width * ((index + 1) / (visible.length + 1))]));
    visible.forEach(node => {
      const x = locations.get(node.$address);
      const link = node.next?.$ref || node.next?.$address;
      const target = locations.get(link);
      if (target !== undefined && target !== x) {
        const direction = Math.sign(target - x);
        const from = x + direction * boxWidth / 2;
        const to = target - direction * boxWidth / 2;
        context.beginPath();
        context.moveTo(from, y + 16);
        context.bezierCurveTo(from, y + 48, to, y + 48, to, y + 16);
        context.strokeStyle = theme['source-line'];
        context.lineWidth = 1.5;
        context.stroke();
        arrowhead(to, y + 17, -Math.PI / 2, theme.purple);
      }
    });
    visible.forEach(node => {
      const x = locations.get(node.$address);
      const names = entries.filter(([, item]) => item?.$ref === node.$address || item?.$address === node.$address).map(([name]) => name);
      const changed = names.some(name => Object.hasOwn(oldVars, name) && !same(vars[name], oldVars[name]));
      box(x - boxWidth / 2, y - 23, boxWidth, 46, changed ? 'current' : 'idle', 7);
      text(format(node.val ?? node.value ?? node.$type ?? 'Node'), x, y, { color: changed ? theme.accent : theme.fg, size: 18, max: boxWidth - 8 });
      text(names.join(', ') || node.$address, x, y - 38, { color: theme.purple, max: width / visible.length - 10, size: 11 });
      text(node.$address, x, y + 55, { color: theme.muted, max: width / visible.length - 10, size: 10 });
    });
    const nil = entries.filter(([, item]) => item === null).map(([name]) => name);
    if (nil.length) text(nil.join(', ') + ' → null', width / 2, 58, { color: theme.sub, max: width - 30, size: 11 });
  } else {
    const columns = width < 460 ? 2 : 3;
    const count = Math.min(columns * 3, entries.length);
    const rowCount = Math.ceil(count / columns);
    const cellWidth = Math.min(185, (width - 34) / columns - 10);
    const cellHeight = rowCount > 2 ? 40 : 50;
    const left = (width - columns * (cellWidth + 10) + 10) / 2;
    const top = (height - rowCount * (cellHeight + 8)) / 2;
    entries.slice(0, count).forEach(([name, value], index) => {
      const x = left + (index % columns) * (cellWidth + 10);
      const y = top + Math.floor(index / columns) * (cellHeight + 8);
      const changed = Object.hasOwn(oldVars, name) && !same(value, oldVars[name]);
      box(x, y, cellWidth, cellHeight, changed ? 'current' : 'idle');
      text(name, x + 10, y + 12, { align: 'left', color: theme.purple, size: 11, max: cellWidth - 20 });
      text(format(value), x + 10, y + cellHeight - 13, { align: 'left', color: theme.fg, size: 13, max: cellWidth - 20 });
    });
  }
  return entries.map(([name, value]) => name + ' = ' + format(value)).join('. ');
}

function drawStack(frame) {
  const calls = frame.callStack.map(call => call.name);
  const boxWidth = Math.min(width - 36, 470);
  const left = (width - boxWidth) / 2;
  const rowHeight = 31;
  const gap = 7;
  const visible = calls.slice(0, Math.max(1, Math.floor((height - 101) / (rowHeight + gap))));
  const top = Math.max(47, (height - visible.length * (rowHeight + gap)) / 2);
  const locals = Object.entries(frame.variables).filter(([, value]) =>
    ['string', 'number', 'boolean'].includes(typeof value) && value !== '<object>'
  ).slice(0, 4).map(([name, value]) => name + '=' + JSON.stringify(value)).join('  ');
  const functionName = name => name === '<module>' ? 'module' : name + '()';

  visible.forEach((call, index) => {
    const y = top + index * (rowHeight + gap);
    const active = index === 0;
    const hasLocals = active && Boolean(locals);
    const functionWidth = hasLocals ? Math.min(152, boxWidth * .51) : boxWidth - 25;
    const color = active ? theme.accent : theme.sub;
    box(left, y, boxWidth, rowHeight, active ? 'current' : 'idle', 6);
    text(functionName(call), left + 12, y + rowHeight / 2,
      { align: 'left', size: 13, max: functionWidth, color });
    if (hasLocals) text(locals, left + boxWidth - 13, y + rowHeight / 2,
      { align: 'right', size: 11, max: boxWidth - functionWidth - 30, color: theme.sub });
  });
  if (calls.length > visible.length) {
    text(calls.length - visible.length + ' more callers', width / 2, top + visible.length * (rowHeight + gap) + 3,
      { size: 11, color: theme.muted });
  }
  return 'Active call ' + functionName(calls[0]) + '. ' +
    (calls.length > 1 ? 'Callers: ' + calls.slice(1).map(functionName).join(', ') + '. ' : '') +
    (locals ? 'Local values: ' + locals + '.' : '');
}

export function drawStage({ frame, previous, variable, view, code, caption }) {
  const rectangle = canvas.getBoundingClientRect();
  width = rectangle.width;
  height = rectangle.height;
  const scale = Math.min(devicePixelRatio || 1, 2);
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  theme = colors();
  const vars = frame?.variables || {};
  const oldVars = frame && previous?.activeNodeId === frame.activeNodeId ? previous.variables : {};
  const selected = vars[variable];
  const hint = frame ? 'There are no ' + (view === 'Array' ? 'arrays' : view === 'Graph' ? 'adjacency lists' : view === 'Stack' ? 'calls' : 'variables') + ' at this step.' : 'Run a trace to see how your program executes.';
  let description = '';
  if (view === 'Array' && Array.isArray(selected)) {
    description = selected.length && selected.every(Array.isArray)
      ? matrix(selected, oldVars[variable], variable)
      : oneDimension(selected, oldVars[variable], variable, code, caption);
  } else if (view === 'Graph' && graphLike(selected)) {
    description = drawGraph(selected, vars);
  } else if (view === 'Memory' && Object.keys(vars).length) {
    description = memory(vars, oldVars);
  } else if (view === 'Stack' && frame?.callStack?.length) {
    description = drawStack(frame);
  }
  const empty = document.querySelector('#scene-empty');
  empty.hidden = !!description;
  empty.textContent = description ? '' : hint;
  document.querySelector('#scene-description').textContent = description || hint;
}
