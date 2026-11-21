const pythonPrelude = [
  'from typing import List, Optional, Dict, Set, Tuple, Any, Deque',
  'from collections import Counter, defaultdict, deque',
  'from functools import cache, lru_cache, reduce',
  'from heapq import heappop, heappush, heapify, nlargest, nsmallest',
  'from itertools import accumulate, chain, combinations, combinations_with_replacement, pairwise, permutations, product, repeat, zip_longest',
  'from math import inf, sqrt, gcd, ceil, floor, isqrt',
  'from bisect import bisect_left, bisect_right',
  'import typing, collections, functools, heapq, itertools, math, bisect'
].join('\n');

function splitTopLevel(text, typeSyntax = false) {
  const parts = [];
  const opening = typeSyntax ? '([{<' : '([{';
  const closing = typeSyntax ? ')]}>' : ')]}';
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let index = 0; index < text.length; index++) {
    const token = text[index];
    if (quote) {
      if (token === '\\') index++;
      else if (token === quote) quote = '';
      continue;
    }
    if (token === '"' || token === "'") quote = token;
    else if (opening.includes(token)) depth++;
    else if (closing.includes(token)) depth = Math.max(0, depth - 1);
    else if (token === ',' && !depth) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function decodeMarkup(value) {
  return value.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|quot|lt|gt|amp|apos|#39);/g, entity =>
    ({'&nbsp;': ' ', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&amp;': '&', '&apos;': "'", '&#39;': "'"})[entity]);
}

export function readExample(markdown) {
  const sample = markdown.match(/<strong>\s*Input\s*:\s*<\/strong>([\s\S]*?)<strong>\s*Output\s*:\s*<\/strong>/i);
  if (!sample) throw new Error('This problem does not expose a supported sample input.');
  const text = decodeMarkup(sample[1]).trim();
  const values = new Map();
  for (const part of splitTopLevel(text)) {
    const field = part.match(/^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/);
    if (!field) throw new Error('This sample needs a custom test driver.');
    try { values.set(field[1], JSON.parse(field[2])); }
    catch { throw new Error('The sample value for ' + field[1] + ' needs a custom test driver.'); }
  }
  return values;
}

function orderedArguments(params, sample) {
  if (!params.length || sample.size < params.length) throw new Error('The sample does not match the solution’s parameters.');
  const preceding = [...sample.values()];
  return params.map((param, index) => sample.has(param.name) ? sample.get(param.name) : preceding[index]);
}

function cppType(type) {
  return type.replace(/\bconst\b|\bvolatile\b|&/g, '').replace(/\bstd::/g, '').trim();
}

function cppLiteral(type, value) {
  const container = type.match(/^(vector|deque|list|array)\s*<([\s\S]+)>$/);
  if (container && Array.isArray(value)) {
    const [inner] = splitTopLevel(container[2], true);
    return '{' + value.map(item => cppLiteral(inner, item)).join(', ') + '}';
  }
  if (type === 'string' && typeof value === 'string') return JSON.stringify(value);
  if (type === 'char' && typeof value === 'string' && /^[\x20-\x7e]$/.test(value)) {
    return "'" + value.replace(/['\\]/g, '\\$&') + "'";
  }
  if (type === 'bool' && typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value) &&
      /^(?:(?:unsigned|signed|short|long|long long)(?: int)?|(?:unsigned |signed )?long long|int|size_t|u?int\d+_t|float|double|long double)$/.test(type)) {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('The sample contains an integer too large to import losslessly.');
    return String(value);
  }
  throw new Error('The sample uses ' + type + ', which needs a custom C++ test driver.');
}

function adaptRecursiveLambda(source) {
  return source.replace(/\bauto\s+([A-Za-z_]\w*)\s*=\s*(\[&[^\]\n]*\])\(\s*this\s+auto\s*&&\s*\1\s*,\s*([^()\n]+)\)\s*->\s*([\w:<>&* ]+?)\s*(?=\{)/g,
    (original, name, capture, args, result) => {
      const types = splitTopLevel(args, true).map(part => part.match(/^(.*?)[A-Za-z_]\w*$/)?.[1].trim());
      if (types.some(type => !type)) return original;
      return 'function<' + result + '(' + types.join(', ') + ')> ' + name + ' = ' + capture + '(' + args + ') -> ' + result + ' ';
    });
}

function adaptStandardLibrary(source) {
  const containers = new Set([...source.matchAll(/\b(?:unordered_)?(?:multi)?(?:map|set)\s*<[^;\n]+>\s+([A-Za-z_]\w*)/g)].map(match => match[1]));
  return source
    .replace(/\b([A-Za-z_]\w*)\.contains\(([^()\n]+)\)/g, (original, name, key) =>
      containers.has(name) ? '(' + name + '.count(' + key + ') != 0)' : original)
    .replace(/\b(?:std::)?ranges::(sort|reverse)\(([A-Za-z_]\w*)\)/g,
      (_, method, name) => 'std::' + method + '(' + name + '.begin(), ' + name + '.end())');
}

const cppListSupport = `struct ListNode {
    int val;
    ListNode* next;
    ListNode(int value = 0, ListNode* tail = nullptr) : val(value), next(tail) {}
};
ListNode* cinema_driver_list(const vector<int>& values) {
    ListNode* head = nullptr;
    for (auto it = values.rbegin(); it != values.rend(); ++it) head = new ListNode(*it, head);
    return head;
}
string cinema_driver_print_list(ListNode* head) {
    vector<int> values;
    for (auto node = head; node && values.size() < 192; node = node->next) values.push_back(node->val);
    return cinema_detail::value("result", values).second;
}`;

const cppTreeSupport = `struct TreeNode {
    int val;
    TreeNode* left;
    TreeNode* right;
    TreeNode(int value = 0, TreeNode* a = nullptr, TreeNode* b = nullptr) : val(value), left(a), right(b) {}
};
TreeNode* cinema_driver_tree(const vector<long long>& values) {
    const long long absent = LLONG_MIN;
    if (values.empty() || values[0] == absent) return nullptr;
    auto root = new TreeNode(static_cast<int>(values[0]));
    queue<TreeNode*> pending;
    pending.push(root);
    for (size_t i = 1; i < values.size() && !pending.empty();) {
        auto node = pending.front();
        pending.pop();
        if (i < values.size() && values[i] != absent) {
            node->left = new TreeNode(static_cast<int>(values[i]));
            pending.push(node->left);
        }
        ++i;
        if (i < values.size() && values[i] != absent) {
            node->right = new TreeNode(static_cast<int>(values[i]));
            pending.push(node->right);
        }
        ++i;
    }
    return root;
}
string cinema_driver_print_tree(TreeNode* root) {
    vector<string> values;
    queue<TreeNode*> pending;
    pending.push(root);
    while (!pending.empty() && values.size() < 192) {
        auto node = pending.front();
        pending.pop();
        values.push_back(node ? to_string(node->val) : "null");
        if (node) {
            pending.push(node->left);
            pending.push(node->right);
        }
    }
    while (!values.empty() && values.back() == "null") values.pop_back();
    string out = "[";
    for (const auto& token : values) {
        if (out.size() > 1) out += ",";
        out += token;
    }
    return out + "]";
}`;

function pointerKind(type) {
  return type.match(/^(ListNode|TreeNode)\s*\*$/)?.[1] || null;
}

function cppArgument(type, value) {
  const kind = pointerKind(type);
  if (!kind) return cppLiteral(type, value);
  if (!Array.isArray(value) || !value.every(item => Number.isInteger(item) || (kind === 'TreeNode' && item === null))) {
    throw new Error('This node sample needs a custom C++ test driver.');
  }
  const make = kind === 'TreeNode' ? 'cinema_driver_tree' : 'cinema_driver_list';
  return make + '({' + value.map(item => item === null ? 'LLONG_MIN' : cppLiteral('int', item)).join(', ') + '})';
}

function cppHarness(source, sample) {
  const classStart = source.search(/\bclass\s+Solution\s*\{/);
  if (classStart < 0) throw new Error('This import needs a class Solution method or a custom main().');
  const publicStart = source.indexOf('public:', classStart);
  if (publicStart < 0) throw new Error('There is no public Solution method to call.');
  const method = source.slice(publicStart + 7).match(/^\s*([\w:<>,\s*&]+?)\b([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const\s*)?\{/m);
  if (!method) throw new Error('The public C++ method signature needs a custom main().');
  const [, returnType, name, signature] = method;
  const params = splitTopLevel(signature, true).map(part => {
    const match = part.match(/^(.*?)([A-Za-z_]\w*)$/);
    if (!match?.[1].trim()) throw new Error('A C++ parameter could not be identified.');
    return { name: match[2], type: cppType(match[1]) };
  });
  const args = orderedArguments(params, sample);
  const returnKind = pointerKind(cppType(returnType));
  const kinds = [...params.map(param => pointerKind(param.type)), returnKind];
  const supports = [
    kinds.includes('ListNode') && !/^\s*struct ListNode\s*\{/m.test(source) ? cppListSupport : '',
    kinds.includes('TreeNode') && !/^\s*struct TreeNode\s*\{/m.test(source) ? cppTreeSupport : ''
  ].filter(Boolean);
  const declarations = params.map(({type}, index) =>
    '    ' + type + ' arg' + index + ' = ' + cppArgument(type, args[index]) + ';');
  const invocation = 'solution.' + name + '(' + params.map((_, index) => 'arg' + index).join(', ') + ')';
  const isVoid = returnType.trim() === 'void';
  const printer = returnKind === 'ListNode' ? 'cinema_driver_print_list(result)' :
    returnKind === 'TreeNode' ? 'cinema_driver_print_tree(result)' :
      'cinema_detail::value("result", ' + (isVoid ? 'arg0' : 'result') + ').second';
  return ['#include <bits/stdc++.h>', 'using namespace std;', '', ...supports, adaptStandardLibrary(adaptRecursiveLambda(source.trim())), '',
    '// Sample driver generated by Code to Cinema.', 'int main() {', ...declarations,
    '    Solution solution;', '    ' + (isVoid ? '' : 'auto result = ') + invocation + ';',
    '    cout << ' + printer + ' << \'\\n\';', '}'].join('\n');
}

function pythonLiteral(value) {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) return '[' + value.map(pythonLiteral).join(', ') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).map(([key, item]) =>
    pythonLiteral(key) + ': ' + pythonLiteral(item)).join(', ') + '}';
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
    throw new Error('The sample contains a number too large to import losslessly.');
  }
  return JSON.stringify(value);
}

const pythonListSupport = `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def cinema_driver_list(values):
    head = None
    for value in reversed(values):
        head = ListNode(value, head)
    return head

def cinema_driver_print_list(node):
    values = []
    while node and len(values) < 192:
        values.append(node.val)
        node = node.next
    return values`;

const pythonTreeSupport = `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def cinema_driver_tree(values):
    if not values or values[0] is None:
        return None
    root = TreeNode(values[0])
    pending = deque([root])
    children = iter(values[1:])
    while pending:
        node = pending.popleft()
        for side in ("left", "right"):
            value = next(children, None)
            if value is not None:
                child = TreeNode(value)
                setattr(node, side, child)
                pending.append(child)
    return root

def cinema_driver_print_tree(root):
    values = []
    pending = deque([root])
    while pending and len(values) < 192:
        node = pending.popleft()
        values.append(None if node is None else node.val)
        if node is not None:
            pending.extend((node.left, node.right))
    while values and values[-1] is None:
        values.pop()
    return values`;

function pythonHarness(source, sample) {
  const classBody = source.match(/^class\s+Solution\b[^\n]*:\s*\n([\s\S]+)/m)?.[1];
  const method = classBody?.match(/^[ \t]+def\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:->[^\n:]+)?:/m);
  if (!method) throw new Error('This import needs a Solution method or a custom Python runner.');
  const [, name, signature] = method;
  const params = splitTopLevel(signature).filter(part => part !== 'self').map(part => {
    const name = part.match(/^([A-Za-z_]\w*)/)?.[1];
    if (!name) throw new Error('A Python parameter could not be identified.');
    return { name, kind: part.split(':')[1]?.match(/\b(?:ListNode|TreeNode)\b/)?.[0] };
  });
  const args = orderedArguments(params, sample);
  const returnKind = method[0].split('->')[1]?.match(/\b(?:ListNode|TreeNode)\b/)?.[0];
  const kinds = [...params.map(param => param.kind), returnKind];
  const supports = [
    kinds.includes('ListNode') && !/^class ListNode\b/m.test(source) ? pythonListSupport : '',
    kinds.includes('TreeNode') && !/^class TreeNode\b/m.test(source) ? pythonTreeSupport : ''
  ].filter(Boolean);
  const argumentsCode = args.map((value, index) => {
    const literal = pythonLiteral(value);
    return params[index].kind === 'ListNode' ? 'cinema_driver_list(' + literal + ')' :
      params[index].kind === 'TreeNode' ? 'cinema_driver_tree(' + literal + ')' : literal;
  });
  const printable = returnKind === 'ListNode' ? 'cinema_driver_print_list(result)' :
    returnKind === 'TreeNode' ? 'cinema_driver_print_tree(result)' : 'result if result is not None else sample[0]';
  const prelude = /^\s*from __future__ import\b/.test(source) ? '' : 'from __future__ import annotations\n';
  const code = source.trim();
  const futureEnd = code.match(/^(?:from __future__ import[^\n]*\n)+/)?.[0].length || 0;
  const definitions = prelude + code.slice(0, futureEnd) + [pythonPrelude, ...supports, code.slice(futureEnd)].join('\n\n');
  return definitions + '\n\n# Sample driver generated by Code to Cinema.\n' +
    'sample = [' + argumentsCode.join(', ') + ']\n' +
    'result = Solution().' + name + '(*sample)\nprint(' + printable + ')';
}

export function makeHarness(source, language, sample) {
  return language === 'cpp' ? cppHarness(source, sample) : pythonHarness(source, sample);
}
