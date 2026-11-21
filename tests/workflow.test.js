import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTrace, FRAME_LIMIT } from '../dist/frames.js';
import { findProblem } from '../dist/solution-import.js';
import { readExample, makeHarness } from '../dist/harness.js';
import { instrumentCpp } from '../dist/instrument.js';

test('normalizes malformed frames, values and call IDs without losing usable steps', () => {
  const raw = {frames: [null, false, {event: 'unknown', line: -5}, {
    line: 1, stack: ['dfs', 'main'], callIds: [{toString: 'invalid'}, 4],
    vars: {grid: [[null, Infinity, 9007199254740992]], empty: [], text: 'Q\n"'}
  }]};
  const {frames} = normalizeTrace(raw, 'line');
  assert.deepEqual(frames.map(frame => [frame.stepId, frame.line, frame.event]), [[1, 0, 'STEP'], [2, 1, 'STEP']]);
  assert.deepEqual(frames[0].treeNodes, []);
  assert.deepEqual(frames[1].variables.grid, [[null, 'Infinity', '9007199254740992']]);
  assert.equal(frames[1].treeEdges.length, 1);
});

test('caps playback and tracks solution and backtracking events in one call', () => {
  const stack = ['dfs', 'main'];
  const callIds = [2, 1];
  const raw = [
    {line: 1, stack, callIds, event: 'ENTER', vars: {ans: [], t: []}},
    {line: 2, stack, callIds, vars: {ans: [], t: [2]}},
    {line: 3, stack, callIds, vars: {ans: [[2]], t: [2]}},
    {line: 4, stack, callIds, vars: {ans: [[2]], t: []}},
    {line: 5, stack, callIds, event: 'EXIT', partialVars: true, vars: {}}
  ];
  const trace = normalizeTrace({frames: raw, output: '[[2]]'}, 'def dfs():\n t.append(2)\n ans.append(t[:])\n t.pop()\n return');
  assert.deepEqual(trace.frames.map(frame => frame.event), ['ENTER', 'PUSH', 'FOUND', 'POP', 'EXIT']);
  assert.equal(trace.frames[2].treeNodes.find(node => node.id === 'call-2').found, 3);
  assert.equal(trace.frames[2].treeNodes.find(node => node.id === 'call-2').ended, 5);
  assert.deepEqual(trace.frames[4].variables.ans, [[2]]);
  const capped = normalizeTrace({frames: Array(FRAME_LIMIT + 1).fill(raw[0]), output: 'completed'});
  assert.equal(capped.frames.length, 1500);
  assert.match(capped.notice, /1,500 steps/);
  assert.equal(capped.output, 'completed');
});

test('resolves exact problem URLs and generates a traced C++ driver', () => {
  const index = JSON.parse(readFileSync(new URL('../dist/problem-index.json', import.meta.url), 'utf8'));
  assert.equal(findProblem('https://leetcode.com/problems/combination-sum/description/', index).id, 39);
  assert.equal(findProblem('#0046', index).title, 'Permutations');
  assert.throws(() => findProblem('https://example.com/problems/combination-sum', index), /LeetCode/);
  const sample = readExample('<strong>Input:</strong> values = [[&quot;Q&quot;]], n = 1\n<strong>Output:</strong> 1');
  const reference = `class Solution {
public:
    int solve(vector<vector<char>>& values, int n) {
        auto dfs = [&](this auto&& dfs, int i) -> int {
            return i ? dfs(i - 1) : values.size();
        };
        return dfs(n);
    }
};`;
  const runnable = makeHarness(reference, 'cpp', sample);
  assert.match(runnable, /function<int\(int\)> dfs/);
  assert.match(runnable, /vector<vector<char>> arg0 = \{\{'Q'\}\}/);
  const traced = instrumentCpp(runnable);
  assert.match(traced, /CINE_EVENT\("ENTER", \d+, "dfs".*SHOW\(i\).*SHOW\(values\)/);
  assert.match(traced, /CINE_EVENT\("EXIT", \d+, "dfs"/);
});
