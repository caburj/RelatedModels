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

function createRelation(field1, field2) {
  if (field1.relation_ref !== field2.relation_ref) {
    throw new Error('Provided fields should have the same relation_ref');
  }
  const relation_ref = field1.relation_ref;
  if (field1.type === 'many2many') {
    return {
      type: 'many2many',
      relation_ref,
      models: [field1.related_to, field2.related_to].sort(),
    };
  } else {
    const [single, multi] =
      field1.type === 'one2many'
        ? [field1.related_to, field2.related_to]
        : [field2.related_to, field1.related_to];
    return {
      type: 'many2one',
      relation_ref,
      single,
      multi,
      nodeType: { [single]: 'single', [multi]: 'multi' },
    };
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
  const relationRefFields = {};
  const refs = new Set([]);
  for (const model in modelDefs) {
    const fields = modelDefs[model];
    for (const fieldName in fields) {
      const field = fields[fieldName];
      if (!RELATION_TYPES.has(field.type)) continue;
      refs.add(field.relation_ref);
      if (field.relation_ref in relationRefFields) {
        relationRefFields[field.relation_ref].push(field);
      } else {
        relationRefFields[field.relation_ref] = [field];
      }
    }
  }
  const relations = {};
  for (const ref in relationRefFields) {
    relations[ref] = createRelation(...relationRefFields[ref]);
  }
  for (const model in modelDefs) {
    const fields = modelDefs[model];
    for (const fieldName in fields) {
      const field = fields[fieldName];
      if (!RELATION_TYPES.has(field.type)) continue;
      field.relation = relations[field.relation_ref];
    }
  }
  return [modelDefs, [...refs], relations];
}

export default function createRelatedModels(
  modelDefs,
  classes,
  onChange = () => {},
  initialData = undefined
) {
  const [processedModelDefs, refs, relations] = processModelDefs(modelDefs);
  const data = {
    modelDefs: processedModelDefs,
    records: {},
    nodes: {},
    links: {},
    relations,
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

  // TODO: This might be outdated already.
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
  function _createNode(relation, record) {
    const ref = relation.relation_ref;
    const { model, nodeKey: key } = record.__meta__;
    const nodes = data.nodes[ref];
    if (relation.type === 'many2one') {
      const nodeType = relation.nodeType[model];
      if (nodeType === 'single') {
        nodes[key] = { value: undefined, type: 'single' };
      } else if (nodeType === 'multi') {
        nodes[key] = { value: new Set([]), type: 'multi' };
      }
    } else {
      nodes[key] = { value: new Set([]), type: 'multi' };
    }
    data.changes.add(makeChangeId(ref, key), {
      type: 'created',
      which: 'node',
      info: { relation_ref: ref, id: key, node: nodes[key] },
    });
  }
  function _getNode(relation, record) {
    const key = record.__meta__.nodeKey;
    const ref = relation.relation_ref;
    const nodes = data.nodes[ref];
    return nodes[key];
  }
  function _addLinkOnNode(relation, record, linkId) {
    const key = record.__meta__.nodeKey;
    const ref = relation.relation_ref;
    const node = _getNode(relation, record);
    if (node.type === 'single') {
      node.value = linkId;
    } else if (node.type === 'multi') {
      node.value.add(linkId);
    }
    data.changes.add(makeChangeId(ref, key), {
      type: 'modified',
      which: 'node',
      info: { relation_ref: ref, id: key, node },
    });
  }
  function _deleteLinkOnNode(relation, record, linkId) {
    const key = record.__meta__.nodeKey;
    const ref = relation.relation_ref;
    const node = _getNode(relation, record);
    if (node.type === 'single' && node.value === linkId) {
      node.value = undefined;
    } else if (node.type === 'multi') {
      node.value.delete(linkId);
    }
    data.changes.add(makeChangeId(ref, key), {
      type: 'modified',
      which: 'node',
      info: { relation_ref: ref, id: key, node },
    });
  }
  function _deleteNode(relation, record) {
    const key = record.__meta__.nodeKey;
    const ref = relation.relation_ref;
    const nodes = data.nodes[ref];
    const deleted = nodes[key];
    delete nodes[key];
    data.changes.add(makeChangeId(ref, key), {
      type: 'deleted',
      which: 'node',
      info: { relation_ref: ref, id: key, node: deleted },
    });
  }
  function _getLinkId(record1, record2) {
    const model1 = record1.__meta__.model;
    const id1 = record1.id;
    const model2 = record2.__meta__.model;
    const id2 = record2.id;
    return model1.localeCompare(model2) < 0
      ? `${model1}${__}${id1}${__}${model2}${__}${id2}`
      : `${model2}${__}${id2}${__}${model1}${__}${id1}`;
  }
  function _createLink(relation, record1, record2) {
    const ref = relation.relation_ref;
    const link = {
      id: _getLinkId(record1, record2),
      [record1.__meta__.model]: record1.id,
      [record2.__meta__.model]: record2.id,
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
  function _getLink(relation, id) {
    const ref = relation.relation_ref;
    const links = data.links[ref];
    return links[id];
  }
  function _deleteLink(relation, id) {
    const ref = relation.relation_ref;
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
            const node = _getNode(field.relation, record);
            return [...(node?.value || [])].map((linkId) => {
              const link = _getLink(field.relation, linkId);
              return models[field.related_to].read(link[field.related_to]);
            });
          },
        });
      } else if (field.type === 'many2one') {
        Object.defineProperty(record, name, {
          get: () => {
            const node = _getNode(field.relation, record);
            if (!node?.value) return undefined;
            const link = _getLink(field.relation, node.value);
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
  function _connect(relation, record1, record2) {
    if (relation.type === 'many2one') {
      const singleRecord = {
        [record1.__meta__.model]: record1,
        [record2.__meta__.model]: record2,
      }[relation.single];
      const singleNode = _getNode(relation, singleRecord);
      if (singleNode.value) {
        const connectedLink = _getLink(relation, singleNode.value);
        const connectedMultiRecord = models[relation.multi].read(
          connectedLink[relation.multi]
        );
        _disconnect(relation, singleRecord, connectedMultiRecord);
      }
    }
    const link = _createLink(relation, record1, record2);
    _addLinkOnNode(relation, record1, link.id);
    _addLinkOnNode(relation, record2, link.id);
  }
  function _disconnect(relation, record1, record2) {
    const linkId2remove = _getLinkId(record1, record2);
    _deleteLinkOnNode(relation, record1, linkId2remove);
    _deleteLinkOnNode(relation, record2, linkId2remove);
    _deleteLink(relation, linkId2remove);
  }
  function _getLinkedRecords(relation, record1, model2) {
    const m1Node = _getNode(relation, record1);
    const linkIds = m1Node.type === 'single' ? [m1Node.value] : m1Node.value;
    return [...linkIds].map((linkId) => {
      const link = _getLink(relation, linkId);
      return models[model2].read(link[model2]);
    });
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
    _setRecord(model, record);
    const fields = _getFields(model);
    for (const name in fields) {
      const field = fields[name];
      if (field.required && !(name in vals)) {
        throw new Error(
          `'${name}' field is required when creating '${model}' record.`
        );
      }
      if (RELATION_TYPES.has(field.type)) {
        const related_to = field.related_to;
        const relation = field.relation;
        _createNode(relation, record);
        if (!vals[name]) continue;
        if (X2MANY_TYPES.has(field.type)) {
          for (const [command, ...args] of vals[name]) {
            if (command === 'create') {
              const newRecords = args.map((_vals) =>
                _create(related_to, _vals)
              );
              for (const record2 of newRecords) {
                _connect(relation, record, record2);
              }
            } else if (command === 'link') {
              const existingIds = args.filter((id) => _exist(related_to, id));
              for (const record2 of models[related_to].readMany(existingIds)) {
                _connect(relation, record, record2);
              }
            }
          }
        } else if (field.type === 'many2one') {
          if (typeof vals[name] === 'object') {
            const newRecord = _create(related_to, vals[name]);
            _connect(relation, record, newRecord);
          } else {
            if (_exist(related_to, vals[name])) {
              const existing = models[related_to].read(vals[name]);
              _connect(relation, record, existing);
            }
          }
        }
      } else {
        record[name] = vals[name];
      }
    }
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
      const related_to = field.related_to;
      const relation = field.relation;
      if (X2MANY_TYPES.has(field.type)) {
        for (const command of vals[name]) {
          const [type, ...items] = command;
          if (type === 'unlink') {
            for (const record2 of models[related_to].readMany(items)) {
              _disconnect(relation, record, record2);
            }
          } else if (type === 'clear') {
            const linkedRecs = _getLinkedRecords(relation, record, related_to);
            for (const record2 of linkedRecs) {
              _disconnect(relation, record, record2);
            }
          } else if (type === 'create') {
            const newRecords = items.map((_vals) => _create(related_to, _vals));
            for (const record2 of newRecords) {
              _connect(relation, record, record2);
            }
          } else if (type === 'link') {
            const existingIds = items.filter((id) => _exist(related_to, id));
            const existingRecords = models[related_to].readMany(existingIds);
            for (const record2 of existingRecords) {
              _connect(relation, record, record2);
            }
          }
        }
      } else if (field.type === 'many2one') {
        if (vals[name]) {
          if (typeof vals[name] === 'object') {
            const newRecord = _create(related_to, vals[name]);
            _connect(relation, record, newRecord);
          } else {
            if (_exist(related_to, vals[name])) {
              const existing = models[related_to].read(vals[name]);
              _connect(relation, record, existing);
            }
          }
        } else {
          const linkedRecs = _getLinkedRecords(relation, record, related_to);
          for (const record2 of linkedRecs) {
            _disconnect(relation, record, record2);
          }
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
    const record = models[model].read(id);
    const fields = _getFields(model);
    for (const name in fields) {
      const field = fields[name];
      const related_to = field.related_to;
      const relation = field.relation;
      if (RELATION_TYPES.has(field.type)) {
        const linkedRecs = _getLinkedRecords(relation, record, related_to);
        for (const record2 of linkedRecs) {
          _disconnect(relation, record, record2);
        }
        _deleteNode(relation, record);
      }
    }
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
  constructor(model, env, id) {
    this.__meta__ = {
      model,
      env,
      nodeKey: `${model}${__}${id}`,
    };
    this.id = id;
  }
  get env() {
    return this.__meta__.env;
  }
  create(vals) {
    return this.env[this.__meta__.model].create(vals);
  }
  createMany(valsList) {
    return this.env[this.__meta__.model].createMany(valsList);
  }
  update(id, vals) {
    return this.env[this.__meta__.model].update(id, vals);
  }
  delete(id) {
    return this.env[this.__meta__.model].delete(id);
  }
  deleteMany(ids) {
    return this.env[this.__meta__.model].deleteMany(ids);
  }
  read(id) {
    return this.env[this.__meta__.model].read(id);
  }
  readAll() {
    return this.env[this.__meta__.model].readAll();
  }
  readMany(ids) {
    return this.env[this.__meta__.model].readMany(ids);
  }
  find(predicate) {
    return this.env[this.__meta__.model].find(predicate);
  }
  findAll(predicate) {
    return this.env[this.__meta__.model].findAll(predicate);
  }
}
