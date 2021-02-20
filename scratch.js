const makeChangeId = (first, second) => `${first}${__}${second}`;

class Changes {
  constructor() {
    this._changes = {};
  }
  restart() {
    this._changes = {};
  }
  add(id, val) {
    const current = this._changes[id];
    if (!current) {
      this._changes[id] = val;
    } else {
      if (current.type === 'created' && val.type === 'deleted') {
        delete this._changes[id];
      } else if (current.type === 'modified' && val.type === 'deleted') {
        this._changes[id] = val;
      } else if (current.type === 'deleted' && val.type === 'created') {
        delete this._changes[id];
      }
    }
  }
  get() {
    return Object.values(this._changes);
  }
}

function loadData({ records, nodes, links }) {
  for (const item of nodes) {
    data.nodes[item.relation_ref][item.id] = item.node;
  }
  for (const item of links) {
    data.links[item.relation_ref][item.id] = item.link;
  }
  for (const item of records) {
    _setRecord(item.model, _initRecord(item.model, item.record));
  }
}
