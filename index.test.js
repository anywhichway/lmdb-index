import {open} from "lmdb";
import {withExtensions,ANYCNAME} from "./index.js";

class Person {
    constructor(props) {
        Object.assign(this,props);
    }
}

const db = withExtensions(open("test.db",{useVersions:true}));
db.clearSync();
db.defineSchema(Object);
db.defineSchema(Person);
await db.put(null,{message:"goodbye","#":1});
await db.put(null,{message:"hello","#":2});
await db.put(null,new Person({name:"joe",age:21,address:{city:"New York",state:"NY"}}));

test("getRangeFromIndex",async () => {
    let result = [...db.getRangeFromIndex({message:"hello"})];
    expect(result).toEqual([{key:"Object@2",value:{message:"hello","#":"Object@2"}}]);
    result = [...db.getRangeFromIndex({message(value) { return value!=null}})];
    expect(result).toEqual([{key:"Object@1",value:{message:"goodbye","#":"Object@1"}},{key:"Object@2",value:{message:"hello","#":"Object@2"}}]);
    result = [...db.getRangeFromIndex({message(value) { return value!=null}},(value) => value.message==="goodbye" ? value : undefined,true)];
    expect(result).toEqual([{key:"Object@1",value:{message:"goodbye"}}]);
   const all = [...db.getRangeFromIndex({message(value) { return value!=null}},null,null,{cname:ANYCNAME})];
   expect(all.length).toBe(2);
    await db.remove("Object@1");
    expect([...db.getRangeFromIndex({message:(value) => value!=null})]).toEqual([{key:"Object@2",value:{message:"hello","#":"Object@2"}}]);
    expect([...db.getRangeFromIndex({message:(value) => value!=null},undefined,(value) => value.message)]).toEqual([{key:"Object@2",value:"hello"}]);
    result = [...db.getRange({start:[null]})];
    expect(result.some(({key})=>key.includes("Object@1"))).toBe(false);
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
