import {open} from "lmdb";
import {
    withExtensions,
    ANYCNAME,
    copy,
    defineSchema,
    get,
    getRangeFromIndex,
    getSchema,
    move,
    patch,
    put, remove
} from "./index.js";

class Message {
    constructor(props) {
        Object.assign(this,props);
    }
}

class Person {
    constructor(props) {
        Object.assign(this,props);
    }
}

class Unindexed {
    constructor(props) {
        Object.assign(this,props);
    }
}

const db = withExtensions(open("test.db",{useVersions:true}));
db.clearSync();
db.defineSchema(Message);
const personSchema = db.defineSchema(Person);
await db.put("Unindexed@1",new Unindexed({name:"joe"}));
await db.put(null,new Unindexed({name:"joe"}));
await db.put(null,new Message({message:"goodbye","#":1}));
await db.put(null,new Message({message:"hello","#":2}));
const personId = await db.put(null,new Person({name:"joe",age:21,address:{city:"New York",state:"NY"}}));
await db.committed;

["copy","defineSchema","get","getRangeFromIndex","getSchema","move","patch","put","remove"].forEach((fname) => {
    test(`has ${fname}`,() => {
        expect(typeof db[fname]).toBe("function")
    })
})

test("correct id",async () => {
    expect(personId.startsWith("Person@")).toBe(true);
})

test("redefine Schema",() => {
    const schema = db.defineSchema(personSchema.ctor);
    expect(schema).toBe(personSchema)
})

test("getRangeFromIndex",async () => {
    let result = [...db.getRangeFromIndex({message:"hello"},null,null,{cname:"Message"})];
    expect(result).toEqual([{key:"Message@2",value:{"#":"Message@2",message:"hello",}}]);
    result = [...db.getRangeFromIndex({message(value) { return value!=null}},null,null,{cname:"Message"})];
    expect(result).toEqual([{key:"Message@1",value:{message:"goodbye","#":"Message@1"}},{key:"Message@2",value:{message:"hello","#":"Message@2"}}]);
    result = [...db.getRangeFromIndex({message(value) { return value!=null}},(value) => value.message==="goodbye" ? value : undefined,true,{cname:"Message"})];
    expect(result).toEqual([{key:"Message@1",value:{message:"goodbye"}}]);
   const all = [...db.getRangeFromIndex({message(value) { return value!=null}},null,null,{cname:ANYCNAME})];
   expect(all.length).toBe(2);
    await db.remove("Message@1");
    expect([...db.getRangeFromIndex({message:(value) => value!=null},null,null,{cname:"Message"})]).toEqual([{key:"Message@2",value:{message:"hello","#":"Message@2"}}]);
    expect([...db.getRangeFromIndex({message:(value) => value!=null},undefined,(value) => value.message,{cname:"Message"})]).toEqual([{key:"Message@2",value:"hello"}]);
    result = [...db.getRange({start:[null]})];
    expect(result.some(({key})=>key?.includes("Message@2"))).toBe(true);
    expect(result.some(({key})=>key?.includes("Message@1"))).toBe(false);
})
test("getRangeFromIndex autoid",async () => {
    const items = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    expect(items.length).toBe(1);
    expect(items[0].value.name).toBe("joe");
    expect(items[0].value).toBeInstanceOf(Person);
})
test("move object",async () => {
    let items = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    const key = items[0].value["#"];
    const id = await db.move(key,null);
    items = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    expect(items.length).toBe(1);
    expect(items[0].value["#"]).not.toBe(key);
    expect(items[0].value["#"]).toBe(id);
    expect(db.get(key)).toBe(undefined);
})
test("copy and patch object",async () => {
    let items = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    const id = await db.copy(items[0].value["#"],null);
    items = [...db.getRangeFromIndex({name:"joe"},null,null,{cname:"Person"})];
    expect(items.length).toBe(2);
    await db.patch(id,{age:20});
    const item = db.get(id);
    expect(item.age).toBe(20);
    items = [...db.getRangeFromIndex({age:20},null,null,{cname:"Person"})];
    expect(items.length).toBe(1);
    expect(items[0].value.age).toBe(20);
})
test("copy unindexed instance",async () => {
    const id = await db.copy("Unindexed@1");
    expect(id.startsWith("Unindexed@")).toBe(false)
})
test("copy unindexed instance with key",async () => {
    const id = await db.copy("Unindexed@1","unindexed");
    expect(id).toBe("unindexed");
})

test("copy unindexed overwrite throws",async () => {
    try {
        await db.copy("Unindexed@1","unindexed")
    } catch(e) {
        return;
    }
    throw new Error("copy overwrite did not throw")
})

test("copy unindexed overwrite throws",async () => {
    const id = await db.copy("Unindexed@1","unindexed",true);
    expect(id).toBe("unindexed");
})

test("move unindexed instance",async () => {
    const id = await db.move("Unindexed@1","Unindexed@2");
    expect(id).toBe("Unindexed@2")
})

test("move unindexed overwrite throws",async () => {
    try {
        await db.move("Unindexed@2","unindexed")
    } catch(e) {
        return;
    }
    throw new Error("move overwrite did not throw")
})

test("move unindexed overwrite throws",async () => {
    const id = await db.copy("Unindexed@2","unindexed",true);
    expect(id).toBe("unindexed");
})

test("move unindexed instance autokey",async () => {
    const id = await db.move("unindexed");
    expect(id).toBeTruthy()
})

test("handle array creation",async () => {
    db.defineSchema(Array);
    const id = await db.put(null,[1,2,3]);
    expect(db.get(id)).toEqual([1,2,3]);
    const items = [...db.getRangeFromIndex({0:1},null,null,{cname:"Array"})];
    expect(items.length).toBe(1);
    expect(items[0].value).toEqual([1,2,3]);
})



