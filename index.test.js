import {open} from "lmdb";
import {defineSchema,put,remove,getRangeFromIndex,withExtensions,ANYCNAME} from "./index.js";

const db = withExtensions(open("test.db",{useVersions:true}),{defineSchema,put,remove,getRangeFromIndex});
db.clearSync();
db.defineSchema(Object);
await db.put(null,{message:"goodbye","#":1});
await db.put(null,{message:"hello","#":2});
await db.put(null,{name:"joe",age:21,address:{city:"New York",state:"NY"}});

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
})
test("getRangeFromIndex autoid",async () => {
    const items = [...db.getRangeFromIndex({name:"joe"})];
    expect(items.length).toBe(1);
    expect(items[0].value.name).toBe("joe");
})