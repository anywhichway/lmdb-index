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
const id = await db.put(null,new Person({name:"bill"}));
if(id) {
    const person = await db.get(id);
    if(person && person instanceof Person) {
        console.log(person)
    }
}
```

## API

Documentation is for the modified behavior of the LMDB database NOT the exported functions.

### async defineSchema(classConstructor,?options={}) - returns boolean

- The key names in the array `options.indexKeys` will be indexed. If no value is provided, all top level keys will be indexed. If `options.indexKeys` is an empty array, no keys will be indexed. 
- If the property `options.idKey` is provided, its value will be used for unique ids. If `options.idKey` is not provided, the property `#` on instances will be used for unique ids.
- If the property `options.keyGenerator` is provided, its value should be a function that returns a unique id. If `options.keyGenerator` is not provided, a v4 UUID will be used.

The `options` properties and values are inherited by child schema, i.e. if you define them for `Object`, then you do not need to provide them for other classes.

To index all top level keys on all objects using UUIDs as ids and `#` as the id key, call `db.defineSchema(Object)`.

*Note*: All operations returning an object attempt to create an instance of the object's original class if a schema is defined.

### async db.put(key,value,?version,?ifVersion) - returns boolean

Works similar to [lmdb put](https://github.com/kriszyp/lmdb-js#dbputkey-value-version-number-ifversion-number-promiseboolean)

If `value` is an object, it will be indexed by the top level keys of the object so long as it is an instance of an object controlled by a schema declared with `defineSchema`. To index all top level keys on all objects, call `db.defineSchema(Object)`. If `key` is `null`, a unique id will be generated and added to the object. See [defineSchema](#async-defineschemaclassconstructor-options) for more information.

If there is a mismatch between the `key` and the `idKey` of the object, an Error will be thrown.

### async db.copy(key,destKey,?overwrite,?version,?ifVersion) - returns boolean

Works similar to [lmdb-copy](https://github.com/anywhichway/lmdb-copy) but provides automatic key assignment and indexing.

If `key` refers to an object for which there is a schema:
    - If `destKey` is nullish, the `destKey` is given a value using the schema's key generator and assigned to the object copy 
    - The copy is inserted and indexed inside a transaction
    - The `destKey` is returned if the transaction succeeds, otherwise `false` is returned.

If `key` points to a primitive:
    - If `destKey` is nullish, it given a UUIDv4 value 
    - The copy is inserted at the `destKey` (No indexes are updated because primitives are not indexed.)
    - The `destKey` is returned if the insertion succeeds, otherwise `false` is returned.

Otherwise, the copy is inserted at the `destKey`, no indexing occurs, the `destKey` or `false` is returned.

### async db.getRangeFromIndex(indexMatch,?valueMatch,?select,{cname=indexMatch.constructor.name,versions,offset,limit=||Infinity}=?options={}) - returns AsyncIterableIterator

*NOTE*: `db.getRangeFromIndex` is an advanced API methods. The `select` method is far easier to use.

`indexMatch` is an object with keys that may be serialized RegExp and values that may be literals, or RegExp or functions that return truthy values and `DONE`.

`cname` is the name of the class to query. It defaults to the constructor name of the `indexMatch`. To query across all classes use the export `ANYCNAME` for `cname`

```javascript
import {open} from "lmdb";
import {defineSchema,get,put,remove,getRangeFromIndex,withExtensions} from "lmdb-index";

const db = withExtensions(open("test"),{defineSchema,get,put,remove,getRangeFromIndex});
db.defineSchema(Object);
await db.put(null,{message:"goodbye","#":1});
await db.put(null,{message:"hello","#":2});
console.log([...db.getRangeFromIndex({message:"hello"})]); // logs one
console.log([...db.getRangeFromIndex({message(value) { return value!=null }})]); // 
```

### async db.move(key,destKey,?overwrite,?version,?ifVersion) - returns boolean

Works similar to [lmdb-move](https://github.com/anywhichway/lmdb-move) but provides automatic key assignment and indexing.

Works the same as `copy` above, except the entry at the original `key` is removed inside the transaction.

### async db.patch(key,patch,?version,?ifVersion) - returns boolean

Updates the index after the patch.

Also see [lmdb-patch](https://github.com/anywhichway/lmdb-patch)

### async db.remove(key,?version,?ifVersion) - returns boolean

Same behavior as `lmdb` except that the index entries are removed inside a transaction

### withExtensions(db:lmdbDatabase,extenstions:object) - returns lmdbDatabase`

Extends an LMDB database and any child databases it opens to have the `extensions` provided as well as any child databases it opens. This utility is common to other `lmdb` extensions like `lmdb-patch`, `lmdb-copy`, `lmdb-move`.

Automatically adds `copy`, `move`, `patch` from their respective lmdb packages and `getRangeWhere` from `lmdb-query`.

# Testing

Testing conducted with `jest`.

File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------|---------|----------|---------|---------|------------------------
All files |   78.23 |    66.48 |     100 |   88.27 |
index.js |   78.23 |    66.48 |     100 |   88.27 | 30-35,46,48,88-93,105,117,200-202,231-232


# Release Notes (Reverse Chronological Order)

During ALPHA and BETA, the following semantic versioning rules apply:

* The major version will be zero.
* Breaking changes or feature additions will increment the minor version.
* Bug fixes and documentation changes will increment the patch version.

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