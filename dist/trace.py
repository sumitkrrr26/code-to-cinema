import collections
import contextlib
import io
import itertools
import json
import math
import sys
import traceback
import types

LIMIT = 1500
BYTE_LIMIT = 6 * 1024 * 1024
OUTPUT_LIMIT = 12000

class CappedOutput(io.StringIO):
    def write(self, value):
        super().write(value[:max(0, OUTPUT_LIMIT - self.tell())])
        return len(value)

def snapshot(value, depth=0, seen=(), budget=None):
    if budget is None:
        budget = [500]
    if budget[0] <= 0:
        return '…'
    budget[0] -= 1
    value_type = type(value)
    if value is None or value_type is bool:
        return value
    if value_type is int:
        return value if -9007199254740991 <= value <= 9007199254740991 else str(value)
    if value_type is float:
        return value if math.isfinite(value) else str(value)
    if value_type is str:
        return value[:250]
    if depth >= 4:
        return '…'
    if id(value) in seen:
        return {'$ref': hex(id(value))}
    path = (*seen, id(value))
    if value_type in (list, tuple, set, frozenset, collections.deque):
        items = itertools.islice(value, 40)
        return [snapshot(item, depth + 1, path, budget) for item in items]
    if value_type is dict:
        return {str(key)[:90]: snapshot(item, depth + 1, path, budget)
                for key, item in itertools.islice(value.items(), 32)
                if type(key) in (str, int, float, bool)}
    try:
        fields = object.__getattribute__(value, '__dict__')
    except (AttributeError, TypeError):
        return '<' + value_type.__name__ + '>'
    return {'$address': hex(id(value)), '$type': value_type.__name__,
            **{key: snapshot(item, depth + 1, path, budget)
               for key, item in itertools.islice(fields.items(), 14)}}

def record(source, stdin='', annotations=None, on_limit=None):
    frames = []
    output = CappedOutput()
    input_stream = io.StringIO(stdin)
    filename = 'algorithm.py'
    pending = {}
    invocation = {}
    sequence = itertools.count(1)
    annotations = annotations or {}
    lines = source.splitlines()
    recorded = 0
    notice = ''

    def capture(frame, line, event='STEP', label='', returned=None):
        nonlocal notice, recorded
        if notice:
            return
        if len(frames) >= LIMIT or recorded >= BYTE_LIMIT:
            notice = f'Trace capped at {len(frames):,} steps for smooth playback.'
            sys.settrace(None)
            pending.clear()
            invocation.clear()
            if on_limit:
                on_limit(json.dumps({'frames': frames, 'output': output.getvalue(), 'notice': notice}))
            return
        budget = [500]
        values = frame.f_locals
        names = dict.fromkeys((*frame.f_code.co_freevars, *itertools.islice(values, 70)))
        scope = {name: snapshot(values[name], budget=budget) for name in names
                 if name in values and not name.startswith('__')
                 and name != 'cinema_frame'
                 and not isinstance(values[name], (types.ModuleType, types.FunctionType, type))}
        stack = []
        call_ids = []
        current = frame
        while current is not None and len(stack) < 20:
            if current in invocation:
                stack.append(current.f_code.co_name)
                call_ids.append(invocation[current])
            current = current.f_back
        frame_data = {'line': line, 'event': event, 'scope': frame.f_code.co_name,
                      'stack': stack, 'callIds': call_ids, 'vars': scope,
                      'outputEnd': len(output.getvalue()), 'label': label or annotations.get(str(line), '')}
        if event == 'EXIT' and frame.f_code.co_name != '<module>':
            frame_data['returned'] = snapshot(returned, budget=budget)
        recorded += len(json.dumps(frame_data, ensure_ascii=False).encode('utf-8', 'replace'))
        frames.append(frame_data)

    def trace(frame, event, arg):
        if frame.f_code.co_filename != filename or frame.f_code.co_name.startswith('cinema_driver_') or frame.f_code.co_name in ('<listcomp>', '<dictcomp>', '<setcomp>', '<genexpr>'):
            return None
        if notice:
            return None
        if event == 'call':
            invocation[frame] = next(sequence)
            capture(frame, frame.f_lineno, 'ENTER')
        elif event == 'line':
            previous = pending.get(frame)
            if previous is not None:
                capture(frame, previous)
            if not notice:
                pending[frame] = frame.f_lineno
        elif event == 'return':
            previous = pending.pop(frame, None)
            if previous is not None:
                is_prune = previous >= 2 and lines[previous - 1].strip() == 'return' and (
                    lines[previous - 2].lstrip().startswith(('if ', 'elif '))
                )
                capture(frame, previous, 'PRUNE' if is_prune else 'STEP')
            capture(frame, frame.f_lineno, 'EXIT', returned=arg)
            invocation.pop(frame, None)
        return trace if not notice else None

    def cinema_frame(line, label=''):
        caller = sys._getframe(1)
        capture(caller, line if type(line) is int else caller.f_lineno, label=str(label)[:140])

    error = ''
    previous_trace, previous_stdin = sys.gettrace(), sys.stdin
    try:
        compiled = compile(source, filename, 'exec')
        sys.stdin = input_stream
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            sys.settrace(trace)
            exec(compiled, {'__name__': '__main__', 'cinema_frame': cinema_frame})
    except BaseException as failure:
        error = ''.join(traceback.format_exception_only(type(failure), failure)).strip()
        if not isinstance(failure, SyntaxError):
            location = [item.lineno for item in traceback.extract_tb(failure.__traceback__)
                        if item.filename == filename]
            if location:
                error = f'Line {location[-1]} · {error}'
    finally:
        sys.settrace(previous_trace)
        sys.stdin = previous_stdin

    return {'frames': frames, 'output': output.getvalue(), 'error': error, 'notice': notice}
