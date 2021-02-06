## TODOS

- [ ] Do not commit when there is an error during creation, update or delete.

## DOING

- [ ] The following are parts of the same task -- correct everything
  - [ ] one2many is really a special case, can't be generalize with many2many
  - [ ] Missing tests to some methods such as find.
  - [ ] organize the tests

## DONE

- [x] Implement replace, or support multiple commands in many2many field update
  - supported multiple commands, so replace is equivalent to clear + add.
- [x] Support creation of records in a related field.
