import {open} from "lmdb";
import {withExtensions} from "./index.js";

const benchmark = await import("./node_modules/benchmark/benchmark.js"),
    Benchmark = benchmark.default;

/*const db = Object.assign(open("test.db",{noMemInit:true}),{
    defineSchema,
    getSchema,
    index,
    indexSync,
    getRangeFromIndex
})
 */


const db = withExtensions(open("test.db",{noMemInit:true}));

class Person {
    constructor(config) {
        Object.assign(this,structuredClone(config));
    }
}

db.indexDB = db.openDB("index",{noMemInit:true,dupSort:true,encoding:"ordered-binary"}); //,
db.clearSync();
db.indexDB.clearSync();
const now = new Date(),
    personSchema = db.defineSchema(Person),
    person = {name:"joe",age:21,address:{city:"New York",state:"NY"},created:now,aRegExp:/abc/},
    personId = await db.indexSync({...person},"Person");

test("redefine Schema",() => {
    const schema = db.defineSchema(personSchema.ctor);
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
    const id = await db.putSync(null, {});
    expect(id).toBeUndefined();
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

test("getRangeFromIndex - with RegExp fail",() => {
    const range = [...db.getRangeFromIndex({name:/bill/},null,null,{cname:"Person"})];
    expect(range.length).toBe(0);
})

test("getRangeFromIndex - fail",() => {
    const range = [...db.getRangeFromIndex({name:"joe",pronoun:"he"},null,null,{cname:"Person"})];
    expect(range.length).toBe(0);
})

test("getRangeFromIndex - sortable",() => {
    const range = [...db.getRangeFromIndex({name:"joe",pronoun:"he"},null,null,{cname:"Person",sortable:true})];
    expect(range.length).toBe(1);
    expect(range[0].value).toBeInstanceOf(Person);
    delete range[0].value["#"];
    expect(range[0].value).toEqual(person);
})

test("put",async () => {
    const p = new Person(person),
        id = await db.putSync(null,p);
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

test("patch",async () => {
    const result = await db.patch(personId,{age:22});
    expect(result).toBe(true);
    const value = db.get(personId);
    expect(value).toBeInstanceOf(Person);
    expect(value.age).toBe(22);
    const range = [...db.getRangeFromIndex({age:22},null,null,{cname:"Person"})];
    expect(range.length).toBe(1);
    expect(range.every((item) => item.value instanceof Person && item.value.age===22)).toBe(true);
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







