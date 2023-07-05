export function link(...items) {
  return ["link", ...items];
}

export function unlink(...items) {
  return ["unlink", ...items];
}

export function create(...items) {
  return ["create", ...items];
}

const CLEAR = ["clear"];

export function clear() {
  return CLEAR;
}
