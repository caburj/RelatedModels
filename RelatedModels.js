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

function inverseGetter(field1, field2) {
  if (field1.relation_ref !== field2.relation_ref) {
    throw new Error("Provided fields should have the same relation_ref");
  }
  return (field) => (field === field1 ? field2 : field1);
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
  const relatedFields = {};
  for (const model in modelDefs) {
    const fields = modelDefs[model];
    for (const fieldName in fields) {
      const field = fields[fieldName];
      if (!RELATION_TYPES.has(field.type)) continue;
      if (field.relation_ref in relatedFields) {
        relatedFields[field.relation_ref].push(field);
      } else {
        relatedFields[field.relation_ref] = [field];
      }
    }
  }
  const inverseGetters = {};
  for (const ref in relatedFields) {
    inverseGetters[ref] = inverseGetter(...relatedFields[ref]);
  }
  for (const model in modelDefs) {
    const fields = modelDefs[model];
    for (const fieldName in fields) {
      const field = fields[fieldName];
      if (!RELATION_TYPES.has(field.type)) continue;
      field.inverse = inverseGetters[field.relation_ref](field);
    }
  }
  return modelDefs;
}

export function createRelatedModels(modelDefs, classes, reactive = (x) => x) {
  const processedModelDefs = processModelDefs(modelDefs);
  const records = reactive({});

  for (const model in processedModelDefs) {
    records[model] = reactive({});
  }

  function _getFields(model) {
    return processedModelDefs[model];
  }

  function _connect(field, ownerRecord, recordToConnect) {
    const inverse = field.inverse;

    if (field.type === "many2one") {
      const prevConnectedRecord = ownerRecord[field.name];
      if (prevConnectedRecord === recordToConnect) {
        return;
      }
      recordToConnect[inverse.name].add(ownerRecord);
      if (prevConnectedRecord) {
        prevConnectedRecord[inverse.name].delete(ownerRecord);
      }
      ownerRecord[field.name] = recordToConnect;
    } else if (field.type === "one2many") {
      const prevConnectedRecord = recordToConnect[inverse.name];
      if (prevConnectedRecord === ownerRecord) {
        return;
      }
      recordToConnect[inverse.name] = ownerRecord;
      if (prevConnectedRecord) {
        prevConnectedRecord[field.name].delete(recordToConnect);
      }
      ownerRecord[field.name].add(recordToConnect);
    } else if (field.type === "many2many") {
      ownerRecord[field.name].add(recordToConnect);
      recordToConnect[inverse.name].add(ownerRecord);
    }
  }

  function _disconnect(field, ownerRecord, recordToDisconnect) {
    if (!recordToDisconnect) {
      throw new Error("recordToDisconnect is undefined");
    }
    const inverse = field.inverse;
    if (field.type === "many2one") {
      const prevConnectedRecord = ownerRecord[field.name];
      if (prevConnectedRecord === recordToDisconnect) {
        ownerRecord[field.name] = undefined;
        recordToDisconnect[inverse.name].delete(ownerRecord);
      }
    } else if (field.type === "one2many") {
      ownerRecord[field.name].delete(recordToDisconnect);
      const prevConnectedRecord = recordToDisconnect[inverse.name];
      if (prevConnectedRecord === ownerRecord) {
        recordToDisconnect[inverse.name] = undefined;
      }
    } else if (field.type === "many2many") {
      ownerRecord[field.name].delete(recordToDisconnect);
      recordToDisconnect[inverse.name].delete(ownerRecord);
    }
  }

  function _exist(model, id) {
    return id in records[model];
  }

  function _create(model, vals) {
    if (!("id" in vals)) {
      vals["id"] = uuid(model);
    }

    const Class = classes[model];
    const record = reactive(new Class());
    const id = vals["id"];
    record.id = id;
    records[model][id] = record;

    const fields = _getFields(model);
    for (const name in fields) {
      if (name === "id") {
        continue;
      }

      const field = fields[name];

      if (field.required && !(name in vals)) {
        throw new Error(
          `'${name}' field is required when creating '${model}' record.`
        );
      }

      if (RELATION_TYPES.has(field.type)) {
        if (X2MANY_TYPES.has(field.type)) {
          record[name] = new Set([]);
        } else if (field.type === "many2one") {
          record[name] = undefined;
        }

        const related_to = field.related_to;
        if (!vals[name]) {
          continue;
        }

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
              for (const record2 of readMany(related_to, existingIds)) {
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
              const existing = read(related_to, vals[name]);
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

  function _update(model, record, vals) {
    const fields = _getFields(model);
    for (const name in vals) {
      if (!(name in fields)) continue;
      const field = fields[name];
      const related_to = field.related_to;
      if (X2MANY_TYPES.has(field.type)) {
        for (const command of vals[name]) {
          const [type, ...items] = command;
          if (type === "unlink") {
            for (const record2 of readMany(related_to, items)) {
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
            const existingRecords = readMany(related_to, existingIds);
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
              const existing = read(related_to, vals[name]);
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

  function _delete(model, record) {
    const id = record.id;
    const fields = _getFields(model);
    for (const name in fields) {
      const field = fields[name];
      if (X2MANY_TYPES.has(field.type)) {
        for (const record2 of [...record[name]]) {
          _disconnect(field, record, record2);
        }
      } else if (field.type === "many2one" && record[name]) {
        _disconnect(field, record, record[name]);
      }
    }
    delete records[model][id];
  }

  function read(model, id) {
    if (!(model in records)) return;
    return records[model][id];
  }

  function readMany(model, ids) {
    if (!(model in records)) return [];
    return ids.map((id) => records[model][id]);
  }

  function createCRUD(model) {
    return {
      create(vals) {
        return _create(model, vals);
      },
      createMany(valsList) {
        const result = [];
        for (const vals of valsList) {
          result.push(_create(model, vals));
        }
        return result;
      },
      update(record, vals) {
        return _update(model, record, vals);
      },
      delete(record) {
        return _delete(model, record);
      },
      deleteMany(records) {
        const result = [];
        for (const record of records) {
          result.push(_delete(model, record));
        }
        return result;
      },
      read(id) {
        return read(model, id);
      },
      readAll() {
        return Object.values(records[model]);
      },
      readMany(ids) {
        return readMany(model, ids);
      },
      find(predicate) {
        return Object.values(records[model]).find(predicate);
      },
      findAll(predicate) {
        return Object.values(records[model]).filter(predicate);
      },
    };
  }

  return Object.fromEntries(
    Object.keys(processedModelDefs).map((model) => [model, createCRUD(model)])
  );
}
