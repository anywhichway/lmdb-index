import {open} from "lmdb";
import {copy,defineSchema,get,getRangeFromIndex,move,put,remove,withExtensions,ANYCNAME} from "./index.js";

const benchmark = await import("./node_modules/benchmark/benchmark.js"),
    Benchmark = benchmark.default,
    suite = new Benchmark.Suite;

const db = withExtensions(open("test.db",{useVersions:true}));
db.clearSync();
db.defineSchema(Object);

suite.add("put primitive",async () => {
    await db.put(1,1);
})
suite.add("get primitive",() => {
    db.get(1);
})
suite.add("index",async () => {
    // random forces reindexing
    await db.put(`Object@1`,{name:"joe",age:21,address:{city:"New York",state:"NY"},random:Math.random()});
})
suite.add("getRangeFromIndex",async () => {
    await db.committed;
    [...db.getRangeFromIndex({name:"joe"})];
})
.on('cycle', function(event) {
    console.log(String(event.target));
})
.on('complete', function() {
    console.log('Fastest is ' + this.filter('fastest').map('name'));
})
.run({ maxTime:5 });