# lmdb-index
Higher level object operations for LMDB values, e.g. indexing and indexed based queries

This is ALPHA software. The API is not yet stable and adequate unit testing has not been completed.

# Installation

```bash
npm install lmdb-index
```

# Usage

```javascript
import {open} from "lmdb";
import {defineSchema,put,remove,getRangeFromIndex,withExtensions} from "lmdb-index";

const db = withExtensions(open("test"),{defineSchema,put,remove,getRangeFromIndex});
db.defineSchema(Object);
await db.put(null,{message:"goodbye","#":1});
await db.put(null,{message:"hello","#":2});
console.log([...db.getRangeFromIndex({message:"hello"})]); // logs one
console.log([...db.getRangeFromIndex({message(value) { return value!=null }})]); // 
```

# API

Documentation is for the modified behavior of the LMDB database NOT the exported functions.

## async defineSchema(classConstructor,?options={}) - returns boolean

- The key names in the array `options.indexKeys` will be indexed. If no value if provided, all keys will be indexed. If `options.indexKeys` is an empty array, no keys will be indexed. 
- If the property `options.idKey` is provided, its value will be used for unique ids. If `options.idKey` is not provided, the property `#` on instances will be used for unique ids.
- If the property `options.keyGenerator` is provided, its value should be a function that returns a unique id. If `options.keyGenerator` is not provided, a v4 UUID will be used.

With the exception of `options.index`, `options` properties and values are inherited by child schema, i.e. if you define them for `Object`, then you do not need to provide them for other classes.

To index all keys on all objects using UUIDs as ids and `#` as the id key, call `db.defineSchema(Object)`.

## async put(key,value,?version,?ifVersion) - returns boolean

If `value` is an object, it will be indexed by the keys of the object so long as it is an instance of and object controlled by a schema declared with `defineSchema`. To index all keys on all objects, call `db.defineSchema(Object)`. If `key` is `null`, a unique id will be generated and added to the object. See [defineSchema](#async-defineschemaclassconstructor-options) for more information.
If there is a mismatch between the `key` and the `idKey` of the object, an Error will be thrown.

## async copy(key,destKey,?overwrite,?version,?ifVersion) - returns boolean

NOT YET IMPLEMENTED

Updates the index after the copy.

Also see [lmdb-copy](https://github.com/anywhichway/lmdb-copy)

## async move(key,destKey,?overwrite,?version,?ifVersion) - returns boolean

NOT YET IMPLEMENTED

Updates the index after the move.

Also see [lmdb-move](https://github.com/anywhichway/lmdb-move)

## async patch(key,patch,?version,?ifVersion) - returns boolean

NOT YET IMPLEMENTED

Updates the index after the patch.

Also see [lmdb-patch](https://github.com/anywhichway/lmdb-patch)

## async remove(key,?version,?ifVersion) - returns boolean

Same behavior as `lmdb` except that the index entries are removed.

## async getRangeFromIndex(indexMatch,?valueMatch,?select,{cname=indexMatch.constructor.name,versions,offset,limit=||Infinity}=?options={}) - returns AsyncIterableIterator

`indexMatch` is an object with keys that may be serialized RegExp and values that may be literals, or RegExp or functions that return truthy values and `DONE`.

`cname` is the name of the class to query. It defaults to the constructor name of the `indexMatch`. To query across all classes use the export `ANYCNAME` for `cname`

## withExtensions(db:lmdbDatabase,extenstions:object) - returns lmdbDatabase`

Extends an LMDB database and any child databases it opens to have the `extensions` provided as well as any child databases it opens. This utility is common to other `lmdb` extensions like `lmdb-patch`, `lmdb-copy`, `lmdb-move`.

# Testing

Testing conducted with `jest`.

File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------|---------|----------|---------|---------|------------------------
All files |   70.67 |    58.47 |   66.66 |   84.46 |
index.js |   70.67 |    58.47 |   66.66 |   84.46 | 22-23,56-61,121-123,144-145,159-162


# Release Notes (Reverse Chronological Order)

2023-04-23 v0.3.0 Using child databases sometimes caused crashes in a clustered environment. Removed child use and instead using a key prefix of @@<constructor name>. Added ability to query across multiple class types.

2023-04-23 v0.2.0 Moved indexes to a separate child database so that they will not conflict with custom indexes and keys developed by application programmers using this library.

2023-04-23 v0.1.1 Documentation updates. Adjusted so that corrupt indexes do not return values for keys that do not exist.

2023-04-22 v0.1.0 Made API more consistent with `lmdb-query`.

2023-04-22 v0.0.2 Documentation updates. Addition of `defineSchema` and UUID generation.

2023-04-21 v0.0.1 Initial public release
