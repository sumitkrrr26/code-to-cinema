export const CPP_FRAME_LIMIT = 1500;

const cppPreamble = String.raw`
#include <algorithm>
#include <array>
#include <bitset>
#include <cassert>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <functional>
#include <iomanip>
#include <iostream>
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <tuple>
#include <utility>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace cinema_detail {
inline std::string quote(const std::string& value) {
    std::string out = "\"";
    for (unsigned char ch : value.substr(0, 180)) {
        if (ch == '\\' || ch == '"') { out += '\\'; out += ch; }
        else if (ch < 32) {
            char escaped[7];
            std::snprintf(escaped, sizeof(escaped), "\\u%04x", ch);
            out += escaped;
        } else out += ch;
    }
    return out + "\"";
}
inline std::string address(const void* value) {
    std::ostringstream buffer;
    buffer << value;
    return buffer.str();
}
template<class T> struct pair_type : std::false_type {};
template<class A, class B> struct pair_type<std::pair<A, B>> : std::true_type {};
template<class T> struct lifo : std::false_type {};
template<class T, class C> struct lifo<std::stack<T, C>> : std::true_type {};
template<class T, class C, class Comp> struct lifo<std::priority_queue<T, C, Comp>> : std::true_type {};
template<class T, class = void> struct range : std::false_type {};
template<class T> struct range<T, std::void_t<decltype(std::begin(std::declval<const T&>())), decltype(std::end(std::declval<const T&>()))>> : std::true_type {};
template<class T, class = void> struct mapping : std::false_type {};
template<class T> struct mapping<T, std::void_t<typename T::mapped_type>> : std::true_type {};
template<class T, class = void> struct node : std::false_type {};
template<class T> struct node<T, std::void_t<decltype(std::declval<const T&>().next)>> : std::true_type {};
template<class T, class = void> struct has_value : std::false_type {};
template<class T> struct has_value<T, std::void_t<decltype(std::declval<const T&>().value)>> : std::true_type {};
template<class T, class = void> struct has_val : std::false_type {};
template<class T> struct has_val<T, std::void_t<decltype(std::declval<const T&>().val)>> : std::true_type {};
template<class T> struct fifo : std::false_type {};
template<class T, class C> struct fifo<std::queue<T, C>> : std::true_type {};

template<class T> std::string json(const T& value, unsigned& budget, int depth = 0) {
    if (!budget) return "\"…\"";
    --budget;
    if (depth > 4) return "\"…\"";
    if constexpr (std::is_same_v<T, std::string>) return quote(value);
    else if constexpr (std::is_same_v<T, bool>) return value ? "true" : "false";
    else if constexpr (std::is_integral_v<T>) {
        if constexpr (std::is_same_v<T, char>) return quote(std::string(1, value));
        auto text = std::to_string(value);
        return text.size() > 15 ? quote(text) : text;
    }
    else if constexpr (std::is_floating_point_v<T>) return std::isfinite(value) ? std::to_string(value) : quote("non-finite");
    else if constexpr (std::is_same_v<T, std::nullptr_t>) return "null";
    else if constexpr (std::is_pointer_v<T>) {
        if (value == nullptr) return "null";
        if constexpr (!std::is_function_v<std::remove_pointer_t<T>>) {
            return "{\"$ref\":" + quote(address(const_cast<const void*>(static_cast<const volatile void*>(value)))) + "}";
        }
        return quote("<function pointer>");
    }
    else if constexpr (pair_type<T>::value) {
        return "{\"first\":" + json(value.first, budget, depth + 1)
            + ",\"second\":" + json(value.second, budget, depth + 1) + "}";
    }
    else if constexpr (node<T>::value) {
        std::string result = "{\"$address\":" + quote(address(&value)) + ",\"next\":" + json(value.next, budget, depth + 1);
        if constexpr (has_value<T>::value) result += ",\"value\":" + json(value.value, budget, depth + 1);
        if constexpr (has_val<T>::value) result += ",\"val\":" + json(value.val, budget, depth + 1);
        return result + "}";
    }
    else if constexpr (mapping<T>::value) {
        std::string out = "{";
        unsigned count = 0;
        for (const auto& entry : value) {
            if (count >= 32 || !budget) break;
            if (count++) out += ',';
            using Key = typename T::key_type;
            if constexpr (std::is_same_v<Key, std::string>) out += quote(entry.first);
            else if constexpr (std::is_same_v<Key, char>) out += quote(std::string(1, entry.first));
            else if constexpr (std::is_arithmetic_v<Key>) out += quote(std::to_string(entry.first));
            else out += quote(std::to_string(count));
            out += ':' + json(entry.second, budget, depth + 1);
        }
        return out + "}";
    }
    else if constexpr (range<T>::value) {
        std::string out = "[";
        unsigned count = 0;
        for (const auto& item : value) {
            if (count >= (depth ? 40 : 192) || !budget) break;
            if (count++) out += ',';
            out += json(item, budget, depth + 1);
        }
        return out + "]";
    }
    else if constexpr (fifo<T>::value || lifo<T>::value) {
        if constexpr (std::is_copy_constructible_v<typename T::value_type>) {
            if (value.size() <= 256) {
                auto copy = value;
                std::string out = "[";
                for (int count = 0; count < 40 && budget && !copy.empty(); ++count, copy.pop()) {
                    if (count) out += ',';
                    if constexpr (lifo<T>::value) out += json(copy.top(), budget, depth + 1);
                    else out += json(copy.front(), budget, depth + 1);
                }
                return out + "]";
            }
        }
        return "{\"size\":" + std::to_string(value.size()) + "}";
    }
    else return quote("<object>");
}

template<class T> std::pair<std::string, std::string> value(const char* name, const T& item) {
    unsigned budget = 260;
    return {quote(name), json(item, budget)};
}

static const struct Call* activeCall = nullptr;
static unsigned callId = 0;

struct Call {
    const char* name;
    const Call* parent;
    unsigned id;

    explicit Call(const char* scope) : name(scope), parent(activeCall), id(++callId) {
        activeCall = this;
    }
    ~Call() { activeCall = parent; }
};

template<class Exit> struct TraceScope : Call {
    Exit onExit;
    TraceScope(const char* name, Exit exit) : Call(name), onExit(std::move(exit)) {}
    ~TraceScope() noexcept { onExit(); }
};

static unsigned frameCount = 0;
static unsigned recordedBytes = 0;
static bool recordingStopped = false;
constexpr unsigned frameLimit = ${CPP_FRAME_LIMIT};
constexpr unsigned byteLimit = 6 * 1024 * 1024;

inline bool canRecord() {
    if (frameCount < frameLimit && recordedBytes < byteLimit) return true;
    if (!recordingStopped) {
        std::cout << std::flush;
        std::cerr << std::flush;
        std::fputs("@@CINEMA@@{\"truncated\":true}\n", stdout);
        std::fflush(stdout);
        recordingStopped = true;
    }
    return false;
}

template<class... Entries> void frame(const char* event, int line, const char* scope, const char* label, const Entries&... entries) {
    ++frameCount;
    std::cout << std::flush;
    std::cerr << std::flush;
    std::string out = "@@CINEMA@@{\"line\":" + std::to_string(line) + ",\"scope\":" + quote(scope)
        + ",\"event\":" + quote(event) + ",\"label\":" + quote(label) + ",\"stack\":[";
    unsigned depth = 0;
    for (const auto* call = activeCall; call && depth < 20; call = call->parent) {
        if (depth++) out += ',';
        out += quote(call->name);
    }
    if (!depth) out += quote(scope);
    out += "],\"callIds\":[";
    depth = 0;
    for (const auto* call = activeCall; call && depth < 20; call = call->parent) {
        if (depth++) out += ',';
        out += std::to_string(call->id);
    }
    out += "],\"callId\":" + std::to_string(activeCall ? activeCall->id : 0);
    if (std::strcmp(event, "EXIT") == 0) out += ",\"partialVars\":true";
    out += ",\"vars\":{";
    bool first = true;
    auto append = [&](const auto& entry) {
        if (!first) out += ',';
        first = false;
        out += entry.first + ":" + entry.second;
    };
    (append(entries), ...);
    out += "}}\n";
    recordedBytes += static_cast<unsigned>(out.size());
    std::fputs(out.c_str(), stdout);
    std::fflush(stdout);
}
}
#define SHOW(item) cinema_detail::value(#item, (item))
#define CINE_EVENT(event, ...) do { if (cinema_detail::canRecord()) cinema_detail::frame(event, __VA_ARGS__); } while (false)
#define CINE(...) CINE_EVENT("STEP", __VA_ARGS__)
#line 1 "algorithm.cpp"
`;

export function withCppRuntime(source) {
  return cppPreamble + source.replace(/^[ \t]*#[ \t]*include[ \t]*[<"]bits\/stdc\+\+\.h[>"][^\n]*/gm, '// The runtime supplies standard library headers.');
}

function maskedCode(source) {
  return source.replace(/^[ \t]*#(?:[^\n]*\\\n)*[^\n]*|\/\*[\s\S]*?\*\/|\/\/[^\n]*|R"([^\s(]*)\([\s\S]*?\)\1"|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/gm,
    match => match.replace(/[^\n]/g, ' '));
}

const primitive = /^(?:(?:unsigned|signed|long|short|int|float|double|char|bool|size_t|u?int\d+_t)\b|.+\*)/;
const typePrefix = /^(?:(?:const|volatile|static|constexpr|mutable|register)\s+)*((?:(?:unsigned|signed|long|short)\s+)*(?:[A-Za-z_]\w*::)*[A-Za-z_]\w*(?:\s*<.*>)?)([\s*&]+)(.*)$/s;
const reserved = /^(?:return|throw|if|else|while|do|for|switch|case|break|continue|goto|using|delete|new|typedef|static_assert|namespace)$/;
const knownType = /^(?:std::)?(?:vector|deque|list|array|set|multiset|unordered_set|map|unordered_map|queue|priority_queue|stack|pair|string)\b/;

function declarations(statement, parameters = false) {
  const trimmed = statement.trim();
  const binding = trimmed.match(/^(?:const\s+)?auto\s*&{0,2}\s*\[([\w,\s]+)\]\s*[=:{(]/);
  if (binding) return binding[1].split(',').map(name => name.trim()).filter(name => /^[A-Za-z_]\w*$/.test(name));
  const declaration = trimmed.match(typePrefix);
  if (!declaration || reserved.test(declaration[1])) return [];
  const [name] = declaration[3].trim().match(/^[A-Za-z_]\w*/) || [];
  if (!name) return [];
  const rest = declaration[3].slice(name.length).trim();
  if (rest && !/^(?:=(?!=)|[({[]|:(?!:))/.test(rest)) return [];
  if (/^\[[^\]]*\]$/.test(rest) && primitive.test(declaration[1])) return [];
  if (!rest && !parameters && (!knownType.test(declaration[1]) || declaration[2].includes('*'))) return [];
  return [name];
}

function parameterNames(parameters) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < parameters.length; index++) {
    if (parameters[index] === '<') depth++;
    if (parameters[index] === '>' && depth) depth--;
    if (parameters[index] === ',' && !depth) {
      parts.push(parameters.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(parameters.slice(start));
  return parts.flatMap(part => declarations(part, true));
}

function closingBrace(source, index) {
  let depth = 1;
  for (let i = index + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return i;
  }
  return source.length;
}

function lambdaCaptures(clause, body, visible) {
  const captures = clause.split(',').map(part => part.trim());
  const implicit = captures.includes('&') || captures.includes('=');
  const explicit = captures.map(part => part.match(/^&?([A-Za-z_]\w*)/)?.[1]).filter(Boolean);
  return [...new Set([...explicit, ...(implicit ? visible : [])])].filter(name =>
    name !== 'this' && (explicit.includes(name) || new RegExp('\\b' + name + '\\b').test(body))
  );
}

export function instrumentCpp(source, { probes } = {}) {
  const masked = maskedCode(source);
  const automaticProbes = probes ?? !/\bCINE\s*\(/.test(masked);
  const lines = new Uint32Array(masked.length + 1);
  let line = 1;
  for (let index = 0; index <= masked.length; index++) {
    lines[index] = line;
    if (masked[index] === '\n') line++;
  }

  const scopes = [{ kind: 'root', names: new Set(), name: '' }];
  const additions = [];
  let start = 0;
  let grouping = 0;
  const current = () => scopes.at(-1);
  const live = () => scopes.some(scope => scope.kind === 'function') && !scopes.some(scope => scope.kind === 'constexpr');
  function visibleNames() {
    const innermost = scopes.findLastIndex(scope => scope.kind === 'function');
    const visible = scopes.slice(Math.max(0, innermost)).flatMap(scope => [...scope.names]);
    return [...new Set(visible)].slice(-24);
  }
  function probe(codeLine, event = 'STEP') {
    const scope = scopes.findLast(entry => entry.kind === 'function')?.name || 'main';
    const fields = visibleNames().map(name => ', SHOW(' + name + ')').join('');
    return ' CINE_EVENT("' + event + '", ' + codeLine + ', "' + scope + '", ""' + fields + '); ';
  }
  function addProbe(offset, codeLine, event) {
    if (automaticProbes && live()) additions.push([offset, probe(codeLine, event)]);
  }

  for (let index = 0; index < masked.length; index++) {
    const token = masked[index];
    const prefix = () => masked.slice(start, index).trim();
    if (token === '(' || token === '[') grouping++;
    if (token === ')' || token === ']') grouping--;
    if (grouping) continue;

    if (token === '{') {
      const opening = prefix();
      const lambda = opening.match(/(?:\b([A-Za-z_]\w*)\s*=\s*|^)\[([^\]\n]*)\]\s*(?:\(([^()]*)\))?\s*(?:mutable\s*)?(?:->\s*[\w:<>&*,\s]+)?$/s);
      const fn = opening.match(/\b([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:(?:const|noexcept|override|final)\s*)*$/s);
      const control = opening.match(/(?:^|\s)(if|for|while|switch|catch)\s*\((.*)\)\s*$/s);
      const block = !opening || control || /(?:\belse|\bdo|\btry)\s*$/.test(opening);
      const structural = /^(?:struct|class|namespace|union|enum)\b/.test(opening);
      if (current().kind === 'initializer' || (opening && !structural && !block && !fn && !lambda)) {
        scopes.push({ kind: 'initializer', names: new Set() });
        continue;
      }
      if (lambda || (fn && !control && !block && !structural && !reserved.test(fn[1]))) {
        const scope = lambda ? lambda[1] || 'lambda' : fn[1];
        const end = closingBrace(masked, index);
        const params = parameterNames((lambda ? lambda[3] : fn[2]) || '');
        const captures = lambda ? lambdaCaptures(lambda[2], masked.slice(index + 1, end), visibleNames()) : [];
        const kind = /\bconstexpr\b/.test(opening) || scope.startsWith('cinema_driver_') ? 'constexpr' : 'function';
        scopes.push({ kind, name: scope, names: new Set([...params, ...captures]) });
        if (live()) {
          const exit = automaticProbes ? probe(lines[end], 'EXIT') : '';
          additions.push([index + 1, ' cinema_detail::TraceScope cinema_call_' + index + '("' + scope + '", [&]() {' + exit + '}); ']);
          addProbe(index + 1, lines[index], 'ENTER');
        }
      } else {
        const loopNames = control?.[1] === 'for' ? declarations(control[2].split(';')[0], true) : [];
        scopes.push({ kind: structural ? 'structure' : 'block', names: new Set(loopNames), conditional: control?.[1] === 'if' });
        if (live() && control && control[1] !== 'switch') addProbe(index + 1, lines[index]);
      }
      start = index + 1;
    } else if (token === '}') {
      if (scopes.length === 1) continue;
      if (scopes.pop().kind !== 'initializer') start = index + 1;
    } else if (token === ';' && current().kind !== 'initializer') {
      const statement = prefix();
      if (statement && live()) {
        const leading = start + (masked.slice(start, index).match(/^\s*/) || [''])[0].length;
        if (/^(?:return|throw|break|continue)\b/.test(statement)) {
          const branchReturn = /^return\s*$/.test(statement) && current().conditional && !current().sawMutation;
          addProbe(leading, lines[leading], branchReturn ? 'PRUNE' : undefined);
        } else if (!/^\s*(?:else|catch)\b/.test(masked.slice(index + 1)) && !/^case\b|^default\s*:/.test(statement)) {
          if (/\b(?:push_back|emplace_back|append|insert)\s*\(/.test(statement)) current().sawMutation = true;
          declarations(statement).forEach(name => current().names.add(name));
          addProbe(index + 1, lines[leading]);
        }
      } else if (current().kind === 'root' && statement) {
        declarations(statement).forEach(name => current().names.add(name));
      }
      start = index + 1;
    }
  }

  let result = '';
  let offset = 0;
  for (const [position, probe] of additions) {
    result += source.slice(offset, position) + probe;
    offset = position;
  }
  return withCppRuntime(result + source.slice(offset));
}
