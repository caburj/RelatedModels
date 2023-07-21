import { reactive } from "./reactivity";

function effect(cb, ...deps) {
  const reactiveDeps = reactive(deps, () => {
    cb(...reactiveDeps);
  });
  cb(...reactiveDeps);
}

let _onCompute;
let _onInvalidate;

export function computed(cb, { deps }) {
  let value;
  let valid = false;
  const compute = (...deps) => {
    if (!valid) {
      value = cb(...deps);
      if (_onCompute) {
        _onCompute(value);
      }
      valid = true;
    } else {
      valid = false;
      if (_onInvalidate) {
        _onInvalidate(value);
      }
    }
  };
  effect(compute, ...deps);
  return () => {
    if (!valid) {
      compute(...deps);
    }
    return value;
  };
}

export function onCompute(cb) {
  _onCompute = cb;
  return () => {
    _onCompute = null;
  };
}

export function onInvalidate(cb) {
  _onInvalidate = cb;
  return () => {
    _onInvalidate = null;
  };
}
