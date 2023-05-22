import {open} from "lmdb";
import {withExtensions,operators} from "./index.js";

const {$lt,$gt,$gte,$eq,$neq,$and,$or,$not} = operators;

const db = withExtensions(open("test.db",{useVersions:true,indexOptions:{fulltext:true}}));

class Person {
    constructor(config) {
        Object.assign(this,structuredClone(config));
    }
}

db.clearSync();
const now = new Date(),
    personSchema = db.defineSchema(Person,{indexKeys:["name","age","address.city","address.state","created","aRegExp"]}),
    person = {name:"joe",age:21,address:{city:"New York",state:"NY"},created:now,aRegExp:/abc/,"unindexed":"unindexed"};
let personId;

test("put returns id",async () => {
    const id = await db.put(null,{...person,"#":"Person@1"},"Person");
    personId = id;
    expect(id).toBe("Person@1");
});

test("index returns id",async () => {
    const id = await db.index({...person,"#":"Person@1"},"Person");
    personId = id;
    expect(id).toBe("Person@1");
});


test("putSync returns key",async () => {
    const id = db.putSync(null,{...person,"#":"Person@1"},"Person");
    personId = await id;
    expect(id).toBe("Person@1");
});

test("putSync primitive returns key",async () => {
    const key = db.putSync("one",1);
    expect(key).toBe("one");
})

test("getRangeFromIndex - scan",() => {
    const range = [...db.getRangeFromIndex({unindexed:"unindexed"},null,null,{cname:"Person",scan:true})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})

test("redefine Schema",() => {
    const schema = db.defineSchema(personSchema.ctor,{indexKeys:["name","age","address.city","address.state","created","aRegExp"]});
    expect(schema).toBe(personSchema)
})

test("getSchema - from string",() => {
    const schema = db.getSchema("Person");
    expect(schema).toBe(personSchema)
})

test("getSchema - from instance",() => {
    const schema = db.getSchema(new Person());
    expect(schema).toBe(personSchema)
})

test("getSchema fail - from string",() => {
    const schema = db.getSchema("Object");
    expect(schema).toBeUndefined()
})

test("getSchema fail - from instance",() => {
    const schema = db.getSchema({});
    expect(schema).toBeUndefined()
})

test("put un-indexed",async () => {
    const id = await db.put(null, {});
    expect(id).toBeDefined();
})

test("get",() => {
    const value = db.get(personId);
    expect(value["#"]).toBe(personId);
    expect(value["#"].startsWith("Person@")).toBe(true);
    expect(value).toBeInstanceOf(Person);
    delete value["#"];
    expect(value.created.getTime()).toBe(person.created.getTime());
    delete value.created;
    expect(value.aRegExp).toBeInstanceOf(RegExp);
    expect(value.aRegExp.toString()).toBe(person.aRegExp.toString());
    delete value.aRegExp;
    const p = {...person};
    delete p.created;
    delete p.aRegExp;
    expect(value).toEqual(p);
})

test("getRangeFromIndex",() => {
    const range = [...db.getRangeFromIndex({name:"joe",age:21},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})


test("getRangeFromIndex with operator",() => {
    const range = [...db.getRangeFromIndex({name:$or($eq("joe"),$neq("joe")),age:$and($gte(21),$gt(20))},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})

test("getRangeFromIndex with upper bound operator",async () => {
    const id = await db.put(null,new Person({age:24}));
    const range = [...db.getRangeFromIndex({age:$lt(24)},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
    db.removeSync(id);
})

test("getRangeFromIndex with $not operator",() => {
    const range = [...db.getRangeFromIndex({name:$not($eq("bill"))},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.name!=="bill").toBeTruthy()
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})

test("getRangeFromIndex with select",() => {
    const range = [...db.getRangeFromIndex({name:/joe/,age:21},null, {
        name(value,{root}) {
            root.firstInitial = value.match(/(.).*/)[1]
        },
        age:(value)=>value,
        created:now
    },{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.firstInitial).toBe("j");
    expect(range[0].value.age).toBe(21);
    expect(range[0].value.created.getTime()).toBe(now.getTime());
    expect(Object.keys(range[0].value).length).toBe(3);
})

test("getRangeFromIndex with select with RegExp",() => {
    const range = [...db.getRangeFromIndex({name:/joe/,age:21},null, {
        name:/(joe)/,
        [/age/]:(value)=>value,
        created:now
    },{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.name).toBe("joe");
    expect(range[0].value.age).toBe(21);
    expect(range[0].value.created.getTime()).toBe(now.getTime());
    expect(Object.keys(range[0].value).length).toBe(3);
})

test("getRangeFromIndex with select with RegExp - delete RegExp property",() => {
    const range = [...db.getRangeFromIndex({name:/joe/,age:21},null, {
        name:/(joe)/,
        [/age/]:()=>undefined,
        created:now
    },{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.name).toBe("joe");
    expect(range[0].value.age).toBeUndefined();
    expect(range[0].value.created.getTime()).toBe(now.getTime());
    expect(Object.keys(range[0].value).length).toBe(2);
})

test("getRangeFromIndex - with function",() => {
    const range = [...db.getRangeFromIndex({name:"joe",age:(value) => value===21 ? value : undefined},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.age).toBe(21);
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})

test("getRangeFromIndex - with function fail",() => {
    const range = [...db.getRangeFromIndex({name:"joe",age:(value) => value===22 ? value : undefined},null,null,{cname:"Person"})];
    expect(range.length).toBe(0);
})

test("getRangeFromIndex - with RegExp",() => {
    const range = [...db.getRangeFromIndex({name:/joe/},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.name).toBe("joe");
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})

test("getRangeFromIndex - with RegExp Key",() => {
    const range = [...db.getRangeFromIndex({[/name/]:"joe"},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.name).toBe("joe");
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})

test("getRangeFromIndex - with RegExp Key nested",() => {
    const range = [...db.getRangeFromIndex({[/address/]: {city:"New York"}},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.address.city).toBe("New York");
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})

test("getRangeFromIndex - with RegExp Key nested fail",() => {
    const range = [...db.getRangeFromIndex({address: {city:"New York"}},{[/address/]: {city:()=>undefined}},null,{cname:"Person"})];
    expect(range.length).toBe(0);
})

test("getRangeFromIndex - with value match",() => {
    const range = [...db.getRangeFromIndex({name:"joe"}, {created:now},null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.created.getTime()).toBe(now.getTime());
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})

test("getRangeFromIndex - with RegExp fail",() => {
    const range = [...db.getRangeFromIndex({name:/bill/},null,null,{cname:"Person"})];
    expect(range.length).toBe(0);
})

test("getRangeFromIndex - fail",() => {
    const range = [...db.getRangeFromIndex({name:"joe",pronoun:"he"},null,null,{cname:"Person"})];
    expect(range.length).toBe(0);
})

test("getRangeFromIndex - sortable",() => {
    const range = [...db.getRangeFromIndex({name:"joe",pronoun:"he"},null, {name:"joe"},{cname:"Person",sortable:true})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.name).toBe("joe");
    expect(Object.keys(range[0].value).length).toBe(1);
})

test("getRangeFromIndex - fulltext",async () => {
    const ids = [await db.put(null,new Person({name:"john jones"})),
            await db.put(null,new Person({name:"john johnston"})),
            await db.put(null,new Person({name:"john johnson"}))];
    const range = [...db.getRangeFromIndex({name:"john johnson"},null, null,{cname:"Person",fulltext:true})];
    expect(range.length).toBe(3);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range.every((item) => item.value.name.startsWith("john"))).toBe(true);
    for(const id of ids) {
        await db.remove(id)
    }
})


test("getRangeFromIndex - fulltext all",async () => {
    const ids = [await db.put(null,new Person({name:"john jones"})),
        await db.put(null,new Person({name:"john johnston"})),
        await db.put(null,new Person({name:"john johnson"}))];
    const range = [...db.getRangeFromIndex({name:"john johnson"},null, null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range[0].value.name).toBe("john johnson");
    for(const id of ids) {
        await db.remove(id)
    }
})

test("getRangeFromIndex - fulltext pct",async () => {
    const ids = [await db.put(null,new Person({name:"john andrew jones"})),
        await db.put(null,new Person({name:"john johnston"})),
        await db.put(null,new Person({name:"john johnson"}))];
    const range = [...db.getRangeFromIndex({name:"john andrew johnson"},null, null,{cname:"Person",fulltext:.5})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    expect(range.every((item) => item.value.name.startsWith("john"))).toBe(true);
    for(const id of ids) {
        await db.remove(id)
    }
})

test("put no index",async () => {
    const range = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})],
        p = {...person},
        id = await db.put("noindex",p);
    expect(id).toBe("noindex");
    const value = db.get(id);
    delete value["#"];
    expect(value).toEqual(person);
    expect([...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})].length).toBe(range.length);
})

test("put no index - throws",async () => {
    let error;
    const p = new Person({...person,"#": "DummyId"});
    try {
        await db.put("noindex",p)
    } catch(e) {
        error = e;
    }
    expect(error).toBeInstanceOf(Error);
})

test("putSync no index - throws",async () => {
    let error;
    const p = new Person({...person,"#": "DummyId"});
    try {
        await db.putSync("noindex",p)
    } catch(e) {
        error = e;
    }
    expect(error).toBeInstanceOf(Error);
})

test("put and index object",async () => {
    const p = new Person({...person}),
        id = await db.put(null,p);
    expect(id.startsWith("Person@")).toBe(true);
    const value = db.get(id);
    expect(value).toBeInstanceOf(Person);
    delete p.created;
    delete p.aRegExp;
    delete value.created;
    delete value.aRegExp;
    expect(value).toEqual(p);
    const range = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    expect(range.length).toBe(2);
    expect(range.every((item) => item.value instanceof Person)).toBe(true);
})


test("offset",() => {
    const p = new Person(person),
        range = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person",offset:1})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    delete range[0].value["#"];
    delete range[0].value.created;
    delete range[0].value.aRegExp;
    delete p.created;
    delete p.aRegExp;
    expect(range[0].value).toEqual(p);
})

test("offset sortable",() => {
    const p = new Person(person),
        range = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person",sortable:true,offset:1})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    delete range[0].value["#"];
    delete range[0].value.created;
    delete range[0].value.aRegExp;
    delete p.created;
    delete p.aRegExp;
    expect(range[0].value).toEqual(p);
})

test("copy",async () => {
    const id = await db.copy(personId);
    expect(id.startsWith("Person@")).toBe(true);
    const value = db.get(id);
    expect(value).toBeInstanceOf(Person);
    delete value["#"];
    const p = {...person};
    delete p.created;
    delete value.created;
    expect(value).toEqual(p);
    const range = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    expect(range.length).toBe(3);
    expect(range.every((item) => item.value instanceof Person)).toBe(true);
})

test("copy schemaless object auto id",async () => {
    const id = await db.put(null,{name:"joe",age:21}),
        newid  = await db.copy(id),
        value = db.get(newid);
    expect(value).toEqual({name:"joe",age:21,"#":newid});
})

test("copy primitive",async () => {
    const id = await db.put("myfirstprimitive",1),
        newid  = await db.copy("myfirstprimitive","mysecondprimitive"),
        value = db.get("mysecondprimitive");
    expect(id).toBe("myfirstprimitive");
    expect(newid).toBe("mysecondprimitive");
    expect(value).toBe(1);
})

test("patch",async () => {
    const result = await db.patch(personId,{age:22,created:new Date()});
    expect(result).toBe(true);
    const value = db.get(personId);
    expect(value).toBeInstanceOf(Person);
    expect(value.age).toBe(22);
    const range = [...db.getRangeFromIndex({name:"joe",age:22},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range.every((item) => item.value instanceof Person && item.value.age===22)).toBe(true);
})

test("patch fail",async () => {
    const result = await db.patch(personId,{age:22,created:new Date()},1,1);
    expect(result).toBe(false);
})

test("patch schemaless object",async () => {
    const id = await db.put(null,{name:"joe",age:21}),
        result = await db.patch(id,{age:22}),
        value = db.get(id);
    expect(result).toBe(id);
    expect(value).toEqual({name:"joe",age:22,"#":id});
})

test("move",async () => {
    const id = await db.move(personId,"Person@joe");
    expect(id).toBe("Person@joe");
    const range = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    expect(range.length).toBe(3);
    expect(range.every((item) => item.value instanceof Person && item.value["#"]!==personId)).toBe(true);
})

test("remove",async () => {
    const id = await db.remove("Person@joe");
    expect(id).toBe("Person@joe");
    const range = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    expect(range.length).toBe(2);
    expect(range.every((item) => item.value instanceof Person && item.value["#"]!=="Person@joe")).toBe(true);
})

test("removeSync",async () => {
    const id = await db.put(null,{...person});
    expect(db.get(id)).toBeTruthy()
    db.removeSync(id);
    expect(db.get(id)).toBeFalsy();
    const range = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    expect(range.length).toBe(2);
    expect(range.every((item) => item.value instanceof Person && item.value["#"]!==id)).toBe(true);
})

test("autocreate schema",async () => {
    class Book {
        constructor(config) {
            Object.assign(this,config)
        }
    }
    const schema = db.getSchema(new Book(),true);
    expect(schema).toBeInstanceOf(Object);
    expect(schema.ctor.name).toBe("Book");
})

test("get object of class with similar attributes",async () => {
    class Book {
        constructor(config) {
            Object.assign(this,config)
        }
    }
    const schema = db.defineSchema(Book),
        book = new Book({name:"joe"});
    const id = await db.put(null,book);
    const range1 = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Book"})];
    expect(range1.length).toBe(1);
    const range2 = [...db.getRangeFromIndex({name:"joe"})];
    expect(range2.length).toBe(3);
    expect(range2.some((item) => item.value instanceof Book || item.value instanceof Person)).toBe(true);
})

test("clearSync",async () => {
    const id = await db.put(null,{...person},"Person");
    db.clearSync();
    expect(db.get(id)).toBe(undefined);
    expect([...db.propertyIndex.getRange()].length).toBe(0);
    expect([...db.valueIndex.getRange()].length).toBe(0);
})

test("clearAsync",async () => {
    const id = await db.put(null,{...person});
    await db.clearAsync();
    expect(db.get(id)).toBe(undefined);
    expect([...db.propertyIndex.getRange()].length).toBe(0);
    expect([...db.valueIndex.getRange()].length).toBe(0);
})







