/**
 * Create a simple history stack for undo/redo of an array state.
 * @param {any[]} initial
 */
export function createHistory(initial) {
  /** @type {any[][]} */
  let stack = [clone(initial)];
  let idx = 0;

  function push(state) {
    // Drop redo tail
    stack = stack.slice(0, idx + 1);
    stack.push(clone(state));
    idx = stack.length - 1;
  }

  function undo() {
    if (idx > 0) {
      idx -= 1;
      return clone(stack[idx]);
    }
    return null;
  }

  function redo() {
    if (idx < stack.length - 1) {
      idx += 1;
      return clone(stack[idx]);
    }
    return null;
  }

  function canUndo() {
    return idx > 0;
  }

  function canRedo() {
    return idx < stack.length - 1;
  }

  return { push, undo, redo, canUndo, canRedo };
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
