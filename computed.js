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
  let invalid = true;
  const callback = (...deps) => {
    if (invalid) {
      value = cb(...deps);
      if (_onCompute) {
        _onCompute(value);
      }
      invalid = false;
    } else {
      invalid = true;
      if (_onInvalidate) {
        _onInvalidate(value);
      }
    }
  };
  effect(callback, ...deps);
  return () => {
    if (invalid) {
      callback(...deps);
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
