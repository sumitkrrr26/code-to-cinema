export const presets = {
  fibonacci: {
    title: 'Fibonacci DP', kind: 'Array', variable: 'dp',
    python: `def fibonacci(n):
    dp = [0, 1] + [0] * (n - 1)

    for i in range(2, n + 1):
        dp[i] = dp[i - 1] + dp[i - 2]

    return dp[n]


n = 7
result = fibonacci(n)
print(result)`,
    cpp: `#include <iostream>
#include <vector>
using namespace std;

int fibonacci(int n) {
    vector<int> dp(n + 1, 0);
    dp[1] = 1;

    for (int i = 2; i <= n; i++) {
        dp[i] = dp[i - 1] + dp[i - 2];
    }

    return dp[n];
}

int main() {
    int n = 7;
    int result = fibonacci(n);
    cout << result << endl;
}`
  },
  bfs: {
    title: 'Breadth-first search', kind: 'Graph', variable: 'graph',
    python: `from collections import deque

graph = {
    "A": ["B", "C"],
    "B": ["D", "E"],
    "C": ["F"],
    "D": [], "E": [], "F": []
}

queue = deque(["A"])
visited = {"A"}
order = []

while queue:
    node = queue.popleft()
    order.append(node)

    for neighbor in graph[node]:
        if neighbor not in visited:
            visited.add(neighbor)
            queue.append(neighbor)

print(order)`,
    cpp: `#include <iostream>
#include <map>
#include <string>
#include <vector>
using namespace std;

int main() {
    map<string, vector<string>> graph = {
        {"A", {"B", "C"}}, {"B", {"D", "E"}},
        {"C", {"F"}}, {"D", {}}, {"E", {}}, {"F", {}}
    };
    vector<string> queue = {"A"};
    vector<string> order;
    vector<string> visited = {"A"};

    while (!queue.empty()) {
        string node = queue.front();
        queue.erase(queue.begin());
        order.push_back(node);
        for (const string& neighbor : graph[node]) {
            bool seen = false;
            for (const string& item : visited) {
                if (item == neighbor) { seen = true; }
            }
            if (!seen) {
                visited.push_back(neighbor);
                queue.push_back(neighbor);
            }
        }
    }

    for (const string& item : order) { cout << item << ' '; }
    cout << endl;
}`
  },
  sort: {
    title: 'Bubble sort', kind: 'Array', variable: 'values',
    python: `values = [8, 3, 6, 1, 5, 2]

for end in range(len(values) - 1, 0, -1):
    for i in range(end):
        if values[i] > values[i + 1]:
            values[i], values[i + 1] = values[i + 1], values[i]

print(values)`,
    cpp: `#include <iostream>
#include <vector>
#include <utility>
using namespace std;

int main() {
    vector<int> values = {8, 3, 6, 1, 5, 2};
    for (int end = values.size() - 1; end > 0; --end) {
        for (int i = 0; i < end; ++i) {
            if (values[i] > values[i + 1]) {
                swap(values[i], values[i + 1]);
            }
        }
    }
    for (int value : values) { cout << value << ' '; }
    cout << endl;
}`
  },
  pointers: {
    title: 'Reverse linked list', kind: 'Memory', variable: '',
    python: `class Node:
    def __init__(self, value, next_node=None):
        self.value = value
        self.next = next_node

head = Node(4, Node(7, Node(9)))
prev = None
current = head

while current:
    next_node = current.next
    current.next = prev
    prev = current
    current = next_node

head = prev
print(head.value)`,
    cpp: `#include <iostream>
using namespace std;

struct Node {
    int value;
    Node* next;
};

int main() {
    Node third{9, nullptr};
    Node second{7, &third};
    Node first{4, &second};
    Node* head = &first;
    Node* prev = nullptr;
    Node* current = head;

    while (current) {
        Node* next = current->next;
        current->next = prev;
        prev = current;
        current = next;
    }

    head = prev;
    cout << head->value << endl;
}`
  },
  keypad: {
    title: 'Phone keypad backtracking', kind: 'Stack', variable: '',
    input: { python: '23\n', cpp: '1\n23\n' },
    python: `keys = dict(zip("23456789", ("abc", "def", "ghi", "jkl", "mno", "pqrs", "tuv", "wxyz")))

def combinations(digits):
    answer = []
    path = []

    def solve(index):
        if index == len(digits):
            answer.append("".join(path))
            return
        for letter in keys[digits[index]]:
            path.append(letter)
            solve(index + 1)
            path.pop()

    if digits:
        solve(0)
    return answer

print(" ".join(combinations(input().strip())))`,
    cpp: `#include <bits/stdc++.h>
using namespace std;

void solve(int idx, string &digits, string &curr, vector<string> &ans, unordered_map<char, string> &mp) {
    if (idx == digits.size()) {
        ans.push_back(curr);
        return;
    }

    for (char ch : mp[digits[idx]]) {
        curr.push_back(ch);
        solve(idx + 1, digits, curr, ans, mp);
        curr.pop_back();
    }
}

vector<string> letterCombinations(string digits) {
    vector<string> ans;
    if (digits.empty()) return ans;

    unordered_map<char, string> mp = {
        {'2', "abc"},
        {'3', "def"},
        {'4', "ghi"},
        {'5', "jkl"},
        {'6', "mno"},
        {'7', "pqrs"},
        {'8', "tuv"},
        {'9', "wxyz"}
    };

    string curr = "";
    solve(0, digits, curr, ans, mp);
    return ans;
}

int main() {
    // Fast I/O
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    int t;
    if (cin >> t) {
        while (t--) {
            string digits;
            cin >> digits;

            vector<string> result = letterCombinations(digits);

            for (int i = 0; i < result.size(); i++) {
                cout << result[i] << (i + 1 == result.size() ? "" : " ");
            }
            cout << "\\n";
        }
    }

    return 0;
}`
  }
};
