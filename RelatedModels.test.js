import createRelatedModels, { BaseModel } from './RelatedModels';

function sum(array, selector = (x) => x) {
  return array.reduce((acc, item) => acc + selector(item), 0);
}

const modelDefs = {
  order: {
    id: {
      type: 'string',
    },
    orderline_ids: {
      type: 'one2many',
      related_to: 'orderline',
      relation_ref: 'order_orderline_rel',
    },
  },
  orderline: {
    id: {
      type: 'string',
    },
    order_id: {
      type: 'many2one',
      related_to: 'order',
      relation_ref: 'order_orderline_rel',
    },
    product_id: {
      type: 'many2one',
      related_to: 'product',
      relation_ref: 'orderline_product_rel',
      required: true,
    },
    quantity: {
      type: 'number',
      required: true,
    },
    tax_ids: {
      type: 'many2many',
      related_to: 'tax',
      relation_ref: 'orderline_tax_rel',
    },
  },
  product: {
    id: {
      type: 'string',
    },
    name: {
      type: 'string',
      required: true,
    },
    price: {
      type: 'number',
      required: true,
    },
    tag_ids: {
      type: 'many2many',
      related_to: 'tag',
      relation_ref: 'product_tag_rel',
    },
  },
  tax: {
    id: {
      type: 'string',
    },
    name: {
      type: 'string',
    },
    percentage: {
      type: 'number',
      required: true,
    },
  },
  tag: {
    id: {
      type: 'string',
    },
    name: {
      type: 'string',
      required: true,
    },
    product_ids: {
      type: 'many2many',
      related_to: 'product',
      relation_ref: 'product_tag_rel',
    },
  },
};

class Order extends BaseModel {
  getTotal() {
    return sum(
      this.orderline_ids,
      (line) => line.quantity * line.product_id.price
    );
  }
}
class Orderline extends BaseModel {}
class Product extends BaseModel {}
class Tax extends BaseModel {}
class Tag extends BaseModel {}

const classes = {
  order: Order,
  orderline: Orderline,
  product: Product,
  tax: Tax,
  tag: Tag,
};

const models = createRelatedModels(modelDefs, classes);

let product1, product2, product3;
beforeAll(async () => {
  product1 = models.product.create({
    name: 'Burger',
    price: 10,
  });
  product2 = models.product.create({
    name: 'Water',
    price: 2.5,
  });
  product3 = models.product.create({
    name: 'Ice Cream',
    price: 3,
  });
});

describe('read', () => {
  it('returns all records when no 2nd param is given', () => {
    const results = models.product.readAll();
    expect(results).toEqual([product1, product2, product3]);
  });
  it('returns records corresponding to the given list of ids', () => {
    const results = models.product.readMany([product1.id, product3.id]);
    expect(results).toEqual([product1, product3]);
  });
  it('returns records based on the given predicate', () => {
    const results = models.product.findAll((record) => record.price === 10);
    expect(results.length).toBe(1);
    const [product] = results;
    expect(product.name).toBe('Burger');
  });
});

describe('one2many/many2one', () => {
  describe('create', () => {
    it('automatically adds orderline to the order', () => {
      const order1 = models.order.create({});
      const orderline1 = models.orderline.create({
        order_id: order1.id,
        product_id: product1.id,
        quantity: 1,
      });
      expect(order1.orderline_ids.includes(orderline1)).toBe(true);
      expect(orderline1.order_id).toBe(order1);
    });
    it('automatically sets order_id to orderline', () => {
      const orderline1 = models.orderline.create({
        product_id: product2.id,
        quantity: 2,
      });
      const order1 = models.order.create({
        orderline_ids: [['link', orderline1.id]],
      });
      expect(order1.orderline_ids.includes(orderline1)).toBe(true);
      expect(orderline1.order_id).toBe(order1);
    });
    it('automatically creates many2one field', () => {
      const orderline = models.orderline.create({
        product_id: product2.id,
        quantity: 2,
        order_id: {},
      });
      const order = orderline.order_id;
      expect(order).not.toBe(undefined);
      expect(order.orderline_ids).toEqual([orderline]);
    });
    it('properly connects records during updates', () => {
      // NOTE: This test reveals a special property of
      // many2one/one2many relationship. Looks like I can't
      // generalize x2many fields.
      const orderline1 = models.orderline.create({
        product_id: product1.id,
        quantity: 1,
        order_id: {},
      });
      const orderline2 = models.orderline.create({
        product_id: product2.id,
        quantity: 2,
        order_id: {},
      });
      const order1 = orderline1.order_id;
      const order2 = orderline2.order_id;
      models.orderline.update(orderline1.id, { order_id: order2.id });
      expect(orderline1.order_id).toBe(order2);
      expect(order2.orderline_ids.length).toBe(2);
      expect(order1.orderline_ids.length).toBe(0);
      models.order.update(order1.id, {
        orderline_ids: [['link', orderline1.id, orderline2.id]],
      });
      expect(order1.orderline_ids.length).toBe(2);
      expect(order2.orderline_ids.length).toBe(0);
    });
  });
  describe('update', () => {
    it('adds to one2many field', () => {
      const orderline1 = models.orderline.create({
        product_id: product3.id,
        quantity: 4,
      });
      const order1 = models.order.create({});
      models.order.update(order1.id, {
        orderline_ids: [['link', orderline1.id]],
      });
      expect(order1.orderline_ids.includes(orderline1)).toBe(true);
      expect(orderline1.order_id).toBe(order1);
    });
    it('replaces one2many field', () => {
      const orderline1 = models.orderline.create({
        product_id: product3.id,
        quantity: 3,
      });
      const order1 = models.order.create({
        orderline_ids: [['link', orderline1.id]],
      });
      const orderline2 = models.orderline.create({
        product_id: product2.id,
        quantity: 4,
      });
      const orderline3 = models.orderline.create({
        product_id: product1.id,
        quantity: 1,
      });
      models.order.update(order1.id, {
        orderline_ids: [['clear'], ['link', orderline2.id, orderline3.id]],
      });
      expect(orderline1.order_id).toBe(undefined);
      expect(orderline2.order_id).toBe(order1);
      expect(orderline3.order_id).toBe(order1);
      expect(order1.orderline_ids).toEqual([orderline2, orderline3]);
    });
    it('deletes items in one2many field', () => {
      const order1 = models.order.create({});
      const orderline1 = models.orderline.create({
        product_id: product3.id,
        quantity: 3,
        order_id: order1.id,
      });
      const orderline2 = models.orderline.create({
        product_id: product2.id,
        quantity: 4,
        order_id: order1.id,
      });
      const orderline3 = models.orderline.create({
        product_id: product1.id,
        quantity: 1,
        order_id: order1.id,
      });
      expect(order1.orderline_ids).toEqual([
        orderline1,
        orderline2,
        orderline3,
      ]);
      expect(orderline1.order_id).toBe(order1);
      expect(orderline2.order_id).toBe(order1);
      expect(orderline3.order_id).toBe(order1);
      models.order.update(order1.id, {
        orderline_ids: [['unlink', orderline2.id, orderline3.id]],
      });
      expect(orderline1.order_id).toBe(order1);
      expect(orderline2.order_id).toBe(undefined);
      expect(orderline3.order_id).toBe(undefined);
      expect(order1.orderline_ids).toEqual([orderline1]);
    });
    it('updates properly after series of updates', () => {
      const ol1 = models.orderline.create({
        product_id: product1.id,
        quantity: 1,
      });
      const order1 = models.order.create({
        orderline_ids: [['link', ol1.id]],
      });
      expect(order1.orderline_ids.length).toBe(1);
      const orderline1 = models.orderline.create({
        product_id: product2.id,
        quantity: 2,
        order_id: order1.id,
      });
      expect(order1.orderline_ids.length).toBe(2);
      expect(orderline1.order_id).toBe(order1);
      const ol = models.orderline.create({
        product_id: product3.id,
        quantity: 3,
      });
      models.order.update(order1.id, {
        orderline_ids: [['link', ol.id]],
      });
      expect(order1.orderline_ids.length).toBe(3);
      models.orderline.delete([orderline1.id]);
      expect(order1.orderline_ids.length).toBe(2);
      models.order.update(order1.id, {
        orderline_ids: [
          ['unlink', ...order1.orderline_ids.map((line) => line.id)],
        ],
      });
      expect(order1.orderline_ids.length).toBe(0);
    });
    it('updates the related model', () => {
      // create products
      // create order based on the products
      // update a product's price
      // the product's change should change the order's total
      const product1 = models.product.create({
        name: 'product1',
        price: 10,
      });
      const product2 = models.product.create({ name: 'product2', price: 5 });
      const orderlines = models.orderline.createMany([
        { product_id: product1.id, quantity: 3 },
        { product_id: product2.id, quantity: 2 },
      ]);
      const order1 = models.order.create({
        orderline_ids: [['link', ...orderlines.map((line) => line.id)]],
      });
      function computeOrderTotal(order) {
        return sum(
          order.orderline_ids,
          (line) => line.product_id.price * line.quantity
        );
      }
      expect(computeOrderTotal(order1)).toBe(3 * 10 + 2 * 5);
      models.product.update(product1.id, { price: 100 });
      expect(computeOrderTotal(order1)).toBe(3 * 100 + 2 * 5);
    });
    it('updates many2one', () => {
      const order1 = models.order.create({});
      const order2 = models.order.create({});
      const orderline = models.orderline.create({
        product_id: product1.id,
        quantity: 1,
      });
      expect(orderline.order_id).toBe(undefined);
      models.orderline.update(orderline.id, { order_id: order1.id });
      expect(orderline.order_id).toBe(order1);
      models.orderline.update(orderline.id, { order_id: false });
      expect(orderline.order_id).toBe(undefined);
      models.orderline.update(orderline.id, { order_id: order2.id });
      expect(orderline.order_id).toBe(order2);
      models.orderline.update(orderline.id, { order_id: {} });
      expect(orderline.order_id).not.toBe(order2);
    });
    it('should not remove many2one link when many2one field is not part of update', () => {
      const order1 = models.order.create({});
      const orderline = models.orderline.create({
        product_id: product1.id,
        quantity: 1,
      });
      expect(orderline.order_id).toBe(undefined);
      models.orderline.update(orderline.id, { order_id: order1.id });
      expect(orderline.order_id).toBe(order1);
      models.orderline.update(orderline.id, {});
      expect(orderline.order_id).toBe(order1);
    });
    it('creates on x2many field', () => {
      const order = models.order.create({
        orderline_ids: [
          [
            'create',
            {
              product_id: product1.id,
              quantity: 1,
            },
            {
              product_id: product2.id,
              quantity: 2,
            },
          ],
        ],
      });
      expect(order.orderline_ids.length).toBe(2);
      const [ol1, ol2] = order.orderline_ids;
      expect(ol1.order_id).toBe(order);
      expect(ol2.order_id).toBe(order);
    });
    it('creates on x2one field', () => {
      const orderline = models.orderline.create({
        product_id: product1.id,
        quantity: 1,
        order_id: {},
      });
      expect(orderline.order_id).not.toBe(undefined);
      const order = orderline.order_id;
      expect(order.orderline_ids).toEqual([orderline]);
    });
  });
  describe('delete', () => {
    let order1, orderline1;
    beforeEach(() => {
      order1 = models.order.create({});
      orderline1 = models.orderline.create({
        order_id: order1.id,
        product_id: product1.id,
        quantity: 1,
      });
    });
    it('removes reference to order after orderline is deleted 1', () => {
      models.orderline.delete([orderline1.id]);
      expect(order1.orderline_ids.includes(orderline1)).toBe(false);
      expect(orderline1.order_id).toBe(undefined);
    });
    it('removes reference to order after orderline is deleted 2', () => {
      models.order.update(order1.id, {
        orderline_ids: [['unlink', orderline1.id]],
      });
      expect(order1.orderline_ids.includes(orderline1)).toBe(false);
      expect(orderline1.order_id).toBe(undefined);
    });
    it('removes reference to ordeline after order is deleted', () => {
      models.order.delete([order1.id]);
      expect(orderline1.order_id).toBe(undefined);
    });
  });
});

describe('many2one without inverse to the related type', () => {
  it('removes the association to productA when productA is deleted', () => {
    const productA = models.product.create({ name: 'productA', price: 100 });
    const orderline1 = models.orderline.create({
      product_id: productA.id,
      quantity: 10,
    });
    expect(orderline1.product_id).toBe(productA);
    models.product.delete([productA.id]);
    expect(orderline1.product_id).toBe(undefined);
  });
});

describe('many2many', () => {
  describe('create', () => {
    it('creates w/ ids given to the many2many field', () => {
      const productA1 = models.product.create({
        name: 'Product A1',
        price: 10,
      });
      const productA2 = models.product.create({
        name: 'Product A2',
        price: 100,
      });
      const tagA = models.tag.create({
        name: 'Tag A',
        product_ids: [['link', ...[productA1.id, productA2.id].sort()]],
      });
      expect(tagA.product_ids.map((product) => product.id).sort()).toEqual(
        [productA1.id, productA2.id].sort()
      );
      expect(productA1.tag_ids).toEqual([tagA]);
      expect(productA2.tag_ids).toEqual([tagA]);
    });
    it('creates with vals given to the many2many field', () => {
      const productA = models.product.create({
        name: 'Product A',
        price: 10,
        tag_ids: [['create', { name: 'Tag 1' }, { name: 'Tag 2' }]],
      });
      const [tag1, tag2] = models.tag.readMany(
        productA.tag_ids.map((tag) => tag.id)
      );
      expect(tag1.product_ids).toEqual([productA]);
      expect(tag2.product_ids).toEqual([productA]);
    });
  });
  describe('update', () => {
    it('updates a record using "replace" mode', () => {
      const productA = models.product.create({
        name: 'productA',
        price: 10,
      });
      const productB = models.product.create({
        name: 'productB',
        price: 100,
      });
      const tag1 = models.tag.create({
        name: 'Tag 1',
        product_ids: [['link', ...[productA.id, productB.id].sort()]],
      });
      expect(tag1.product_ids.map((product) => product.id).sort()).toEqual(
        [productA.id, productB.id].sort()
      );
      expect(productA.tag_ids).toEqual([tag1]);
      expect(productB.tag_ids).toEqual([tag1]);
      const productC = models.product.create({
        name: 'productB',
        price: Infinity,
      });
      models.tag.update(tag1.id, {
        product_ids: [['clear'], ['link', productC.id]],
      });
      expect(tag1.product_ids).toEqual([productC]);
      expect(productA.tag_ids).toEqual([]);
      expect(productB.tag_ids).toEqual([]);
      expect(productC.tag_ids).toEqual([tag1]);
    });
    it('updates a record using "add" mode', () => {
      const tag1 = models.tag.create({ name: 'tag1' });
      const productA = models.product.create({
        name: 'productA',
        price: 5,
        tag_ids: [['link', tag1.id]],
      });
      expect(productA.tag_ids).toEqual([tag1]);
      const tag2 = models.tag.create({ name: 'tag2' });
      models.product.update(productA.id, {
        tag_ids: [['link', tag2.id]],
      });
      expect(productA.tag_ids.map((tag) => tag.id).sort()).toEqual(
        [tag1.id, tag2.id].sort()
      );
      expect(tag2.product_ids).toEqual([productA]);
      expect(tag1.product_ids).toEqual([productA]);
    });
    it('updates a record using "remove" mode', () => {
      const productA = models.product.create({
        name: 'productA',
        price: 10,
      });
      const productB = models.product.create({
        name: 'productB',
        price: 100,
      });
      const productC = models.product.create({
        name: 'productC',
        price: 1000,
      });
      const product_ids = [productA.id, productB.id, productC.id].sort();
      const tag1 = models.tag.create({
        name: 'Tag 1',
        product_ids: [['link', ...product_ids]],
      });
      expect(tag1.product_ids.map((product) => product.id).sort()).toEqual(
        [productA.id, productB.id, productC.id].sort()
      );
      expect(productA.tag_ids).toEqual([tag1]);
      expect(productB.tag_ids).toEqual([tag1]);
      expect(productC.tag_ids).toEqual([tag1]);
      models.tag.update(tag1.id, {
        product_ids: [['unlink', productB.id]],
      });
      expect(tag1.product_ids.map((product) => product.id).sort()).toEqual(
        [productA.id, productC.id].sort()
      );
      expect(productA.tag_ids).toEqual([tag1]);
      expect(productB.tag_ids).toEqual([]);
      expect(productC.tag_ids).toEqual([tag1]);
    });
    it('updates a record using "create"', () => {
      const productA = models.product.create({
        name: 'productA',
        price: 10,
      });
      expect(productA.tag_ids).toEqual([]);
      models.product.update(productA.id, {
        tag_ids: [
          ['create', { name: 'Tag1' }, { name: 'Tag2' }, { name: 'Tag3' }],
        ],
      });
      expect(productA.tag_ids.length).toEqual(3);
      const [tag1, tag2, tag3] = productA.tag_ids;
      expect(tag1.product_ids).toEqual([productA]);
      expect(tag2.product_ids).toEqual([productA]);
      expect(tag3.product_ids).toEqual([productA]);
    });
  });
  describe('delete', () => {
    it('updates the related records after deletion 1', () => {
      const productA = models.product.create({
        name: 'productA',
        price: 10,
      });
      const productB = models.product.create({
        name: 'productB',
        price: 100,
      });
      const productC = models.product.create({
        name: 'productC',
        price: 1000,
      });
      const product_ids = [productA.id, productB.id, productC.id].sort();
      const tag1 = models.tag.create({
        name: 'Tag 1',
        product_ids: [['link', ...product_ids]],
      });
      models.product.deleteMany([productA.id, productC.id]);
      expect(tag1.product_ids).toEqual([productB]);
      expect(productA.tag_ids).toEqual([]);
      expect(productC.tag_ids).toEqual([]);
    });
    it('updates the related records after deletion 2', () => {
      const productA = models.product.create({
        name: 'productA',
        price: 10,
      });
      const productB = models.product.create({
        name: 'productB',
        price: 100,
      });
      const productC = models.product.create({
        name: 'productC',
        price: 1000,
      });
      const tag1 = models.tag.create({
        name: 'tag1',
        product_ids: [['link', productA.id, productB.id]],
      });
      const tag2 = models.tag.create({
        name: 'tag2',
        product_ids: [['link', productB.id, productC.id]],
      });
      const tag3 = models.tag.create({
        name: 'tag3',
        product_ids: [['link', productA.id, productC.id]],
      });
      expect(tag1.product_ids).toEqual([productA, productB]);
      expect(tag2.product_ids).toEqual([productB, productC]);
      expect(tag3.product_ids).toEqual([productA, productC]);
      expect(productA.tag_ids).toEqual([tag1, tag3]);
      expect(productB.tag_ids).toEqual([tag1, tag2]);
      expect(productC.tag_ids).toEqual([tag2, tag3]);
      models.tag.deleteMany([tag1.id, tag2.id]);
      expect(productA.tag_ids).toEqual([tag3]);
      expect(productB.tag_ids).toEqual([]);
      expect(productC.tag_ids).toEqual([tag3]);
      models.product.deleteMany([productA.id, productB.id]);
      expect(tag3.product_ids).toEqual([productC]);
    });
  });
});

describe('many2many without corresponding relation_ref', () => {
  it('creates with the related field', () => {
    const tax1 = models.tax.create({
      name: 'tax1',
      percentage: 20,
    });
    const order1 = models.order.create({});
    const orderline1 = models.orderline.create({
      order_id: order1.id,
      product_id: product1.id,
      quantity: 1,
      tax_ids: [['link', tax1.id]],
    });
    expect(orderline1.tax_ids).toEqual([tax1]);
  });
  it('works when updating using add mode', () => {
    const tax1 = models.tax.create({
      name: 'tax1',
      percentage: 20,
    });
    const order1 = models.order.create({});
    const orderline1 = models.orderline.create({
      order_id: order1.id,
      product_id: product1.id,
      quantity: 1,
      tax_ids: [['link', tax1.id]],
    });
    expect(orderline1.tax_ids).toEqual([tax1]);
    const tax2 = models.tax.create({
      name: 'tax2',
      percentage: 50,
    });
    models.orderline.update(orderline1.id, {
      tax_ids: [['link', tax2.id]],
    });
    expect(orderline1.tax_ids.map((tax) => tax.id).sort()).toEqual(
      [tax1.id, tax2.id].sort()
    );
  });
  it('works when updating using delete mode', () => {
    const order1 = models.order.create({});
    const tax1 = models.tax.create({
      name: 'tax1',
      percentage: 20,
    });
    const tax2 = models.tax.create({
      name: 'tax2',
      percentage: 50,
    });
    const orderline1 = models.orderline.create({
      order_id: order1.id,
      product_id: product1.id,
      quantity: 1,
      tax_ids: [['link', tax1.id, tax2.id]],
    });
    expect(orderline1.tax_ids.map((tax) => tax.id).sort()).toEqual(
      [tax1.id, tax2.id].sort()
    );
    models.orderline.update(orderline1.id, {
      tax_ids: [['unlink', tax2.id]],
    });
    expect(orderline1.tax_ids.map((tax) => tax.id)).toEqual([tax1.id]);
  });
  it('works when updating using replace mode', () => {
    const order1 = models.order.create({});
    const tax1 = models.tax.create({
      name: 'tax1',
      percentage: 20,
    });
    const tax2 = models.tax.create({
      name: 'tax2',
      percentage: 50,
    });
    const tax3 = models.tax.create({
      name: 'tax2',
      percentage: 150,
    });
    const orderline1 = models.orderline.create({
      order_id: order1.id,
      product_id: product1.id,
      quantity: 1,
      tax_ids: [['link', tax2.id]],
    });
    expect(orderline1.tax_ids.map((tax) => tax.id)).toEqual([tax2.id]);
    models.orderline.update(orderline1.id, {
      tax_ids: [['clear'], ['link', tax1.id, tax3.id]],
    });
    expect(orderline1.tax_ids.map((tax) => tax.id).sort()).toEqual(
      [tax3.id, tax1.id].sort()
    );
  });
  it('works when deleting', () => {
    const order1 = models.order.create({});
    const tax1 = models.tax.create({
      name: 'tax1',
      percentage: 20,
    });
    const tax2 = models.tax.create({
      name: 'tax2',
      percentage: 50,
    });
    const tax3 = models.tax.create({
      name: 'tax3',
      percentage: 150,
    });
    const orderline1 = models.orderline.create({
      order_id: order1.id,
      product_id: product1.id,
      quantity: 1,
      tax_ids: [['link', tax1.id, tax2.id, tax3.id]],
    });
    expect(orderline1.tax_ids.map((tax) => tax.id).sort()).toEqual(
      [tax3.id, tax1.id, tax2.id].sort()
    );
    models.tax.deleteMany([tax2.id, tax3.id]);
    expect(orderline1.tax_ids.map((tax) => tax.id)).toEqual([tax1.id]);
  });
});

describe('class methods', () => {
  it('calls the class methods', () => {
    const product1 = models.product.create({
      name: 'product1',
      price: 10,
    });
    const product2 = models.product.create({ name: 'product2', price: 5 });
    const orderlines = models.orderline.createMany([
      { product_id: product1.id, quantity: 3 },
      { product_id: product2.id, quantity: 2 },
    ]);
    const order1 = models.order.create({
      orderline_ids: [['link', ...orderlines.map((line) => line.id)]],
    });
    expect(order1.getTotal()).toBe(3 * 10 + 2 * 5);
    models.product.update(product1.id, { price: 100 });
    expect(order1.getTotal()).toBe(3 * 100 + 2 * 5);
  });
});
