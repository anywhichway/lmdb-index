# lmdb-index

- object indexing for LMDB,
- index based queries using literals, functions, and regular expressions,
- over 50 pre-built functions for use in queries, e.g. `$lte`, `$echoes` (soundex), `$includes`,
- automatic id generation,
- instantiation of returned objects as instances of their original classes,
- copy, move, and patch operations,
- ACID transactions.

This is a mid-level API. For the highest level LMDB object query API see [lmdb-oql](https://github.com/anywhichway/lmdb-oql).

This is BETA software. The API is stable and unit test coverage exceeds 90%.

# Installation

```bash
npm install lmdb-index --save
```

# Usage

```javascript
import {open} from "lmdb";
import {withExtensions,operators} from "lmdb-index";

const {$gte} = operators;

class Person {
    constructor(config={}) {
        Object.assign(this,config);
    }
}
const db = withExtensions(open("test",{indexOptions:{fulltext:true}}));
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
    [...db.getRangeFromIndex({age:$gte(21)})].forEach((person) => {
        console.log(person)
    });
    [...db.getRangeFromIndex({age:(value) => value===21 ? value : undefined})].forEach((person) => {
        console.log(person)
    });
    [...db.getRangeFromIndex({
        [/name/]:"bill",
        address:{city:"York"} // fulltext indexing turned on, partial matches returned so long as `valueMatch` is relaxed
    },(value)=>value)].forEach((person) => {
        console.log(person)
    });
}
```
## API

#### async db.copy(key:LMDBKey,?destKey:LMDBKey,?overwrite:boolean,?version:number,?ifVersion:number) - returns LMDBKey

Works similar to [lmdb-copy](https://github.com/anywhichway/lmdb-copy) but provides automatic key assignment and indexing.

If `key` refers to an object for which there is a schema:
- If `destKey` is nullish, the `destKey` is given a value using the schema's key generator or a UUIDv4 value if no key generator is defined.
- The copy is inserted and indexed inside a transaction
- The `destKey` is returned if the transaction succeeds, otherwise `undefined` is returned.

If `key` points to a primitive:
- If `destKey` is nullish, it given a UUIDv4 value
- The copy is inserted at the `destKey` (No indexes are updated because primitives are not indexed.)
- The `destKey` is returned if the insertion succeeds, otherwise `undefined` is returned.

#### async db.defineSchema(classConstructor:function|class,?options={}) - returns boolean

- The key names in the array `options.indexKeys` will be indexed. Nested keys use dot notation. If no value is provided, all keys will be indexed. If `options.indexKeys` is an empty array, no keys will be indexed. 
- If the property `options.idKey` is provided, its value will be used for unique ids. If `options.idKey` is not provided, the property `#` on instances will be used for unique ids.
- If the property `options.keyGenerator` is provided, its value should be a function that returns a unique id. If `options.keyGenerator` is not provided, a v4 UUID will be used.

The `options` properties and values are inherited by child schema, i.e. if you define them for `Object`, then you do not need to provide them for other classes.

To index all keys on all objects using UUIDs as ids and `#` as the id key, call `db.defineSchema(Object)`.

*Note*: All operations returning an object attempt to create an instance of the object's original class if a schema is defined.

#### db.getSchema(value:string|object,create:boolean) - returns object representing schema

Returns the schema for the class of the object or `undefined`.

If `create` is `true` and `value` is an object and no schema exists, a schema is created and returned.

#### async db.getRangeFromIndex(indexMatch:object,?valueMatch:function|object,?select:function|object,{cname,sortable,fulltext,sort:boolean|function,versions,offset,limit=||Infinity}=?options={}) - returns AsyncIterableIterator

Yields objects of the form `{key,value,count,version}` where `key` is the key of the object, `value` is the object in the database, `count` is the number of index matches, `version` is the version number and is only present if the database was opened using versioning.

`indexMatch` is an object with keys that may be serialized RegExp and values that may be literals, or RegExp or functions that return non-undefined values or `DONE`. For example:

```javascript
{
    name: /bil.*/,
    age: $gte(21), // this is the same as (value) => value>=21 ? value : undefined,
    address: {
        city: "New York"
    },
    [/.*Identifier/]: (value) => value!=null ? value : undefined
}
```

The standard form for functions used in queries is `(value) => ... some code that returns a value or undefined or DONE`. These can be quite verbose, so over 60 pre-built functions are provided in the section [Operators](#operators).

`valueMatch` defaults to the same value as `indexMatch` because some of the processing required can't actually be done against indexes, underlying values must be retrieved. However, it can also be a function that accepts a candidate match and returns the candidate if is satisfies certain conditions or `undefined` if not. Or, it can be a different pattern matching object that is perhaps more restrictive.

`select` is a function or object that is used to select which properties of the object are returned. If `select` is an object, then the properties of the `select` are used as keys to select properties from the match. The properties may be serialized RegExp. The values of these properties can be literals, RegExp, or functions. 

Functions returning `undefined` or RegExp and literals that do not match drop properties. Make sure RegExp that are used for values contain a selection group. Functions are called with the object as the first argument and `{root,parent,key}` as the second. For example:

```javascript
{
    name: (value,{root}) => { root.firstInitial = value.match(/(.).*/)[1] }
    [/.*Identifier/]: (value) => value!=null ? value : undefined
}
```

`cname` is the name of the class to query. It defaults to the constructor name of the `indexMatch` except if `indexMatch` is just an `Object`. If `indexMatch` is an `Object` and no `cname` is provided, then the match is done across multiple classes, e.g.

```javascript
class Person { constuctor(config={}) { Object.assign(this,config); } }
class Pet { constuctor(config={}) { Object.assign(this,config); } }
db.defineSchema(Person);
db.defineSchema(Pet);
await db.put(null,new Person({name:"bill",age:21}));
await db.put(null,new Pet({name:"bill",age:2}));
[...db.getRangeFromIndex({name:"bill"})].forEach((object) => {
    console.log(object); // logs both the Person and the Pet
});
[...db.getRangeFromIndex({name:"bill"},null,null,{cname:"Person"})].forEach((object) => {
    console.log(object); // logs just the Person
});
```

`sortable`, `'fulltext`, and `sort` start returning entries almost immediately based on partial index matches.

`sortable` and `fulltext` return entries in the order they are indexed.

`fulltext` (short for full text index), returns entries that have partial matches for string property values. To fully utilize `fulltext`, ensure the database is opened and entries have been indexed with `{indexOptions:{fulltext:true}}`.
For example:

```javascript
const db = open("test",{indexOptions:{fulltext:true}});
db.put(null,{name:"bill",address:{city:"New York",state:"NY"}});
db.put(null,{name:"joe",address:{city:"York",state:"PA"}});
[...db.getRangeFromIndex({address:{city:"York"}},null,null,{fulltext:true})].forEach((person) => {
    console.log(person); // logs both bill and joe
});
```

Note: When `{indexOptions:{fulltext:true}}` is set, passing functions as property values in `indexMatch` causes an index scan that may be expensive.

If `sort` is `true` entries are returned based on how many index matches occurred, with the highest first. If `sort` is a function, then entries are returned in the order determined by the function. Note, both of these are expensive since they require resolving all matches first.


#### async db.move(key:lmdbKey,destKey:lmdbKey,?overwrite:boolean,?version:number,?ifVersion:number) - returns LMDBKey|undefined

Works similar to [lmdb-move](https://github.com/anywhichway/lmdb-move) but provides automatic key assignment and indexing.

Works the same as `copy` above, except the entry at the original `key` is removed inside the transaction.

#### async db.patch(key:string,patch:object,?version,?ifVersion) - returns boolean

Inside a single transaction, updates the index after the patch.

Also see [lmdb-patch](https://github.com/anywhichway/lmdb-patch)

#### async db.put(key:LMDBKey,value,?cname,?version,?ifVersion) - returns LMDBKey|undefined

Works similar to [lmdb put](https://github.com/kriszyp/lmdb-js#dbputkey-value-version-number-ifversion-number-promiseboolean)

If `value` is an object, it will be indexed by the keys of the object so long as it is an instance of an object controlled by a schema declared with `defineSchema`. To index all top level keys on all objects, call `db.defineSchema(Object)`. If `key` is `null`, a unique id will be generated and added to the object. See [defineSchema](#async-defineschemaclassconstructor-options) for more information.

When putting an object for indexing, the `key` should eb `null`. It is retrieved from the object using the `idKey` of the schema. If there is a mismatch between the `key` and the `idKey` of the object, an Error will be thrown.

The `cname` argument is used to specify the class name of the object being put. If `cname` is not provided, the class name is determined by the constructor name of the `value` argument. This allows the developer to use plain objects. If `value` is a primitive, `cname` is ignored.

If there is a mismatch between the `key` and the `idKey` of the object, an Error will be thrown.

The `key` or in the case of objects the object id is returned if the transaction succeeds, otherwise `undefined` is returned.

See `db.index` to avoid the need for a `null` first argument and more information.

#### async db.remove(key:LMDBKey,?version:number,?ifVersion:number) - returns LMDBKey|undefined

Same behavior as `lmdb` except that the index entries are removed inside a transaction

#### withExtensions(db:LMDBDatabase,?extensions:object) - returns LMDBDatabase`

Extends an LMDB database and any child databases it opens to have the `extensions` provided as well as any child databases it opens. This utility is common to other `lmdb` extensions like `lmdb-patch`, `lmdb-copy`, `lmdb-move`.

Automatically adds `copy`, `getRangeFromIndex`, `index`, `indexSync`, `move`, `patch` and modified behavior of `put`, `putSync`,`remove` and `removeSync`.

## Operators

The following operators are supported in `indexMatch`, `valueMatch` and `select`.

#### Logical

* `$and(...operatorResult)` - logical and
* `$or(...operatorResult))` - logical or
* `$not(...operatorResult))` - logical not

#### Comparison

* `$lt(boolean|number|string)` - less than
* `$lte(boolean|number|string)` - less than or equal to
* `$gt(boolean|number|string)` - greater than
* `$gte(boolean|number|string)` - greater than or equal to
* `$eq(boolean|number|string)` - equal to
* `$eeq(boolean|number|string)` - equal to and same type, e.g. `1` is not equal to `'1'
* `$neq(boolean|number|string)` - not equal to
* `$between(boolean|number|string,boolean|number|string)` - property value is between the two values (inclusive)
* `$outside(boolean|number|string,boolean|number|string)` - property value is not between the two values (exclusive)

#### String

* `$startsWith(string)` - property value starts with string
* `$endsWith(string)` - property value ends with string
* `$matches(RegExp)` - property value matches regular expression
* `$echoes(string)` - property value sounds like the `string`

#### Arrays and Sets

* `$in(array)` - property value is in array
* `$nin(array)` - property values is not in array
* `$includes(boolean|number|string|null)` - property value is an array and includes value
* `$excludes(boolean|number|string|null)` - property value is an array and does not include value
* `$intersects(array)` - property value is an array and intersects with array
* `$disjoint(array)` - property value is an array and does not intersect with array
* `$subset(array)` - property value is an array and is a subset of array
* `$superset(array)` - property value is an array and is a superset of array
* `$symmetric(array)` - property value is an array and has same elements as array

#### Basic Types

* `$type(typeName:string)` - property value is of `typeName` type
* `$isOdd()` - property value is odd
* `$isEven()` - property value is even
* `$isPrime()` - property value is prime
* `$isComposite()` - property value is composite
* `$isPositive()` - property value is positive
* `$isNegative()` - property value is negative
* `$isInteger()` - property value is an integer
* `$isFloat()` - property value is a float
* `$isNaN()` - property value is not a number
* `$isArray()` - property value is an array
* `$isObject()` - property value is an object
* `$isPrimitive()` - property value is a primitive
* `$isUndefined()` - property value is undefined
* `$isNull()` - property value is null
* `$isTruthy()` - property value is truthy
* `$isFalsy()` - property value is falsy

#### Extended Types

* `$isCreditCard()` - property value is a credit card number
* `$isEmail()` - property value is an email address
* `$isHexColor()` - property value is a hex color
* `$isIPV4Address()` - property value is an IP address
* `$isIPV6Address()` - property value is an IP address
* `$isISBN()` - property value is an ISBN
* `$isMACAddress()` - property value is a MAC address
* `$isURL()` - property value is a URL
* `$isUUID()` - property value is a UUID
* `$isZIPCode()` - property value is a ZIP code


# Testing

Testing conducted with `jest`.

File      | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------|---------|----------|---------|---------|------------------------
All files       |   89.64 |    84.69 |   95.58 |   92.87 |
lmdb-index     |    87.6 |    78.75 |   91.17 |   91.56 |
index.js      |    87.6 |    78.75 |   91.17 |   91.56 | 54-56,116,179,244-276,309,456,475,540,563,613-614
lmdb-index/src |     100 |    98.96 |     100 |     100 |
operators.js  |     100 |    98.96 |     100 |     100 | 14,190

# Release Notes (Reverse Chronological Order)

During ALPHA and BETA, the following semantic versioning rules apply:

* The major version will be zero.
* Breaking changes or feature additions will increment the minor version.
* Bug fixes and documentation changes will increment the patch version.

2023-05-19 v0.11.0 Added an index to better support queries where the value is known but properties might be ambiguous.

2023-05-19 v0.10.2 Fixed issues related to `indexOptions` not being passed in when database opened.

2023-05-19 v0.10.1 Refined operator functions that are order dependent so they return `DONE` after upper bound. `db.clearAsync` and `db.clearSync` now clear indexes. `db.putSync` returning Promise. Corrected v0.9.1 and v0.9.0 dates below. Minor modifications to index structure. `db.index` and `db.indexSync` will be deprecated prior to v1, use `db.put(null,object)` or `db.putsync(null,object)` instead.. BREAKING CHANGE: Fulltext indexing must now be enabled with `indexOptions:{fulltext:true}` when opening a database.

2023-05-17 v0.9.1 Removed un-necessary files from npm package.

2023-06-17 v0.9.0 Added unit tests. Addressed issue with RegExp and select. `$echoes` now handles numbers. Added some performance benchmarks.

2023-05-16 v0.8.1 Added unit tests. Addressed issue with nested object indexing and matching keys with RegExp.

2023-05-15 v0.8.0 Updated documentation. Corrected issue with `indexKeys` on schema not being processed, select processing not handling `root` assignment and removal of unselected properties. Supplied a range of pre-built operator functions for index and value matching.

2023-05-14 v0.7.3 Added unit tests. Corrected issues with: copy not adding id to objects that have no schema, selecting objects of multiple class types at the same time, select support being dropped during an earlier upgrade, sort as function. Updated documentation.

2023-05-14 v0.7.2 Updated documentation.

2023-05-13 v0.7.1 Updated documentation. Not yet documented, built in full-text indexing and search.

2023-05-13 v0.7.0 Reworked indexing to simplify, improve speed and support full text indexing.

2023-05-06 v0.6.6 Removed test db from Git.

2023-05-05 v0.6.5 Fixed issue with not removing un-indexed primitives.

2023-05-05 v0.6.4 Updated `lmdb-query` to 1.5.4. Fixed issue with `put` not awaiting.

2023-05-05 v0.6.3 Updated `lmdb-query` to 1.5.3.

2023-05-04 0.6.2 Updated dependencies. 

2023-05-03 v0.6.1 Addressed issue where properties with non-primitve values were not being indexed.

2023-05-02 v0.6.0 Added support for storing plain arrays as top level database entries, e.g. `await db.put(null,[1,2,3])`

2023-04-29 v0.5.1 Adjusted `defineSchema` so that it updates rather than overwrites definition if called a second time. Updated dependency versions. Adjusted unit tests. Fixed issues with `copy` and `move` not calling underlying code with `this` context. Unit test coverage over 90%, moving to BETA.

2023-04-28 v0.5.0 Added `getSchema` to exports. Enhanced unit tests.

2023-04-28 v0.4.3 Adjusted to use `withextensions` from `lmdb-query`. Enhanced documentation.

2023-04-27 v0.4.2 Added support for patch. Simplified `withExtensions` use. Enhanced documentation.

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