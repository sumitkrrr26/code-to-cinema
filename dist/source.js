export function normalizeSource(value, language) {
  const fenced = value.match(/^\s*```[\w+.-]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*\s*$/);
  let code = fenced ? fenced[1] : value;
  if (language !== 'cpp') return code;

  // Some chat editors escape Markdown punctuation and line endings on copy.
  const escapedInclude = /^\s*\\#include\b/m.test(code);
  const escapedIndent = /^[ \t]*&#(?:x20|32);/im.test(code);
  if (!escapedInclude && !escapedIndent) return code;
  code = code.replace(/^([ \t]*)\\(?=#)/gm, '$1').replace(/\\([<>])/g, '$1');
  code = code.replace(/^([ \t]*(?:&#(?:x20|32);[ \t]*)+)/gim,
    indent => indent.replace(/&#(?:x20|32);/gi, ' '));
  const lines = code.split(/\r?\n/);
  const nonempty = lines.slice(0, -1).filter(line => line.trim());
  if (nonempty.length && nonempty.every(line => line.endsWith('\\'))) {
    return lines.map(line => line.replace(/\\$/, '')).join('\n');
  }
  return code;
}

export function looksLikeCpp(value) {
  return /^\s*```(?:cpp|c\+\+|cxx)\s*$/im.test(value) ||
    /^[ \t]*\\?#[ \t]*include[ \t]*\\?[<"]/m.test(value) ||
    /^[ \t]*(?:int|auto)\s+main\s*\(/m.test(value);
}

export function readsProgramInput(code, language) {
  return language === 'cpp' && /\b(?:cin\b\s*(?:>>|[.]\s*(?:get|getline|read|ignore|peek)\s*\()|(?:scanf|getchar)\s*\(|(?:fscanf|fgets)\s*\([^;\n]*\bstdin\b|getline\s*\(\s*(?:std::\s*)?cin\b)/.test(code);
}
