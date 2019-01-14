// Since this library proxies IDB, I haven't retested all of IDB. I've tried to cover parts of the
// library that behave differently to IDB, or may cause accidental differences.

import '../node_modules/mocha/mocha.js';
import '../node_modules/chai/chai.js';
import { openDb, deleteDb, unwrap } from '../build/idb.mjs';

mocha.setup('tdd');
const { assert: {
  typeOf,
  isUndefined,
  instanceOf,
  equal,
  isTrue,
  deepEqual,
  notEqual,
} } = chai;

suite('deleteDb setup', () => {
  test('is a function', () => typeOf(deleteDb, 'function'));
  test('returns a promise for void', async () => {
    const val = deleteDb('test');
    typeOf(val, 'promise');
    const resolvedVal = await val;
    isUndefined(resolvedVal);
  });
});

suite('database read/write', () => {
  /**
   * @type IDBDatabase
   */
  let db;

  test('can be opened', async () => {
    typeOf(openDb, 'function');

    let upgradeCalled = false;

    db = await openDb('test', 1, {
      upgrade(db, oldVersion, newVersion) {
        upgradeCalled = true;

        instanceOf(db, IDBDatabase);
        equal(oldVersion, 0);
        equal(newVersion, 1);

        db.createObjectStore('test-store');
      },
    });

    isTrue(upgradeCalled);
    instanceOf(db, IDBDatabase);
    equal(db.name, 'test');
    deepEqual([...db.objectStoreNames], ['test-store']);
  });

  test('can add items & confirm with done promise', async () => {
    const tx = db.transaction('test-store', 'readwrite');
    const store = tx.objectStore('test-store');
    const promise = store.add('foo', 'bar');

    typeOf(promise, 'promise');
    typeOf(tx.done, 'promise');
    await tx.done;
  });

  test('can get items via promises', async () => {
    const tx = db.transaction('test-store');
    const store = tx.objectStore('test-store');
    const result = await store.get('bar');
    equal(result, 'foo');
  });

  test('can upgrade with indexes, and handles blocking', async () => {
    let upgradeCalled = false;
    let blockedCalled = false;
    const oldDb = db;

    db = await openDb('test', 2, {
      upgrade(db, oldVersion, newVersion) {
        upgradeCalled = true;
        equal(oldVersion, 1);
        equal(newVersion, 2);

        const store = db.createObjectStore('index-store', { keyPath: 'id' });
        store.createIndex('order', 'order');
        store.put({ id: 1, order: 3, val: 'hello' });
        store.put({ id: 2, order: 2, val: 'world' });
        store.put({ id: 3, order: 1, val: 'foobar' });
      },
      blocked() {
        blockedCalled = true;
        oldDb.close();
      },
    });

    isTrue(upgradeCalled);
    isTrue(blockedCalled);
  });

  test('can upgrade without options', async () => {
    db.close();
    db = await openDb('test', 3);
    equal(db.version, 3);
  });

  test('can get items via index', async () => {
    const tx = db.transaction('index-store');
    const store = tx.objectStore('index-store');
    const index = store.index('order');

    const all = await index.getAll();

    deepEqual(all, [
      { id: 3, order: 1, val: 'foobar' },
      { id: 2, order: 2, val: 'world' },
      { id: 1, order: 3, val: 'hello' },
    ]);
  });

  test('can cursor over stores', async () => {
    const tx = db.transaction('index-store');
    const store = tx.objectStore('index-store');

    let storeCursor = await store.openCursor();
    const storeVals = [];

    while (storeCursor) {
      storeVals.push(storeCursor.value.val);
      storeCursor = await storeCursor.continue();
    }

    deepEqual(storeVals, ['hello', 'world', 'foobar']);
  });

  test('can cursor over indexes', async () => {
    const tx = db.transaction('index-store');
    const index = tx.objectStore('index-store').index('order');
    let indexCursor = await index.openCursor();
    const indexVals = [];

    while (indexCursor) {
      indexVals.push(indexCursor.value.val);
      indexCursor = await indexCursor.continue();
    }

    deepEqual(indexVals, ['foobar', 'world', 'hello']);
  });

  test('can close', async () => {
    db.close();
  });
});

suite('object equality', () => {
  /**
   * @type IDBDatabase
   */
  let db;

  setup(async () => {
    db = await openDb('test', 4);
  });

  test('Function equality', async () => {
    // Function getters should return the same instance.
    equal(db.addEventListener, db.addEventListener, 'addEventListener');
    equal(db.transaction, db.transaction, 'transaction');

    const tx1 = db.transaction('test-store');
    const tx2 = db.transaction('test-store');

    // Functions should be equal across instances.
    equal(tx1.objectStore, tx2.objectStore, 'objectStore func');
  });

  test('Object store equality', async () => {
    const tx1 = db.transaction('test-store');
    const tx2 = db.transaction('test-store');

    // The spec says object stores from the same transaction should be equal.
    equal(tx1.objectStore('test-store'), tx1.objectStore('test-store'), 'objectStore on same tx');

    // The spec says object stores from different transaction should not be equal.
    notEqual(
      tx1.objectStore('test-store'), tx2.objectStore('test-store'),
      'objectStore on different tx',
    );
  });

});

// TODO: test unwrapping

mocha.run();