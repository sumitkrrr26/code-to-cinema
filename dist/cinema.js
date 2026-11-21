import { shortValue } from './frames.js';

const svgNS = 'http://www.w3.org/2000/svg';
const createSvg = (tag, attributes = {}) => {
  const node = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};
const containerPriority = /^(?:t|curr(?:ent)?|path|track|board|dp|ans|answers?|res|results?|solutions?)$/i;

function textNode(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function chips(value, oldValue, event, changed) {
  const group = document.createElement('div');
  const matrix = Array.isArray(value) && value.length && value.every(Array.isArray);
  if (matrix) {
    group.className = 'matrix-preview';
    for (const [rowIndex, row] of value.slice(0, 7).entries()) {
      const rowElement = document.createElement('div');
      rowElement.className = 'memory-chips';
      for (const [colIndex, cell] of row.slice(0, 10).entries()) {
        const cellChanged = Array.isArray(oldValue) && JSON.stringify(oldValue[rowIndex]?.[colIndex]) !== JSON.stringify(cell);
        rowElement.append(textNode('span', shortValue(cell, 13), 'memory-chip' + (cellChanged ? ' changed-cell' : '')));
      }
      if (row.length > 10) rowElement.append(textNode('span', '…', 'memory-chip'));
      group.append(rowElement);
    }
    if (value.length > 7) group.append(textNode('div', '+' + (value.length - 7) + ' rows', 'memory-extra'));
    return group;
  }
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [...value] : null;
  if (!list) return textNode('pre', shortValue(value, 250), 'memory-json');
  group.className = 'memory-chips';
  if (!list.length) group.append(textNode('span', 'Empty', 'memory-extra'));
  for (const [index, item] of list.slice(-12).entries()) {
    const pushed = changed && event === 'PUSH' && index === Math.min(list.length, 12) - 1;
    group.append(textNode('span', typeof item === 'string' ? item.slice(0, 24) : shortValue(item, 24),
      'memory-chip' + (pushed ? ' pushed-chip' : '')));
  }
  if (list.length > 12) group.prepend(textNode('span', '+' + (list.length - 12), 'memory-extra'));
  if (changed && event === 'POP' && oldValue?.length > list.length) {
    const removed = textNode('span', shortValue(oldValue.at(-1), 15), 'memory-chip popped-chip');
    removed.setAttribute('aria-hidden', 'true');
    removed.addEventListener('animationend', () => removed.remove(), {once: true});
    group.append(removed);
  }
  return group;
}

export function createCinema(root) {
  const svg = root.querySelector('#tree-stage');
  const world = root.querySelector('#tree-world');
  const edges = createSvg('g', { class: 'tree-edges' });
  const nodes = createSvg('g', { class: 'tree-nodes' });
  world.append(edges, nodes);
  const cards = root.querySelector('#memory-cards');
  const description = root.querySelector('#tree-description');
  const existing = new Map();
  let lastFrame;
  let displayed;
  let camera = {scale: 1, x: 0, y: 0, following: true};
  let dragging;

  function applyCamera() {
    if (!lastFrame) return;
    const bounds = svg.getBoundingClientRect();
    const width = bounds.width || 560;
    const height = bounds.height || 280;
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    if (camera.following) {
      const active = lastFrame.treeNodes.find(item => item.id === lastFrame.activeNodeId);
      if (active) {
        camera.x = width / 2 - active.x * camera.scale;
        camera.y = height * .58 - active.y * camera.scale;
      }
    }
    world.style.transform = 'translate(' + camera.x + 'px,' + camera.y + 'px) scale(' + camera.scale + ')';
  }

  function zoom(delta) {
    if (!lastFrame) return;
    const width = svg.clientWidth || 560;
    const height = svg.clientHeight || 280;
    const scale = Math.min(2.35, Math.max(.35, camera.scale * delta));
    const ratio = scale / camera.scale;
    camera.x = width / 2 - (width / 2 - camera.x) * ratio;
    camera.y = height / 2 - (height / 2 - camera.y) * ratio;
    camera.scale = scale;
    applyCamera();
  }
  root.querySelector('#zoom-in').addEventListener('click', () => zoom(1.2));
  root.querySelector('#zoom-out').addEventListener('click', () => zoom(1 / 1.2));
  root.querySelector('#center-tree').addEventListener('click', () => {
    camera = {scale: 1, x: 0, y: 0, following: true};
    applyCamera();
  });
  svg.addEventListener('wheel', event => {
    if (!lastFrame) return;
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, {passive: false});
  svg.addEventListener('pointerdown', event => {
    if (!lastFrame || event.button !== 0) return;
    dragging = {id: event.pointerId, x: event.clientX, y: event.clientY};
    camera.following = false;
    world.classList.add('dragging');
    svg.setPointerCapture?.(event.pointerId);
  });
  svg.addEventListener('pointermove', event => {
    if (dragging?.id !== event.pointerId) return;
    camera.x += event.clientX - dragging.x;
    camera.y += event.clientY - dragging.y;
    dragging = {id: event.pointerId, x: event.clientX, y: event.clientY};
    applyCamera();
  });
  function stopDrag() {
    dragging = undefined;
    world.classList.remove('dragging');
  }
  svg.addEventListener('pointerup', stopDrag);
  svg.addEventListener('pointercancel', stopDrag);
  svg.addEventListener('lostpointercapture', stopDrag);
  svg.addEventListener('keydown', event => {
    const vectors = {ArrowLeft: [38, 0], ArrowRight: [-38, 0], ArrowUp: [0, 38], ArrowDown: [0, -38]};
    if (!lastFrame || !vectors[event.key] || !event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    const [x, y] = vectors[event.key];
    camera.following = false;
    camera.x += x;
    camera.y += y;
    applyCamera();
  });

  function clear() {
    existing.clear();
    nodes.replaceChildren();
    edges.replaceChildren();
    cards.replaceChildren(textNode('p', 'Containers appear here as they change.', 'memory-empty'));
    description.textContent = '';
    svg.classList.remove('has-trace');
    lastFrame = undefined;
    displayed = undefined;
    camera = {scale: 1, x: 0, y: 0, following: true};
  }

  function draw(frame, previous) {
    if (!frame) {
      if (lastFrame) clear();
      return;
    }
    lastFrame = frame;
    svg.classList.add('has-trace');
    if (displayed === frame) {
      applyCamera();
      return;
    }
    displayed = frame;
    const positions = new Map(frame.treeNodes.map(item => [item.id, item]));
    for (const [id, node] of existing) {
      if (positions.has(id)) continue;
      node.remove();
      existing.delete(id);
    }
    for (const item of frame.treeNodes) {
      let node = existing.get(item.id);
      if (!node) {
        node = createSvg('g', {transform: 'translate(' + item.x + ' ' + item.y + ')'});
        const rect = createSvg('rect', {x: -57, y: -20, width: 114, height: 40, rx: 9});
        const name = createSvg('text', {y: item.label ? -3 : 4, 'text-anchor': 'middle', class: 'node-name'});
        name.textContent = item.name === '<module>' ? 'Program' : item.name.slice(0, 15) + '()';
        const label = createSvg('text', {y: 11, 'text-anchor': 'middle', class: 'node-label'});
        label.textContent = item.label.slice(0, 19);
        node.append(rect, name, label);
        nodes.append(node);
        existing.set(item.id, node);
      }
      const found = item.found <= frame.stepId;
      const rejected = item.pruned <= frame.stepId;
      node.setAttribute('class', 'tree-node' +
        (found ? ' found' : rejected ? ' pruned' : item.ended <= frame.stepId ? ' done' : '') +
        (item.id === frame.activeNodeId ? ' active' + (frame.event === 'POP' ? ' backtracked' : '') : ''));
    }
    edges.replaceChildren(...frame.treeEdges.map(edge => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      const mid = (from.y + to.y) / 2;
      return createSvg('path', {d: 'M' + from.x + ',' + (from.y + 20) + ' C' + from.x + ',' + mid + ' ' + to.x + ',' + mid + ' ' + to.x + ',' + (to.y - 20)});
    }));
    description.textContent = frame.callStack.length
      ? 'Active call ' + frame.callStack[0].name + '. Call depth ' + frame.callStack.length + '. ' + frame.caption
      : frame.caption;

    const entries = Object.entries(frame.containers).sort(([a], [b]) => Number(containerPriority.test(b)) - Number(containerPriority.test(a))).slice(0, 6);
    const prior = previous?.activeNodeId === frame.activeNodeId ? previous.containers : {};
    cards.replaceChildren(...entries.map(([name, value]) => {
      const card = document.createElement('article');
      const changed = Object.hasOwn(prior, name) && JSON.stringify(prior[name]) !== JSON.stringify(value);
      card.className = 'memory-card' + (changed ? ' memory-' + frame.event.toLowerCase() : '');
      const header = document.createElement('header');
      header.append(textNode('strong', name), textNode('span', Array.isArray(value) || typeof value === 'string' ? String(value.length) : 'map'));
      card.append(header, chips(value, prior[name], frame.event, changed));
      return card;
    }));
    if (!entries.length) cards.append(textNode('p', 'No containers at this step. See the Watch pane for scalar values.', 'memory-empty'));
    applyCamera();
  }
  clear();
  return {draw, clear};
}
