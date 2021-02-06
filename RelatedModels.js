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

export default class RelatedModels {
  constructor(modelDefs, onChange = (changes) => {}, initialData) {
    const [processedModelDefs, refs] = this._processModelDefs(modelDefs);
    this._modelDefs = processedModelDefs;
    this._records = {};
    this._nodes = {};
    this._links = {};
    for (const model in this._modelDefs) {
      this._records[model] = {};
    }
    for (const ref of refs) {
      this._nodes[ref] = {};
      this._links[ref] = {};
    }
    this._changes = new Changes();
    this._onChange = onChange;
    if (initialData) {
      this._loadData(initialData);
    }
  }
  _processModelDefs(modelDefs) {
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
  _loadData({ records, nodes, links }) {
    for (const item of nodes) {
      this._nodes[item.relation_ref][item.id] = item.node;
    }
    for (const item of links) {
      this._links[item.relation_ref][item.id] = item.link;
    }
    for (const item of records) {
      this._setRecord(item.model, this._initRecord(item.model, item.record));
    }
  }
  _getFields(model) {
    return this._modelDefs[model];
  }
  _getNodeKey(model, id) {
    return `${model}${__}${id}`;
  }
  _createNode(ref, key) {
    const nodes = this._nodes[ref];
    nodes[key] = new Set([]);
    this._changes.add(makeChangeId(ref, key), {
      type: 'created',
      which: 'node',
      info: { relation_ref: ref, id: key, node: nodes[key] },
    });
  }
  _getNode(ref, key) {
    const nodes = this._nodes[ref];
    return nodes[key];
  }
  _addLinkOnNode(ref, key, linkId) {
    const node = this._getNode(ref, key);
    node.add(linkId);
    this._changes.add(makeChangeId(ref, key), {
      type: 'modified',
      which: 'node',
      info: { relation_ref: ref, id: key, node },
    });
  }
  _deleteLinkOnNode(ref, key, linkId) {
    const node = this._getNode(ref, key);
    node.delete(linkId);
    this._changes.add(makeChangeId(ref, key), {
      type: 'modified',
      which: 'node',
      info: { relation_ref: ref, id: key, node },
    });
  }
  _clearNode(ref, key) {
    const node = this._getNode(ref, key);
    node.clear();
    this._changes.add(makeChangeId(ref, key), {
      type: 'modified',
      which: 'node',
      info: { relation_ref: ref, id: key, node },
    });
  }
  _deleteNode(ref, key) {
    const nodes = this._nodes[ref];
    const deleted = nodes[key];
    delete nodes[key];
    this._changes.add(makeChangeId(ref, key), {
      type: 'deleted',
      which: 'node',
      info: { relation_ref: ref, id: key, node: deleted },
    });
  }
  _getLinkId(model1, id1, model2, id2) {
    return model1.localeCompare(model2) < 0
      ? `${model1}${__}${id1}${__}${model2}${__}${id2}`
      : `${model2}${__}${id2}${__}${model1}${__}${id1}`;
  }
  _createLink(ref, model1, id1, model2, id2) {
    const link = {
      id: this._getLinkId(model1, id1, model2, id2),
      [model1]: id1,
      [model2]: id2,
    };
    const links = this._links[ref];
    links[link.id] = link;
    this._changes.add(makeChangeId(ref, link.id), {
      type: 'created',
      which: 'link',
      info: { relation_ref: ref, id: link.id, link },
    });
    return link;
  }
  _getLink(ref, id) {
    const links = this._links[ref];
    return links[id];
  }
  _deleteLink(ref, id) {
    const links = this._links[ref];
    const deleted = links[id];
    delete links[id];
    this._changes.add(makeChangeId(ref, id), {
      type: 'deleted',
      which: 'link',
      info: { relation_ref: ref, id, link: deleted },
    });
  }
  _initRecord(model, record) {
    const fields = this._getFields(model);
    for (const name in fields) {
      const field = fields[name];
      if (field.dummy) continue;
      if (X2MANY_TYPES.has(field.type)) {
        Object.defineProperty(record, name, {
          get: () => {
            const nodeKey = this._getNodeKey(model, record.id);
            const node = this._getNode(field.relation_ref, nodeKey);
            return [...(node || [])].map((linkId) => {
              const link = this._getLink(field.relation_ref, linkId);
              return this.read(field.related_to, link[field.related_to]);
            });
          },
        });
      } else if (field.type === 'many2one') {
        Object.defineProperty(record, name, {
          get: () => {
            const nodeKey = this._getNodeKey(model, record.id);
            const linkIds = [
              ...(this._getNode(field.relation_ref, nodeKey) || []),
            ];
            const linkId = linkIds[0];
            if (!linkId) return undefined;
            const link = this._getLink(field.relation_ref, linkId);
            return this.read(field.related_to, link[field.related_to]);
          },
        });
      }
    }
    return record;
  }
  _setRecord(model, record) {
    this._records[model][record.id] = record;
  }
  _deleteRecord(model, id) {
    delete this._records[model][id];
  }
  _connect(ref, model1, id1, model2, id2s) {
    const m1Key = this._getNodeKey(model1, id1);
    for (const id2 of id2s) {
      const m2Key = this._getNodeKey(model2, id2);
      const link = this._createLink(ref, model1, id1, model2, id2);
      this._addLinkOnNode(ref, m1Key, link.id);
      this._addLinkOnNode(ref, m2Key, link.id);
    }
  }
  _disconnect(ref, model1, id1, model2, id2s) {
    const m1Key = this._getNodeKey(model1, id1);
    for (const id2 of id2s) {
      const m2Key = this._getNodeKey(model2, id2);
      const linkId2remove = this._getLinkId(model1, id1, model2, id2);
      this._deleteLinkOnNode(ref, m1Key, linkId2remove);
      this._deleteLinkOnNode(ref, m2Key, linkId2remove);
      this._deleteLink(ref, linkId2remove);
    }
  }
  _clearConnections(ref, model1, id1, model2, deleteNode) {
    const m1Key = this._getNodeKey(model1, id1);
    const m1Node = this._getNode(ref, m1Key);
    for (const linkId of m1Node) {
      const link = this._getLink(ref, linkId);
      const m2Key = this._getNodeKey(model2, link[model2]);
      this._deleteLinkOnNode(ref, m2Key, link.id);
      this._deleteLink(ref, link.id);
    }
    if (deleteNode) {
      this._deleteNode(ref, m1Key);
    } else {
      this._clearNode(ref, m1Key);
    }
  }
  _create(model, vals) {
    if (!('id' in vals)) {
      vals['id'] = uuid();
    }
    const id = vals['id'];
    const record = this._initRecord(model, { id });
    const fields = this._getFields(model);
    for (const name in fields) {
      const field = fields[name];
      if (field.required && !(name in vals)) {
        throw new Error(
          `'${name}' field is required when creating '${model}' record.`
        );
      }
      if (RELATION_TYPES.has(field.type)) {
        this._createNode(field.relation_ref, this._getNodeKey(model, id));
        if (!vals[name]) continue;
        const relIds = field.type === 'many2one' ? [vals[name]] : vals[name];
        this._connect(field.relation_ref, model, id, field.related_to, relIds);
      } else {
        record[name] = vals[name];
      }
    }
    this._setRecord(model, record);
    this._changes.add(makeChangeId(model, id), {
      type: 'created',
      which: 'record',
      info: { model, id, record },
    });
    return record;
  }
  _update(model, id, vals) {
    const fields = this._getFields(model);
    const record = this.read(model, id);
    for (const name in vals) {
      if (!(name in fields)) continue;
      const field = fields[name];
      const relation_ref = field.relation_ref;
      const related_to = field.related_to;
      if (X2MANY_TYPES.has(field.type)) {
        for (const command of vals[name]) {
          const [type, ...items] = command;
          if (type === 'link') {
            this._connect(relation_ref, model, id, related_to, items);
          } else if (type === 'unlink') {
            this._disconnect(relation_ref, model, id, related_to, items);
          } else if (type === 'clear') {
            this._clearConnections(relation_ref, model, id, related_to, false);
          }
        }
      } else if (field.type === 'many2one') {
        this._clearConnections(relation_ref, model, id, related_to, false);
        if (vals[name]) {
          this._connect(relation_ref, model, id, related_to, [vals[name]]);
        }
      } else {
        record[name] = vals[name];
      }
    }
    this._changes.add(makeChangeId(model, id), {
      type: 'modified',
      which: 'record',
      info: { model, id, record },
    });
  }
  _delete(model, id) {
    const fields = this._getFields(model);
    for (const name in fields) {
      const field = fields[name];
      const relation_ref = field.relation_ref;
      const related_to = field.related_to;
      if (RELATION_TYPES.has(field.type)) {
        this._clearConnections(relation_ref, model, id, related_to, true);
      }
    }
    const record = this.read(model, id);
    this._deleteRecord(model, id);
    this._changes.add(makeChangeId(model, id), {
      type: 'deleted',
      which: 'record',
      info: { model, id, record },
    });
  }
  create(model, vals) {
    try {
      const result = this._create(model, vals);
      this._onChange(this._changes.get());
      return result;
    } finally {
      this._changes.restart();
    }
  }
  createMany(model, valsList) {
    try {
      const result = [];
      for (const vals of valsList) {
        result.push(this._create(model, vals));
      }
      this._onChange(this._changes.get());
      return result;
    } finally {
      this._changes.restart();
    }
  }
  update(model, id, vals) {
    try {
      const result = this._update(model, id, vals);
      this._onChange(this._changes.get());
      return result;
    } finally {
      this._changes.restart();
    }
  }
  delete(model, id) {
    try {
      const result = this._delete(model, id);
      this._onChange(this._changes.get());
      return result;
    } finally {
      this._changes.restart();
    }
  }
  deleteMany(model, ids) {
    try {
      const result = [];
      for (const id of ids) {
        result.push(this._delete(model, id));
      }
      this._onChange(this._changes.get());
      return result;
    } finally {
      this._changes.restart();
    }
  }
  read(model, id) {
    if (!(model in this._records)) return;
    return this._records[model][id];
  }
  readAll(model) {
    return Object.values(this._records[model]);
  }
  readMany(model, ids) {
    if (!(model in this._records)) return [];
    return ids.map((id) => this._records[model][id]);
  }
  find(model, predicate) {
    return Object.values(this._records[model]).find(predicate);
  }
  findAll(model, predicate) {
    return Object.values(this._records[model]).filter(predicate);
  }
}
