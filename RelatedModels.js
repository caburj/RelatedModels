import * as R from 'ramda';
import { v4 as uuid } from 'uuid';

const RELATION_TYPES = new Set(['many2many', 'many2one', 'one2many']);
const X2MANY_TYPES = new Set(['many2many', 'one2many']);
const __ = '/';

function getInverseRelationType(type) {
  return {
    many2many: 'many2many',
    many2one: 'one2many',
    one2many: 'many2one',
  }[type];
}

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

function processModelDefs(modelDefs) {
  modelDefs = R.clone(modelDefs);
  for (const model in modelDefs) {
    const fields = modelDefs[model];
    for (const fieldName in fields) {
      const field = fields[fieldName];
      if (!RELATION_TYPES.has(field.type)) continue;
      const relModelFields = modelDefs[field.related_to];
      const relatedField = Object.keys(relModelFields).find((fieldName) => {
        const _field = relModelFields[fieldName];
        if (!_field.related_to) return false;
        return (
          _field.related_to === model &&
          _field.relation_ref === field.relation_ref
        );
      });
      if (relatedField) continue;
      const dummyField = {
        type: getInverseRelationType(field.type),
        related_to: model,
        relation_ref: field.relation_ref,
        dummy: true,
      };
      const dummyFieldName =
        dummyField.type === 'many2one'
          ? `dummy_${model}_id`
          : `dummy_${model}_ids`;
      relModelFields[dummyFieldName] = dummyField;
    }
  }
  const refs = new Set([]);
  for (const model in modelDefs) {
    const fields = modelDefs[model];
    for (const fieldName in fields) {
      const field = fields[fieldName];
      if (!RELATION_TYPES.has(field.type)) continue;
      refs.add(field.relation_ref);
    }
  }
  return [modelDefs, [...refs]];
}

export default function createRelatedModels(
  modelDefs,
  classes,
  onChange = () => {},
  initialData = undefined
) {
  const [processedModelDefs, refs] = processModelDefs(modelDefs);
  const data = {
    modelDefs: processedModelDefs,
    records: {},
    nodes: {},
    links: {},
    changes: new Changes(),
  };
  for (const model in data.modelDefs) {
    data.records[model] = {};
  }
  for (const ref of refs) {
    data.nodes[ref] = {};
    data.links[ref] = {};
  }
  if (initialData) {
    loadData(initialData);
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
  function _getFields(model) {
    return data.modelDefs[model];
  }
  function _getNodeKey(model, id) {
    return `${model}${__}${id}`;
  }
  function _createNode(ref, key) {
    const nodes = data.nodes[ref];
    nodes[key] = new Set([]);
    data.changes.add(makeChangeId(ref, key), {
      type: 'created',
      which: 'node',
      info: { relation_ref: ref, id: key, node: nodes[key] },
    });
  }
  function _getNode(ref, key) {
    const nodes = data.nodes[ref];
    return nodes[key];
  }
  function _addLinkOnNode(ref, key, linkId) {
    const node = _getNode(ref, key);
    node.add(linkId);
    data.changes.add(makeChangeId(ref, key), {
      type: 'modified',
      which: 'node',
      info: { relation_ref: ref, id: key, node },
    });
  }
  function _deleteLinkOnNode(ref, key, linkId) {
    const node = _getNode(ref, key);
    node.delete(linkId);
    data.changes.add(makeChangeId(ref, key), {
      type: 'modified',
      which: 'node',
      info: { relation_ref: ref, id: key, node },
    });
  }
  function _clearNode(ref, key) {
    const node = _getNode(ref, key);
    node.clear();
    data.changes.add(makeChangeId(ref, key), {
      type: 'modified',
      which: 'node',
      info: { relation_ref: ref, id: key, node },
    });
  }
  function _deleteNode(ref, key) {
    const nodes = data.nodes[ref];
    const deleted = nodes[key];
    delete nodes[key];
    data.changes.add(makeChangeId(ref, key), {
      type: 'deleted',
      which: 'node',
      info: { relation_ref: ref, id: key, node: deleted },
    });
  }
  function _getLinkId(model1, id1, model2, id2) {
    return model1.localeCompare(model2) < 0
      ? `${model1}${__}${id1}${__}${model2}${__}${id2}`
      : `${model2}${__}${id2}${__}${model1}${__}${id1}`;
  }
  function _createLink(ref, model1, id1, model2, id2) {
    const link = {
      id: _getLinkId(model1, id1, model2, id2),
      [model1]: id1,
      [model2]: id2,
    };
    const links = data.links[ref];
    links[link.id] = link;
    data.changes.add(makeChangeId(ref, link.id), {
      type: 'created',
      which: 'link',
      info: { relation_ref: ref, id: link.id, link },
    });
    return link;
  }
  function _getLink(ref, id) {
    const links = data.links[ref];
    return links[id];
  }
  function _deleteLink(ref, id) {
    const links = data.links[ref];
    const deleted = links[id];
    delete links[id];
    data.changes.add(makeChangeId(ref, id), {
      type: 'deleted',
      which: 'link',
      info: { relation_ref: ref, id, link: deleted },
    });
  }
  function _initRecord(model, record) {
    const fields = _getFields(model);
    for (const name in fields) {
      const field = fields[name];
      if (field.dummy) continue;
      if (X2MANY_TYPES.has(field.type)) {
        Object.defineProperty(record, name, {
          get: () => {
            const nodeKey = _getNodeKey(model, record.id);
            const node = _getNode(field.relation_ref, nodeKey);
            return [...(node || [])].map((linkId) => {
              const link = _getLink(field.relation_ref, linkId);
              return models[field.related_to].read(link[field.related_to]);
            });
          },
        });
      } else if (field.type === 'many2one') {
        Object.defineProperty(record, name, {
          get: () => {
            const nodeKey = _getNodeKey(model, record.id);
            const linkIds = [...(_getNode(field.relation_ref, nodeKey) || [])];
            const linkId = linkIds[0];
            if (!linkId) return undefined;
            const link = _getLink(field.relation_ref, linkId);
            return models[field.related_to].read(link[field.related_to]);
          },
        });
      }
    }
    return record;
  }
  function _setRecord(model, record) {
    data.records[model][record.id] = record;
  }
  function _deleteRecord(model, id) {
    delete data.records[model][id];
  }
  function _connect(ref, model1, id1, model2, id2s) {
    const m1Key = _getNodeKey(model1, id1);
    for (const id2 of id2s) {
      const m2Key = _getNodeKey(model2, id2);
      const link = _createLink(ref, model1, id1, model2, id2);
      _addLinkOnNode(ref, m1Key, link.id);
      _addLinkOnNode(ref, m2Key, link.id);
    }
  }
  function _disconnect(ref, model1, id1, model2, id2s) {
    const m1Key = _getNodeKey(model1, id1);
    for (const id2 of id2s) {
      const m2Key = _getNodeKey(model2, id2);
      const linkId2remove = _getLinkId(model1, id1, model2, id2);
      _deleteLinkOnNode(ref, m1Key, linkId2remove);
      _deleteLinkOnNode(ref, m2Key, linkId2remove);
      _deleteLink(ref, linkId2remove);
    }
  }
  function _clearConnections(ref, model1, id1, model2, deleteNode) {
    const m1Key = _getNodeKey(model1, id1);
    const m1Node = _getNode(ref, m1Key);
    for (const linkId of m1Node) {
      const link = _getLink(ref, linkId);
      const m2Key = _getNodeKey(model2, link[model2]);
      _deleteLinkOnNode(ref, m2Key, link.id);
      _deleteLink(ref, link.id);
    }
    if (deleteNode) {
      _deleteNode(ref, m1Key);
    } else {
      _clearNode(ref, m1Key);
    }
  }
  function _exist(model, id) {
    return id in data.records[model];
  }
  function _create(model, vals) {
    if (!('id' in vals)) {
      vals['id'] = uuid();
    }
    const id = vals['id'];
    const record = _initRecord(model, new classes[model](model, models, id));
    const fields = _getFields(model);
    for (const name in fields) {
      const field = fields[name];
      if (field.required && !(name in vals)) {
        throw new Error(
          `'${name}' field is required when creating '${model}' record.`
        );
      }
      if (RELATION_TYPES.has(field.type)) {
        const relation_ref = field.relation_ref;
        const related_to = field.related_to;
        _createNode(relation_ref, _getNodeKey(model, id));
        if (!vals[name]) continue;
        if (X2MANY_TYPES.has(field.type)) {
          for (const [command, ...args] of vals[name]) {
            let ids = [];
            if (command === 'create') {
              ids = args.map((_vals) => _create(related_to, _vals).id);
            } else if (command === 'link') {
              ids = args.filter((id) => _exist(related_to, id));
            }
            if (field.type === 'one2many') {
              // Similar to the note in _update.
              for (const _id of ids) {
                _clearConnections(relation_ref, related_to, _id, model, false);
              }
            }
            _connect(relation_ref, model, id, related_to, ids);
          }
        } else if (field.type === 'many2one') {
          let ids = [];
          if (typeof vals[name] === 'object') {
            ids = [_create(related_to, vals[name]).id];
          } else {
            ids = [vals[name]].filter((id) => _exist(related_to, id));
          }
          _connect(relation_ref, model, id, related_to, ids);
        }
      } else {
        record[name] = vals[name];
      }
    }
    _setRecord(model, record);
    data.changes.add(makeChangeId(model, id), {
      type: 'created',
      which: 'record',
      info: { model, id, record },
    });
    return record;
  }
  function _update(model, id, vals) {
    const fields = _getFields(model);
    const record = models[model].read(id);
    for (const name in vals) {
      if (!(name in fields)) continue;
      const field = fields[name];
      const relation_ref = field.relation_ref;
      const related_to = field.related_to;
      if (X2MANY_TYPES.has(field.type)) {
        for (const command of vals[name]) {
          const [type, ...items] = command;
          if (type === 'unlink') {
            _disconnect(relation_ref, model, id, related_to, items);
          } else if (type === 'clear') {
            _clearConnections(relation_ref, model, id, related_to, false);
          } else {
            let ids = [];
            if (type === 'create') {
              ids = items.map((_vals) => _create(related_to, _vals).id);
            } else if (type === 'link') {
              ids = items.filter((id) => _exist(related_to, id));
            }
            if (field.type === 'one2many') {
              // NOTE: this is unexpected.
              // See test: "properly connects records during updates".
              // Perhaps there are other special cases for one2many/many2one
              // relation.
              for (const _id of ids) {
                _clearConnections(relation_ref, related_to, _id, model, false);
              }
            }
            _connect(relation_ref, model, id, related_to, ids);
          }
        }
      } else if (field.type === 'many2one') {
        _clearConnections(relation_ref, model, id, related_to, false);
        if (vals[name]) {
          let ids = [];
          if (typeof vals[name] === 'object') {
            ids = [_create(related_to, vals[name]).id];
          } else {
            ids = [vals[name]].filter((id) => _exist(related_to, id));
          }
          _connect(relation_ref, model, id, related_to, ids);
        }
      } else {
        record[name] = vals[name];
      }
    }
    data.changes.add(makeChangeId(model, id), {
      type: 'modified',
      which: 'record',
      info: { model, id, record },
    });
  }
  function _delete(model, id) {
    const fields = _getFields(model);
    for (const name in fields) {
      const field = fields[name];
      const relation_ref = field.relation_ref;
      const related_to = field.related_to;
      if (RELATION_TYPES.has(field.type)) {
        _clearConnections(relation_ref, model, id, related_to, true);
      }
    }
    const record = models[model].read(id);
    _deleteRecord(model, id);
    data.changes.add(makeChangeId(model, id), {
      type: 'deleted',
      which: 'record',
      info: { model, id, record },
    });
  }

  class CRUD {
    constructor(model) {
      this.model = model;
    }
    create(vals) {
      try {
        const result = _create(this.model, vals);
        onChange(data.changes.get());
        return result;
      } finally {
        data.changes.restart();
      }
    }
    createMany(valsList) {
      try {
        const result = [];
        for (const vals of valsList) {
          result.push(_create(this.model, vals));
        }
        onChange(data.changes.get());
        return result;
      } finally {
        data.changes.restart();
      }
    }
    update(id, vals) {
      try {
        const result = _update(this.model, id, vals);
        onChange(data.changes.get());
        return result;
      } finally {
        data.changes.restart();
      }
    }
    delete(id) {
      try {
        const result = _delete(this.model, id);
        onChange(data.changes.get());
        return result;
      } finally {
        data.changes.restart();
      }
    }
    deleteMany(ids) {
      try {
        const result = [];
        for (const id of ids) {
          result.push(_delete(this.model, id));
        }
        onChange(data.changes.get());
        return result;
      } finally {
        data.changes.restart();
      }
    }
    read(id) {
      if (!(this.model in data.records)) return;
      return data.records[this.model][id];
    }
    readAll() {
      return Object.values(data.records[this.model]);
    }
    readMany(ids) {
      if (!(this.model in data.records)) return [];
      return ids.map((id) => data.records[this.model][id]);
    }
    find(predicate) {
      return Object.values(data.records[this.model]).find(predicate);
    }
    findAll(predicate) {
      return Object.values(data.records[this.model]).filter(predicate);
    }
  }
  const models = {};
  for (const model in modelDefs) {
    models[model] = new CRUD(model);
  }
  return models;
}

export class BaseModel {
  constructor(name, env, id) {
    this.name = name;
    this.env = env;
    this.id = id;
  }
  create(vals) {
    return this.env[this.name].create(vals);
  }
  createMany(valsList) {
    return this.env[this.name].createMany(valsList);
  }
  update(id, vals) {
    return this.env[this.name].update(id, vals);
  }
  delete(id) {
    return this.env[this.name].delete(id);
  }
  deleteMany(ids) {
    return this.env[this.name].deleteMany(ids);
  }
  read(id) {
    return this.env[this.name].read(id);
  }
  readAll() {
    return this.env[this.name].readAll();
  }
  readMany(ids) {
    return this.env[this.name].readMany(ids);
  }
  find(predicate) {
    return this.env[this.name].find(predicate);
  }
  findAll(predicate) {
    return this.env[this.name].findAll(predicate);
  }
}
