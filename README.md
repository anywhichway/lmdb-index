# lmdb-index
Object indexing and index based queries for LMDB. Also provides, automatic id generation, instantiation of returned objects as instances of their original classes.

This is a mid-level API. For the highest level LMDB object query API see [lmdb-oql](https://github.com/anywhichway/lmdb-oql).

This is BETA software. The API is stable and unit test coverage exceeds 90%.

# Installation

```bash
npm install lmdb-index
```

# Usage

```javascript
import {open} from "lmdb";
import {withExtensions} from "lmdb-index";

class Person {
    constructor(config={}) {
        Object.assign(this,config);
    }
}
const db = withExtensions(open("test"));
db.defineSchema(Object);
db.defineSchema(Person);
const id = await db.put(null,new Person({name:"bill",age:21,address:{city:"New York",state:"NY"}}));
if(id) {
    const person = await db.get(id);
    // the below all log the same thing, i.e. Person {name:"bill",age:21,"#":"Person@<some uuid>"}
    console.log(person);
    [...db.getRangeFromIndex({name:"bill"})].forEach((person) => {
        console.log(person)
    });
    [...db.getRangeFromIndex({name:/bil.*/})].forEach((person) => {
        console.log(person)
    });
    [...db.getRangeFromIndex({age:21})].forEach((person) => {
        console.log(person)
    });
    [...db.getRangeFromIndex({age:(value) => value===21 ? value : undefined})].forEach((person) => {
        console.log(person)
    });
    [...db.getRangeFromIndex({address:{city:"New York"}})].forEach((person) => {
        console.log(person)
    });
}
```

## API

### async db.copy(key,?destKey,?overwrite,?version,?ifVersion) - returns boolean

Works similar to [lmdb-copy](https://github.com/anywhichway/lmdb-copy) but provides automatic key assignment and indexing.

If `key` refers to an object for which there is a schema:
- If `destKey` is nullish, the `destKey` is given a value using the schema's key generator and assigned to the object copy
- The copy is inserted and indexed inside a transaction
- The `destKey` is returned if the transaction succeeds, otherwise `undefined` is returned.

If `key` points to a primitive:
- If `destKey` is nullish, it given a UUIDv4 value
- The copy is inserted at the `destKey` (No indexes are updated because primitives are not indexed.)
- The `destKey` is returned if the insertion succeeds, otherwise `undefined` is returned.

Otherwise, the copy is inserted at the `destKey`, no indexing occurs, the `destKey` or `false` is returned.

### async db.defineSchema(classConstructor,?options={}) - returns boolean

- The key names in the array `options.indexKeys` will be indexed. If no value is provided, all top level keys will be indexed. If `options.indexKeys` is an empty array, no keys will be indexed. 
- If the property `options.idKey` is provided, its value will be used for unique ids. If `options.idKey` is not provided, the property `#` on instances will be used for unique ids.
- If the property `options.keyGenerator` is provided, its value should be a function that returns a unique id. If `options.keyGenerator` is not provided, a v4 UUID will be used.

The `options` properties and values are inherited by child schema, i.e. if you define them for `Object`, then you do not need to provide them for other classes.

To index all top level keys on all objects using UUIDs as ids and `#` as the id key, call `db.defineSchema(Object)`.

*Note*: All operations returning an object attempt to create an instance of the object's original class if a schema is defined.

### db.getSchema(value:string|object) - returns object representing schema

Returns the schema for the class of the object or `undefined`.

### async db.getRangeFromIndex(indexMatch,?valueMatch,?select,{cname=indexMatch.constructor.name,sortable,fulltext,sort,versions,offset,limit=||Infinity}=?options={}) - returns AsyncIterableIterator

`indexMatch` is an object with keys that may be serialized RegExp and values that may be literals, or RegExp or functions that return non-undefined values or `DONE`.

`cname` is the name of the class to query. It defaults to the constructor name of the `indexMatch`. To query across all classes use the export `ANYCNAME` for `cname`

`sortable`, `'fulltext`, and `sort` start returning entries almost immediately based on partial index matches. `sortable` and `fulltext` return entries in the order they are indexed. `sort` returns entries based on how many index matches occurred, with the highest first.

```javascript
import {open} from "lmdb";
import {withExtensions} from "lmdb-index";

const db = withExtensions(open("test"));
db.defineSchema(Object);
await db.put(null,{message:"goodbye","#":1});
await db.put(null,{message:"hello","#":2});
console.log([...db.getRangeFromIndex({message:"hello"})]); // logs one
console.log([...db.getRangeFromIndex({message(value) { return value!=null }})]); // 
```

### async db.index(object:object,?cname,?version,?ifVersion) - returns LMDBKey|undefined

Puts the object in the database and indexes it inside a single transaction. Returns the object's id if successful, otherwise `undefined`.

### async db.move(key,destKey,?overwrite,?version,?ifVersion) - returns LMDBKey|undefined

Works similar to [lmdb-move](https://github.com/anywhichway/lmdb-move) but provides automatic key assignment and indexing.

Works the same as `copy` above, except the entry at the original `key` is removed inside the transaction.

### async db.patch(key,patch,?version,?ifVersion) - returns boolean

Inside a single transaction, updates the index after the patch.

Also see [lmdb-patch](https://github.com/anywhichway/lmdb-patch)

### async db.put(key,value,?cname,?version,?ifVersion) - returns LMDBKey|undefined

Works similar to [lmdb put](https://github.com/kriszyp/lmdb-js#dbputkey-value-version-number-ifversion-number-promiseboolean)

If `value` is an object, it will be indexed by the top level keys of the object so long as it is an instance of an object controlled by a schema declared with `defineSchema`. To index all top level keys on all objects, call `db.defineSchema(Object)`. If `key` is `null`, a unique id will be generated and added to the object. See [defineSchema](#async-defineschemaclassconstructor-options) for more information.

When putting an object for indexing, the `key` should eb `null`. It is retrieved from the object using the `idKey` of the schema. If there is a mismatch between the `key` and the `idKey` of the object, an Error will be thrown.

The `cname` argument is used to specify the class name of the object being put. If `cname` is not provided, the class name is determined by the constructor name of the `value` argument. This allows the developer to use plain objects. If `value` is a primitive, `cname` is ignored.

If there is a mismatch between the `key` and the `idKey` of the object, an Error will be thrown.

The `key` or in the case of objects the object id is returned if the transaction succeeds, otherwise `undefined` is returned.

See `db.index` to avoid the need for a `null` first argument and more information.

### async db.remove(key,?version,?ifVersion) - returns LMDBKey|undefined

Same behavior as `lmdb` except that the index entries are removed inside a transaction

### withExtensions(db:lmdbDatabase,?extensions:object) - returns LMDBDatabase`

Extends an LMDB database and any child databases it opens to have the `extensions` provided as well as any child databases it opens. This utility is common to other `lmdb` extensions like `lmdb-patch`, `lmdb-copy`, `lmdb-move`.

Automatically adds `copy`, `getRangeFromIndex`, `index`, `indexSync`, `move`, `patch` and modified behavior of `put`, `putSync`,`remove` and `removeSync`.

# Testing

Testing conducted with `jest`.

File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------|---------|----------|---------|---------|------------------------
All files |   84.59 |    72.95 |   92.68 |   90.68 |
index.js |   84.59 |    72.95 |   92.68 |   90.68 | 42-44,81,97,132-143,156,160,300,304,312,318-319,338,369,395,426,439


# Release Notes (Reverse Chronological Order)

During ALPHA and BETA, the following semantic versioning rules apply:

* The major version will be zero.
* Breaking changes or feature additions will increment the minor version.
* Bug fixes and documentation changes will increment the patch version.


2023-05-14 v0.7.2 Updated documentation.

2023-05-13 v0.7.1 Updated documentation. Not yet documented, built in full-text indexing and search.

2023-05-13 v0.7.0 Reworked indexing to simplify, improve speed and support full text indexing.

2023-05-06 v0.6.6 Removed test db from Git.

2023-05-05 v0.6.5 Fixed issue wih not removing un-indexed primitives.

2023-05-05 v0.6.4 Updated `lmdb-query` to 1.5.4. Fixed issue with `put` not awaiting.

2023-05-05 v0.6.3 Updated `lmdb-query` to 1.5.3.

2023-05-04 0.6.2 Updated dependencies. 

2023-05-03 v0.6.1 Addressed issue where properties with non-primitve values were not being indexed.

2023-05-02 v0.6.0 Added support for storing plain arrays as top level database entries, e.g. `await db.put(null,[1,2,3])`

2023-04-29 v0.5.1 Adjusted `defineSchema` so that it updates rather than overwrites definition if called a second time. Updated dependency versions. Adjusted unit tests. Fixed issues with `copy` and `move` not calling underlying code with `this` context. Unit test coverage over 90%, moving to BETA.

2023-04-28 v0.5.0 Added `getSchema` to exports. Enhanced unit tests.

2023-04-28 v0.4.3 Adjusted to use `withextensions` from `lmdb-query`. Enhanced documentation.

2023-04-27 v0.4.2 Added support for patch. Simplified `withExtensions` us. Enhanced documentation.

2023-04-24 v0.4.1 Adjustments to `copy` and `move` to ensure correct id assignment. Documentation formatting and typo corrections.

2023-04-24 v0.4.0 `copy` and `move` now supported.

2023-04-23 v0.3.1 Fix to fully deleting objects from indexes.

2023-04-23 v0.3.0 Using child databases sometimes caused crashes in a clustered environment. Removed child use and instead using a key prefix of @@<constructor name>. Added ability to query across multiple class types.

2023-04-23 v0.2.0 Moved indexes to a separate child database so that they will not conflict with custom indexes and keys developed by application programmers using this library.

2023-04-23 v0.1.1 Documentation updates. Adjusted so that corrupt indexes do not return values for keys that do not exist.

2023-04-22 v0.1.0 Made API more consistent with `lmdb-query`.

2023-04-22 v0.0.2 Documentation updates. Addition of `defineSchema` and UUID generation.

2023-04-21 v0.0.1 Initial public release

# License

This software is provided as-is under the [MIT license](http://opensource.org/licenses/MIT).

Copyright (c) 2023, AnyWhichWay, LLC and Simon Y. Blackwell.