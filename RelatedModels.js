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
      if (!RELATION_TYPES.has(field.type)) continue;
      const relModelFields = modelDefs[field.relation];
      const relatedField = Object.keys(relModelFields).find((fieldName) => {
        const _field = relModelFields[fieldName];
        if (!_field.relation) return false;
        return (
          _field.relation === model &&
          _field.relation_ref === field.relation_ref
        );
      });
      if (relatedField) continue;
      const dummyField = {
        type: getInverseRelationType(field.type),
        relation: model,
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

function mapObj(obj, fn) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v], i) => [k, fn(k, v, i)])
  );
}

export function createRelatedModels(
  modelDefs,
  env,
  reactive = (x) => x,
  modelOverrides = (x) => x
) {
  const processedModelDefs = processModelDefs(modelDefs);
  const records = reactive(mapObj(processedModelDefs, () => reactive({})));
  class Base {}

  function getFields(model) {
    return processedModelDefs[model];
  }

  function connect(field, ownerRecord, recordToConnect) {
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

  function disconnect(field, ownerRecord, recordToDisconnect) {
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

  function exists(model, id) {
    return id in records[model];
  }

  function create(model, vals) {
    if (!("id" in vals)) {
      vals["id"] = uuid(model);
    }

    const Model = models[model];
    const record = reactive(new Model(vals));
    const id = vals["id"];
    record.id = id;
    records[model][id] = record;

    const fields = getFields(model);
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

        const relation = field.relation;
        if (!vals[name]) {
          continue;
        }

        if (X2MANY_TYPES.has(field.type)) {
          for (const [command, ...items] of vals[name]) {
            if (command === "create") {
              const newRecords = items.map((_vals) =>
                create(relation, _vals)
              );
              for (const record2 of newRecords) {
                connect(field, record, record2);
              }
            } else if (command === "link") {
              const existingRecords = items.filter((record) =>
                exists(relation, record.id)
              );
              for (const record2 of existingRecords) {
                connect(field, record, record2);
              }
            }
          }
        } else if (field.type === "many2one") {
          const val = vals[name];
          if (val instanceof Base) {
            if (exists(relation, val.id)) {
              connect(field, record, val);
            }
          } else {
            const newRecord = create(relation, val);
            connect(field, record, newRecord);
          }
        }
      } else {
        record[name] = vals[name];
      }
    }
    record.setup(vals);
    return record;
  }

  function update(model, record, vals) {
    const fields = getFields(model);
    for (const name in vals) {
      if (!(name in fields)) continue;
      const field = fields[name];
      const relation = field.relation;
      if (X2MANY_TYPES.has(field.type)) {
        for (const command of vals[name]) {
          const [type, ...items] = command;
          if (type === "unlink") {
            for (const record2 of items) {
              disconnect(field, record, record2);
            }
          } else if (type === "clear") {
            const linkedRecs = record[name];
            for (const record2 of [...linkedRecs]) {
              disconnect(field, record, record2);
            }
          } else if (type === "create") {
            const newRecords = items.map((vals) => create(relation, vals));
            for (const record2 of newRecords) {
              connect(field, record, record2);
            }
          } else if (type === "link") {
            const existingRecords = items.filter((record) =>
              exists(relation, record.id)
            );
            for (const record2 of existingRecords) {
              connect(field, record, record2);
            }
          }
        }
      } else if (field.type === "many2one") {
        if (vals[name]) {
          if (vals[name] instanceof Base) {
            if (exists(relation, vals[name].id)) {
              connect(field, record, vals[name]);
            }
          } else {
            const newRecord = create(relation, vals[name]);
            connect(field, record, newRecord);
          }
        } else {
          const linkedRec = record[name];
          disconnect(field, record, linkedRec);
        }
      } else {
        record[name] = vals[name];
      }
    }
  }

  function delete_(model, record) {
    const id = record.id;
    const fields = getFields(model);
    for (const name in fields) {
      const field = fields[name];
      if (X2MANY_TYPES.has(field.type)) {
        for (const record2 of [...record[name]]) {
          disconnect(field, record, record2);
        }
      } else if (field.type === "many2one" && record[name]) {
        disconnect(field, record, record[name]);
      }
    }
    delete records[model][id];
  }

  function createCRUD(model) {
    return {
      create(vals) {
        return create(model, vals);
      },
      createMany(valsList) {
        const result = [];
        for (const vals of valsList) {
          result.push(create(model, vals));
        }
        return result;
      },
      update(record, vals) {
        return update(model, record, vals);
      },
      delete(record) {
        return delete_(model, record);
      },
      deleteMany(records) {
        const result = [];
        for (const record of records) {
          result.push(delete_(model, record));
        }
        return result;
      },
      read(id) {
        if (!(model in records)) return;
        return records[model][id];
      },
      readAll() {
        return Object.values(records[model]);
      },
      readMany(ids) {
        if (!(model in records)) return [];
        return ids.map((id) => records[model][id]);
      },
      find(predicate) {
        return Object.values(records[model]).find(predicate);
      },
      findAll(predicate) {
        return Object.values(records[model]).filter(predicate);
      },
    };
  }

  /**
   * Return a contructor that extends the given `Model` with the given `name`.
   * @param {Constructor} Model
   * @param {string} name
   * @returns {Constructor}
   */
  function namedModel(Model, name) {
    return new Function("Model", `return class ${name} extends Model {};`)(
      Model
    );
  }

  const baseModels = mapObj(processedModelDefs, (model, fields) => {
    class Model extends Base {
      static _name = model;
      static _fields = fields;
      /**
       * Called after the instantiation of the record.
       */
      setup(_vals) {}
      get env() {
        return env;
      }
      update(vals) {
        return update(model, this, vals);
      }
      delete() {
        return delete_(model, this);
      }
    }

    return namedModel(
      Model,
      model
        .split(".")
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join("")
    );
  });

  const models = { ...baseModels, ...modelOverrides(baseModels) };

  return mapObj(processedModelDefs, (model) => createCRUD(model));
}
