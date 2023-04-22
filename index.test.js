import {open} from "lmdb";
import {defineSchema,put,remove,getRangeFromIndex,withExtensions} from "./index.js";

const db = withExtensions(open("test.db",{useVersions:true}),{defineSchema,put,remove,getRangeFromIndex});
db.clearSync();
db.defineSchema(Object);
await db.put(null,{message:"goodbye","#":1});
await db.put(null,{message:"hello","#":2});
await db.put(null,{name:"joe",age:21,address:{city:"New York",state:"NY"}});

test("getRangeFromIndex",async () => {
    expect([...db.getRangeFromIndex({message:"hello"})]).toEqual([{key:"2",value:{message:"hello","#":"2"},version:0}]);
    expect([...db.getRangeFromIndex({message(value) { return value!=null}})]).toEqual([{key:"1",value:{message:"goodbye","#":"1"},version:0},{key:"2",value:{message:"hello","#":"2"},version:0}]);
    expect([...db.getRangeFromIndex({message(value) { return value!=null}},(value) => value.message==="goodbye" ? value : undefined,true)]).toEqual([{key:"1",value:{message:"goodbye"}}]);
    await db.remove("1");
    expect([...db.getRangeFromIndex({message:(value) => value!=null})]).toEqual([{key:"2",value:{message:"hello","#":"2"},version:0}]);
    expect([...db.getRangeFromIndex({message:(value) => value!=null},undefined,(value) => value.message)]).toEqual([{key:"2",value:"hello",version:0}]);
})
test("getRangeFromIndex autoid",async () => {
    const items = [...db.getRangeFromIndex({name:"joe"})];
    expect(items.length).toBe(1);
    expect(items[0].value.name).toBe("joe");
})