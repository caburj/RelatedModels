const ID_CONTAINER = {};

function uuid(model) {
  if (!(model in ID_CONTAINER)) {
    ID_CONTAINER[model] = 1;
  }
  return `${model}_${ID_CONTAINER[model]++}`;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const RELATION_TYPES = new Set(["many2many", "many2one", "one2many"]);
const X2MANY_TYPES = new Set(["many2many", "one2many"]);
const DELIMITER = "/";

function getInverseRelationType(type) {
  return {
    many2many: "many2many",
    many2one: "one2many",
    one2many: "many2one",
  }[type];
}

function createRelation(field1, field2) {
  if (field1.relation_ref !== field2.relation_ref) {
    throw new Error("Provided fields should have the same relation_ref");
  }
  const relation_ref = field1.relation_ref;
  const _inverseFields = new Map();
  _inverseFields.set(field1, field2);
  _inverseFields.set(field2, field1);
  const getInverse = (field) => _inverseFields.get(field);
  const first = field1.name.localeCompare(field2.name) < 0 ? field1 : field2;
  if (field1.type === "many2many") {
    return {
      type: "many2many",
      relation_ref,
      getInverse,
      first,
    };
  } else {
    const [single, multi] =
      field1.type === "many2one" ? [field1, field2] : [field2, field1];
    const _nodeType = new Map();
    _nodeType.set(single, "single");
    _nodeType.set(multi, "multi");
    const getNodeType = (field) => _nodeType.get(field);
    return {
      type: "many2one",
      relation_ref,
      first,
      single,
      multi,
      getNodeType,
      getInverse,
    };
  }
}

function processModelDefs(modelDefs) {
  modelDefs = clone(modelDefs);
  for (const model in modelDefs) {
    const fields = modelDefs[model];
    for (const fieldName in fields) {
      const field = fields[fieldName];
      field.name = fieldName;
      field._id = `${model}${DELIMITER}${field.name}`;
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
        dummyField.type === "many2one"
          ? `dummy_${model}_id`
          : `dummy_${model}_ids`;
      dummyField.name = dummyFieldName;
      relModelFields[dummyFieldName] = dummyField;
    }
  }
  const relationRefFields = {};
  for (const model in modelDefs) {
    const fields = modelDefs[model];
    for (const fieldName in fields) {
      const field = fields[fieldName];
      if (!RELATION_TYPES.has(field.type)) continue;
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
  return [modelDefs, relations];
}

export function createRelatedModels(modelDefs, classes, reactive = (x) => x) {
  const [processedModelDefs, relations] = processModelDefs(modelDefs);
  const data = {
    modelDefs: processedModelDefs,
    records: reactive({}),
    relations,
  };
  for (const model in data.modelDefs) {
    data.records[model] = reactive({});
  }
  function _getFields(model) {
    return data.modelDefs[model];
  }
  function _initRecord(model, record) {
    const fields = _getFields(model);
    for (const name in fields) {
      const field = fields[name];
      if (X2MANY_TYPES.has(field.type)) {
        record[name] = new Set([]);
      } else if (field.type === "many2one") {
        record[name] = undefined;
      }
    }
    data.records[model][record.id] = record;
    return reactive(record);
  }
  function _connect(field, ownerRecord, recordToConnect) {
    const relation = field.relation;
    const inverseField = relation.getInverse(field);
    if (field.type === "many2one") {
      // Disconnect the old value of the field from the ownerRecord if it exists
      const prevConnectedRecord = ownerRecord[field.name];
      if (prevConnectedRecord && inverseField) {
        prevConnectedRecord[inverseField.name].delete(ownerRecord);
      }
      ownerRecord[field.name] = recordToConnect;
      if (inverseField) {
        recordToConnect[inverseField.name].add(ownerRecord);
      }
    } else if (field.type === "one2many") {
      // Disconnect the old value of the field from the recordToConnect if it exists
      if (inverseField) {
        const prevConnectedRecord = recordToConnect[inverseField.name];
        if (prevConnectedRecord) {
          prevConnectedRecord[field.name].delete(recordToConnect);
        }
      }
      ownerRecord[field.name].add(recordToConnect);
      if (inverseField) {
        recordToConnect[inverseField.name] = ownerRecord;
      }
    } else if (field.type === "many2many") {
      ownerRecord[field.name].add(recordToConnect);
      if (inverseField) {
        recordToConnect[inverseField.name].add(ownerRecord);
      }
    }
  }
  function _disconnect(field, ownerRecord, recordToDisconnect) {
    if (!recordToDisconnect) return;
    const relation = field.relation;
    const inverseField = relation.getInverse(field);
    if (field.type === "many2one") {
      const prevConnectedRecord = ownerRecord[field.name];
      if (prevConnectedRecord === recordToDisconnect) {
        ownerRecord[field.name] = undefined;
        recordToDisconnect[inverseField.name].delete(ownerRecord);
      }
    } else if (field.type === "one2many") {
      ownerRecord[field.name].delete(recordToDisconnect);
      if (inverseField) {
        const prevConnectedRecord = recordToDisconnect[inverseField.name];
        if (prevConnectedRecord === ownerRecord) {
          recordToDisconnect[inverseField.name] = undefined;
        }
      }
    } else if (field.type === "many2many") {
      ownerRecord[field.name].delete(recordToDisconnect);
      if (inverseField) {
        recordToDisconnect[inverseField.name].delete(ownerRecord);
      }
    }
  }
  function _exist(model, id) {
    return id in data.records[model];
  }
  function _create(model, vals) {
    if (!("id" in vals)) {
      vals["id"] = uuid(model);
    }
    const id = vals["id"];
    const record = _initRecord(
      model,
      reactive(new classes[model](model, models, id))
    );
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
        if (!vals[name]) continue;
        if (X2MANY_TYPES.has(field.type)) {
          for (const [command, ...args] of vals[name]) {
            if (command === "create") {
              const newRecords = args.map((_vals) =>
                _create(related_to, _vals)
              );
              for (const record2 of newRecords) {
                _connect(field, record, record2);
              }
            } else if (command === "link") {
              const existingIds = args.filter((id) => _exist(related_to, id));
              for (const record2 of models[related_to].readMany(existingIds)) {
                _connect(field, record, record2);
              }
            }
          }
        } else if (field.type === "many2one") {
          if (typeof vals[name] === "object") {
            const newRecord = _create(related_to, vals[name]);
            _connect(field, record, newRecord);
          } else {
            if (_exist(related_to, vals[name])) {
              const existing = models[related_to].read(vals[name]);
              _connect(field, record, existing);
            }
          }
        }
      } else {
        record[name] = vals[name];
      }
    }
    return record;
  }
  function _update(model, id, vals) {
    const fields = _getFields(model);
    const record = models[model].read(id);
    for (const name in vals) {
      if (!(name in fields)) continue;
      const field = fields[name];
      const related_to = field.related_to;
      if (X2MANY_TYPES.has(field.type)) {
        for (const command of vals[name]) {
          const [type, ...items] = command;
          if (type === "unlink") {
            for (const record2 of models[related_to].readMany(items)) {
              _disconnect(field, record, record2);
            }
          } else if (type === "clear") {
            const linkedRecs = record[name];
            for (const record2 of [...linkedRecs]) {
              _disconnect(field, record, record2);
            }
          } else if (type === "create") {
            const newRecords = items.map((_vals) => _create(related_to, _vals));
            for (const record2 of newRecords) {
              _connect(field, record, record2);
            }
          } else if (type === "link") {
            const existingIds = items.filter((id) => _exist(related_to, id));
            const existingRecords = models[related_to].readMany(existingIds);
            for (const record2 of existingRecords) {
              _connect(field, record, record2);
            }
          }
        }
      } else if (field.type === "many2one") {
        if (vals[name]) {
          if (typeof vals[name] === "object") {
            const newRecord = _create(related_to, vals[name]);
            _connect(field, record, newRecord);
          } else {
            if (_exist(related_to, vals[name])) {
              const existing = models[related_to].read(vals[name]);
              _connect(field, record, existing);
            }
          }
        } else {
          const linkedRec = record[name];
          _disconnect(field, record, linkedRec);
        }
      } else {
        record[name] = vals[name];
      }
    }
  }
  function _delete(model, id) {
    const record = models[model].read(id);
    const fields = _getFields(model);
    for (const name in fields) {
      const field = fields[name];
      if (X2MANY_TYPES.has(field.type)) {
        for (const record2 of [...record[name]]) {
          _disconnect(field, record, record2);
        }
      } else if (field.type === "many2one") {
        _disconnect(field, record, record[name]);
      }
    }
    delete data.records[model][id];
  }

  class CRUD {
    constructor(model) {
      this.model = model;
    }
    create(vals) {
      return _create(this.model, vals);
    }
    createMany(valsList) {
      const result = [];
      for (const vals of valsList) {
        result.push(_create(this.model, vals));
      }
      return result;
    }
    update(id, vals) {
      return _update(this.model, id, vals);
    }
    delete(id) {
      return _delete(this.model, id);
    }
    deleteMany(ids) {
      const result = [];
      for (const id of ids) {
        result.push(_delete(this.model, id));
      }
      return result;
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
    this.__meta__ = { model, env };
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
