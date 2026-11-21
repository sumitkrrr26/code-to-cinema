const pyodideBase = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
const clangBase = 'https://raw.githubusercontent.com/binji/wasm-clang/648c4a89997a351eef75cdaec3ef5b89d4937dec/';

function status(message) {
  postMessage({ type: 'status', message });
}

async function loadBinary(name) {
  const response = await fetch(clangBase + name);
  if (!response.ok) throw new Error('The C++ runtime could not download ' + name + '.');
  return response.arrayBuffer();
}

async function runPython(request) {
  status('Loading Python runtime…');
  importScripts(pyodideBase + 'pyodide.js');
  const py = await loadPyodide({ indexURL: pyodideBase });
  status('Recording Python frames…');
  py.runPython(request.tracer);
  py.globals.set('__cinema_source', request.source);
  py.globals.set('__cinema_input', request.stdin);
  py.globals.set('__cinema_labels', JSON.stringify(request.labels || {}));
  py.globals.set('__cinema_partial', serial => postMessage({ type: 'partial', trace: JSON.parse(serial) }));
  const result = py.runPython('json.dumps(record(__cinema_source, __cinema_input, json.loads(__cinema_labels), __cinema_partial), ensure_ascii=True)');
  return JSON.parse(result);
}

async function runCpp(request) {
  status('Loading C++ compiler…');
  const frames = [];
  const prefix = '@@CINEMA@@';
  const terminalFormat = /\x1b\[[0-9;]*m/g;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const asByteString = value => Array.from(encoder.encode(value), byte => String.fromCharCode(byte)).join('');
  let compilerLog = '';
  let output = '';
  let pending = '';
  let phase = 'compile';
  let error = '';
  let truncated = false;

  const limitNotice = () => 'Trace capped at ' + frames.length.toLocaleString('en-US') + ' steps for smooth playback.';

  function capture(bytes) {
    const text = decoder.decode(Uint8Array.from(bytes, character => character.charCodeAt(0)), { stream: true });
    if (phase === 'compile') {
      compilerLog = (compilerLog + text).slice(-8000);
      return;
    }
    pending += text;
    let marker = pending.indexOf(prefix);
    while (marker >= 0) {
      output = (output + pending.slice(0, marker)).slice(0, 12000);
      pending = pending.slice(marker);
      const newline = pending.indexOf('\n');
      if (newline < 0 && pending.length < 200000) return;
      if (newline < 0) {
        pending = '';
        error = 'An execution frame was too large.';
        return;
      }
      try {
        const frame = JSON.parse(pending.slice(prefix.length, newline));
        if (frame?.truncated === true) {
          if (!truncated) postMessage({
            type: 'partial',
            trace: { frames, output, error: '', notice: limitNotice() }
          });
          truncated = true;
        } else if (frame && Number.isInteger(frame.line) && typeof frame.scope === 'string') {
          if (frames.length < 1500) {
            frame.outputEnd = output.length;
            frames.push(frame);
          }
        } else {
          output = (output + pending.slice(0, newline + 1)).slice(0, 12000);
        }
      } catch {
        output = (output + pending.slice(0, newline + 1)).slice(0, 12000);
      }
      pending = pending.slice(newline + 1);
      marker = pending.indexOf(prefix);
    }
    const retained = Math.min(prefix.length - 1, pending.length);
    output = (output + pending.slice(0, pending.length - retained)).slice(0, 12000);
    pending = pending.slice(pending.length - retained);
  }

  const api = new API({
    readBuffer: loadBinary,
    compileStreaming: async name => WebAssembly.compile(await loadBinary(name)),
    hostWrite: capture
  });
  api.hostLog = () => {};
  api.hostLogAsync = (_, operation) => operation;
  api.clangCommonArgs.push('-std=c++17');
  try {
    await api.ready;
    status('Compiling C++ to WebAssembly…');
    await api.compile({ input: 'algorithm.cpp', contents: encoder.encode(request.source).buffer, obj: 'algorithm.o' });
    await api.link('algorithm.o', 'algorithm.wasm');
    const program = await WebAssembly.compile(api.memfs.getFileContents('algorithm.wasm'));
    phase = 'run';
    if (request.stdin) {
      api.memfs.setStdinStr(asByteString(request.stdin));
    }
    status('Recording C++ frames…');
    await api.run(program, 'algorithm.wasm');
  } catch (problem) {
    error = phase === 'compile'
      ? (compilerLog.replace(terminalFormat, '').trim() || problem.message)
      : problem.message;
  }

  return {
    frames, output: (output + pending + decoder.decode()).replace(terminalFormat, '').replace(/\n$/, ''),
    error,
    notice: truncated ? limitNotice() : ''
  };
}

self.onmessage = async ({ data }) => {
  try {
    const trace = data.language === 'python' ? await runPython(data) : await runCpp(data);
    postMessage({ type: 'result', trace });
  } catch (error) {
    postMessage({ type: 'result', trace: { frames: [], output: '', error: error.message || String(error) } });
  }
};
