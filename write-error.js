import {open} from "lmdb";
import {withExtensions} from "./index.js";

let db = withExtensions(open("test.db"));
db.clearSync();
const entries = [[1,2,3],[4,5,6],[7,8,9],[10,11,12],[13,14,15]];
db.defineSchema(Object);
db.transactionSync(() => {
    for(const [value,...key] of entries) {
        db.valueIndex.putSync(key,value)
    }
    for(const [property,...key] of entries) {
        db.propertyIndex.putSync(key,property)
    }
})
console.log(db.putSync(null,{a:1,b:2,c:3,nested:{a:1,b:2,c:3}}));
