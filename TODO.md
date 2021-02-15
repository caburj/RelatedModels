## TODOS

- [ ] Do not commit when there is an error during creation, update or delete.
- [ ] The following are parts of the same task -- correct everything
  - [ ] one2many is really a special case, can't be generalize with many2many
  - [ ] Missing tests to some methods such as find.
  - [ ] organize the tests
- [ ] Don't use `read` method, use `_getRecord`. We need the prevent coupling of
      the result `models` to the implementation.
- [ ] Reimplement link
  - [ ] when created, it automatically adds itself to its nodes
  - [ ] when deleted, it automatically deletes itself from its nodes
- [ ] serialize and create from serialized the instance of BaseModel, maybe also
      the nodes and links
- [ ] reset contents of related models
  - [ ] should also update the tests to probably reset models for each test

## DOING

- [ ] Nodes should be in a record and should be named as `connections` or `links`.

## DONE

- [x] Implement replace, or support multiple commands in many2many field update
  - supported multiple commands, so replace is equivalent to clear + add.
- [x] Support creation of records in a related field.
- [x] Something is wrong with the connect method. It seems to be doing excessive
      disconnect when relation is many2one.
  - nothing is wrong.
