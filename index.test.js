import {open} from "lmdb";
import {withExtensions,put,getRangeFromIndex} from "./index.js";

const db = withExtensions(open("test.db",{useVersions:true}),{put,getRangeFromIndex});
db.clearSync();
await db.put(null,{message:"goodbye","#":1});
await db.put(null,{message:"hello","#":2});
console.log([...db.getRangeFromIndex({message:"hello"})]);
console.log([...db.getRangeFromIndex({message:(value) => value!=null})]);