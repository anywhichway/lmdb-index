import {open} from "lmdb";
import {withExtensions,operators} from "./index.js";

const benchmark = await import("./node_modules/benchmark/benchmark.js"),
    Benchmark = benchmark.default;

const db = withExtensions(open("test.db",{noMemInit:true}))
db.clearSync();
db.indexDB.clearSync();
await db.put("async",1);
await db.put("sync",1);
await db.index({name:"joe",age:21,address:{city:"New York",state:"NY"},"#":"TestObjectFixed"});
//for(const entry of db.getRangeFromIndex({address:{city:"New York"}})) {
  // console.log(entry);
//}

const log = (event,count) => {
    const str = String(event.target),
     ops = parseFloat(str.match(/.*x\s([\d.,]*)\sops.*/)[1].replaceAll(",",""));
    console.log(str,"records:",count===0 ? 0 + (" Error?") : new Intl.NumberFormat().format(count),"records/sec:",count===0 ? 0 + (" Error?") : new Intl.NumberFormat().format(count/event.target.stats.mean));
}
const maxCount = Infinity;
let count = 0,
    found = false;
(new Benchmark.Suite).add("put primitive async",async () => {
    await db.put("async",2);
}).on('cycle', async (event) => {
    log(event,1);
}).run({});
(new Benchmark.Suite).add("put primitive sync",() => {
    db.putSync("sync",2);
}).on('cycle', async (event) => {
    log(event,1);
}).run({});
(new Benchmark.Suite).add("get primitive for async",() => {
    db.get("async");
}).on('cycle', async (event) => {
    log(event,1);
}).run({});
(new Benchmark.Suite).add("get primitive for sync",() => {
    db.get("sync");
}).on('cycle', async (event) => {
    log(event,1);
}).run({});
(new Benchmark.Suite).add("index async",async () => {
    if(count>maxCount) return;
    await db.index({name:"joe",address:{city:"Albany",state:"NY"},"#":`TestObject@${count++}`});
}).on('cycle', async (event) => {
    log(event,1);
}).run({});
(new Benchmark.Suite).add("index Sync",() => {
    if(count<0) { count++;  return; }
    db.indexSync({name:"bill",address:{city:"Seattle",state:"WA"},"#":`TestObject@${count--}`});
}).on('cycle', async (event) => {
    log(event,1);
}).run({});

setTimeout(() => {
    (new Benchmark.Suite).add("getRangeFromIndex",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({address:{city:"Albany"}})) {
            count++;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex first",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({address:{city:"Albany"}})) {
            found = true;
            count++;
            break;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex one top",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({age:21})) {
            count++;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex one nested",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({age:21,address:{city:"New York"}})) {
            count++;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex fulltext",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({address:{city:"New York"}},null,null,{fulltext:true})) {
            count++;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex fulltext first",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({address:{city:"New York"}},null,null,{fulltext:true})) {
            count++;
            break;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex with function",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({address:{city:(value) => value==="Albany" ? value : undefined}})) {
            count++;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex with function first",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({address:{city:(value) => value==="Albany" ? value : undefined}})) {
            count++;
            break;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex with literal and function one",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({age:21,address:{city:(value) => value==="New York" ? value : undefined}})) {
            count++;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex with literal and function",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({name:"joe",address:{city:(value) => value==="Albany" ? value : undefined}})) {
            count++;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex with literal and function first",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({name:"joe",address:{city:(value) => value==="Albany" ? value : undefined}})) {
            count++;
            break;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex with RegExp",() => {
        count = 0;
        for (const item of db.getRangeFromIndex({address:{city:/Albany/}})) {
            count++;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).run({});
    (new Benchmark.Suite).add("getRangeFromIndex first",async () => {
        count = 0;
        for (const item of db.getRangeFromIndex({address:{city:"Albany"}})) {
            count++;
            found = true;
            break;
        }
    }).on('cycle', async (event) => {
        log(event,count)
    }).on('complete', async function() {
            // console.log('Fastest is ' + this.filter('fastest').map('name'));
            await db.commited;
            console.log("async:",db.get("async")) // should be 2!
            console.log("sync:",db.get("sync")) // should be 2!
            console.log("TestObject1:",db.getEntry("TestObject@1"));
            console.log("TestObject2:",db.getEntry("TestObject@2"));
            console.log("found:",found);
            console.log("New York range length:",[...db.getRangeFromIndex({address:{city:"New York"}})].length);
            console.log("Albany range length:",[...db.getRangeFromIndex({address:{city:"Albany"}})].length);
            console.log("literal and function length:",[...db.getRangeFromIndex({name:"joe",address:{city:(value) => value==="Albany" ? value : undefined}})].length);
            console.log("Full range length:",[...await db.getRangeFromIndex({name:"joe"})].length);
        })
        .run({} );
},10000)
