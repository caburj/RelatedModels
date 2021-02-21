## Nodes

- Nodes has very confusing name. It actually contains the `connections` of a
  record to the related records.
- It should be called `connections` and the references should be saved in the
  records. E.g.
  ```
  product.__meta__ {
    connections {
      product_orderline_rel: string;
      product_tag_rel: string;
    }
  }
  ```
  Looks like I can actually assign a uuid to each `connection` in a record.

## Links

- Is is possible to avoid deriving the linkId based on the two records that it
  links?
