# Code to Cinema

A browser-based execution visualizer for Python and C++ algorithms. Use the stage to scrub execution, inspect state and stdout, and browse the animated call tree and live memory, or switch to array, graph, memory, and stack views.

## Run locally

From the repository root, start a static server:

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000. New traces require internet access to load the pinned Pyodide or wasm-clang runtimes. Reference imports also fetch source and, when needed, sample input from GitHub.

## Find a reference solution

Enter a LeetCode problem URL or number, select C++ or Python, and choose **Load & Animate**. The four featured problems are Combination Sum, Permutations, N-Queens, and Subsets. The bundled index resolves paths and language availability for a pinned [Doocs snapshot](https://github.com/doocs/leetcode/tree/3eb907489e4f31f5c6d5a3da0e8cfc0201eaecbd). Each import links to its exact source file. The references are licensed under [CC BY-SA 4.0](https://github.com/doocs/leetcode/blob/3eb907489e4f31f5c6d5a3da0e8cfc0201eaecbd/LICENSE).

The sample driver supports ordinary `class Solution` methods with numeric, string, boolean, collection, and common list/tree arguments. Imported C++ uses the browser's C++17 compiler. The driver adapts common newer syntax such as named recursive lambdas with explicit object parameters. Some samples, design problems, or signatures need a custom runner. In those cases the editor loads the source and shows a message.

## Record a trace

Choose a language and paste a complete program or select a built-in example. Paste the problem’s complete sample input in **Program input**, including the test-case count if your program reads one. Choose **Run trace**. The **Phone keypad backtracking** example comes with input for each language. Use **First frame**, **Previous**, **Play**, **Next**, **Last frame**, or the timeline to navigate. The **Steps** tab also jumps to a specific source line and frame.

Python uses Pyodide and records line-level state with `sys.settrace`. C++ uses Clang 8 in WebAssembly with C++17. Automatic probes track named functions, recursive lambdas, structured bindings, and standard containers. Python tracks nested calls and their closure variables. Use a `main()` entry point. For unsupported constructs or exact control over capture, add your own probes:

```cpp
CINE(12, "main", "After exchanging elements", SHOW(values), SHOW(i));
```

The first argument maps the frame back to a line in the editor. Manual probes replace automatic insertion in that submission. C++ pointers are shown as addresses or null. The memory view connects pointers to recorded objects when their addresses are available.

An execution has a 50-second time limit. Both runtimes record up to 1,500 frames or approximately 6 MiB of trace data. The program continues within the time limit so the result remains available in **Output**. Both traces are validated and normalized before playback. Large collections and deep objects are sampled. Libraries and system capabilities follow the browser runtimes.

## Verify the workflow

Run `node --test tests/*.test.js` to verify frame normalization, playback limits, example parsing, and C++ driver instrumentation.

## AI instrumentation

Open **AI instrumentation**, enter an OpenAI API key, and choose an API model. The app sends the current source to OpenAI for probe insertion and view suggestions. It then executes the resulting source locally to capture frames. The key stays in the current request and the supplied standard input stays in the browser. Local tracing works without an API key.

The web app has no build step and no server-side code. Execution runs in a worker created inside a sandboxed iframe. Third-party licenses for wasm-clang are in `dist/vendor`.
