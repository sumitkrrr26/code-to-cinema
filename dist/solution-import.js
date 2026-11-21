import { makeHarness, readExample } from './harness.js';

export const featured = [
  {id: 39, title: 'Combination Sum', category: 'Backtracking', icon: 'layers', sample: {candidates: [2,3,6,7], target: 7}},
  {id: 46, title: 'Permutations', category: 'Backtracking', icon: 'graph', sample: {nums: [1,2,3]}},
  {id: 51, title: 'N-Queens', category: 'Constraint search', icon: 'grid', sample: {n: 4}},
  {id: 78, title: 'Subsets', category: 'Power set', icon: 'memory', sample: {nums: [1,2,3]}}
];

let cache;
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function getIndex() {
  if (!cache) {
    cache = fetch(new URL('./problem-index.json', import.meta.url)).then(response => {
      if (!response.ok) throw new Error('The problem index is unavailable. Try again.');
      return response.json();
    }).catch(error => {
      cache = undefined;
      throw error;
    });
  }
  return cache;
}

export function findProblem(query, index) {
  const cleaned = String(query).trim();
  const id = cleaned.match(/^#?0*(\d+)$/)?.[1];
  let entry;
  if (id) entry = index.problems[id] ? [id, index.problems[id]] : null;
  else {
    let key = cleaned;
    if (/^https?:\/\//i.test(cleaned)) {
      const url = new URL(cleaned);
      if (!/^(?:www\.)?leetcode\.(?:com|cn)$/.test(url.hostname)) throw new Error('Enter a LeetCode problem URL or number.');
      key = url.pathname.match(/^\/problems\/([^/]+)/)?.[1];
      if (!key) throw new Error('Use the URL of an individual LeetCode problem.');
    }
    const target = slug(key);
    entry = Object.entries(index.problems).find(([, [path]]) => slug(path.split('/')[1].replace(/^\d+\./, '')) === target);
  }
  if (!entry) throw new Error('Problem not found in this reference index. Try its LeetCode number.');
  const [number, [path, languages]] = entry;
  return { id: Number(number), title: path.split('/')[1].replace(/^\d+\./, ''), path, languages };
}

async function rawFile(url, signal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error(response.status === 404 ? 'This reference file is unavailable.' : 'GitHub returned ' + response.status + '. Try again.');
  return response.text();
}

export async function loadSolution(query, language, signal) {
  const index = await getIndex();
  if (signal?.aborted) throw signal.reason;
  const problem = findProblem(query, index);
  const cpp = language === 'cpp';
  if (!(problem.languages & (cpp ? 1 : 2))) throw new Error('This problem has no ' + (cpp ? 'C++' : 'Python') + ' reference in the index. Choose the other language.');
  const path = 'solution/' + problem.path.split('/').map(encodeURIComponent).join('/');
  const base = 'https://raw.githubusercontent.com/doocs/leetcode/' + index.revision + '/' + path + '/';
  const filename = cpp ? 'Solution.cpp' : 'Solution.py';
  const sourceUrl = 'https://github.com/doocs/leetcode/blob/' + index.revision + '/' + path + '/' + filename;
  const curated = featured.find(item => item.id === problem.id);
  const [source, markdown] = await Promise.all([
    rawFile(base + filename, signal),
    curated ? '' : rawFile(base + 'README_EN.md', signal).catch(error => {
      if (signal?.aborted) throw error;
      return '';
    })
  ]);
  if (!source.trim() || source.length > 50000) throw new Error('The reference source is empty or too large for the editor.');
  const result = { ...problem, source, sourceUrl, code: source, note: '' };
  try {
    const sample = curated ? new Map(Object.entries(curated.sample)) : readExample(markdown);
    result.code = makeHarness(source, language, sample);
  } catch (error) {
    result.note = error.message + ' The reference is loaded so you can add your own runner.';
  }
  return result;
}
