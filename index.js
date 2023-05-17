/*MIT License
Copyright 2023, AnyWhichWay, LLC and Simon Y. Blackwell

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/


import {ABORT} from "lmdb";
import {ANY,DONE,withExtensions as lmdbExtend} from "lmdb-query";
import {copy as lmdbCopy} from "lmdb-copy";
import {move as lmdbMove} from "lmdb-move";
import {patch as lmdbPatch} from "lmdb-patch";
import {v4 as uuid} from "uuid";
import {operators} from "./src/operators.js";

var STOPWORDS = [
    'a', 'about', 'after', 'ala', 'all', 'also', 'am', 'an', 'and', 'another', 'any', 'are',
    'around','as', 'at', 'be',
    'because', 'been', 'before', 'being', 'between', 'both', 'but', 'by', 'came', 'can',
    'come', 'could', 'did', 'do', 'each', 'for', 'from', 'get', 'got', 'has', 'had',
    'he', 'have', 'her', 'here', 'him', 'himself', 'his', 'how', 'i', 'if', 'iff', 'in',
    'include', 'into',
    'is', 'it', 'like', 'make', 'many', 'me', 'might', 'more', 'most', 'much', 'must',
    'my', 'never', 'now', 'of', 'on', 'only', 'or', 'other', 'our', 'out', 'over',
    'said', 'same', 'see', 'should', 'since', 'some', 'still', 'such', 'take', 'than',
    'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
    'through', 'to', 'too', 'under', 'up', 'very', 'was', 'way', 'we', 'well', 'were',
    'what', 'where', 'which', 'while', 'who', 'with', 'would', 'you', 'your'];

const tokenize = (value,isObject) => (value.replace(new RegExp(`[^A-Za-z0-9\\s${isObject ? "\:" : ""}]`,"g"),"").replace(/  +/g," ").toLowerCase().split(" "));

function defineSchema(ctor,options={}) {
    // {indexKeys:["name","age"],name:"Person",idKey:"#"}
    let name;
    this.schema ||= {};
    options.ctor = ctor;
    const schema = this.schema[ctor.name] ||= {};
    Object.assign(schema,options);
    if(schema.indexKeys) {
        schema.indexKeys = schema.indexKeys.map((key)=>key.split(".").map((part)=>part+=":").join(""));
    }
    return schema;
}

// todo clearAsync and clearSync should remove indexes

async function clearAsync(clearAsync) {
    return this.transaction(async ()=>{
        await clearAsync.call(this)
        if(this.indexDb) await this.indexDB.clearAsync()
    });
}

function clearSync(clearSync) {
    return this.transactionSync(()=>{
        clearSync.call(this)
        if(this.indexDB) this.indexDB.clearSync();
    });
}

async function copy(key,destKey,overwrite,version,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (!entry || (ifVersion != null && entry.version !== ifVersion)) return false;
    const cname = entry.value.constructor.name,
        schema = entry.value && typeof (entry.value) === "object" ? this.getSchema(cname) : null;
    if (destKey==null) {
        const value = Object.setPrototypeOf(structuredClone(entry.value), Object.getPrototypeOf(entry.value));
        if(schema) delete value[schema.idKey]
        return await this.put(null, value, version);
    }
    return await lmdbCopy.call(this,key, destKey, overwrite, version, ifVersion) ? destKey : undefined;
}

function get(get,key,...args) {
    const value = deserializeSpecial(null,get(key,...args));
    if(value && typeof(value)==="object") {
        const cname = key.split("@")[0],
            schema = getSchema.call(this,cname);
        return schema ? schema.create(value) : value;
    }
    return value;
}

async function move(key,destKey,overwrite,version,ifVersion) {
    const entry = this.getEntry(key, {versions: true}),
        cname = entry.value.constructor.name,
        isObject = entry.value && typeof (entry.value) === "object",
        schema = isObject ? getSchema.call(this, cname) : null,
        idKey = schema ? schema.idKey : "#";
    if(isObject && destKey) {
        entry.value[idKey] = destKey;
        destKey = null;
    }
    return this.transaction(async () => {
        if (!await this.remove(key, version, ifVersion)) return;
        return await this.put(destKey, entry.value, version);
    });
}

async function patch(key,patch,version,ifVersion) {
    const entry = this.getEntry(key, {versions: true}),
        cname = entry.value.constructor.name,
        isObject = entry.value && typeof (entry.value) === "object",
        schema = isObject ? getSchema.call(this, cname) : null;
    if(schema) {
        return this.childTransaction(async () => {
            patch = serializeSpecial()(patch);
            if(!await lmdbPatch.call(this,key,patch,version,ifVersion)) {
                throw new Error(`Unable to patch ${key}`);
            }
            const id = key,
                patchKeys = getKeys(patch,schema.indexKeys),
                entryKeys = getKeys(serializeSpecial()(entry.value),schema.indexKeys),
                keysToRemove = entryKeys.filter((ekey)=> patchKeys.some((pkey) => pkey.length==ekey.length && pkey.every((item,i)=> i==pkey.length-1 || item===ekey[i]))),
                keysToAdd = patchKeys.filter((pkey)=> entryKeys.some((ekey) => ekey.length==pkey.length && ekey.every((item,i)=> i==ekey.length-1 ? item!==pkey[i] : item===pkey[i])));
            for(const key of keysToRemove) {
                await this.indexDB.remove(key, id);
            }
            for(const key of keysToAdd) {
                await this.indexDB.put(key,id);
            }
            return true;
        });
    }
    return lmdbPatch.call(this,key,patch,version,ifVersion);
}

async function put(put,key,value,cname,...args) {
    if(key==null) {
        return this.index(value,cname,...args);
    }
    return await put(key,value,...args)===true ? key : undefined;
}

async function putSync(putSync,key,value,cname,...args) {
    if(key==null) {
        return this.indexSync(value,cname,...args);
    }
    return putSync(key,value,...args)===true ? key : undefined;
}

async function remove(remove,key,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (!entry || (ifVersion != null && entry.version !== ifVersion)) return false;
    const schema = this.getSchema(entry.value?.constructor?.name);
    return this.childTransaction(async () => {
        if(await remove(key, ifVersion)) {
            if(entry.value && typeof(entry.value)==="object") {
                const value = serializeSpecial()(entry.value),
                    id = key;
                for(const key of getKeys(value,schema?.indexKeys)) {
                    await this.indexDB.remove(key,id);
                }
            }
            return key;
        }
    })
}

async function removeSync(removeSync,key,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (!entry || (ifVersion != null && entry.version !== ifVersion)) return false;
    const schema = this.getSchema(entry.value?.constructor?.name)
    return this.transactionSync ( ()=> {
        if(removeSync(key, ifVersion)) {
            if(entry.value && typeof(entry.value)==="object") {
                const value = serializeSpecial()(entry.value),
                    id = key;
                for(const key of getKeys(value,schema?.indexKeys)) {
                    this.indexDB.removeSync(key,id);
                }
            }
            return key;
        }
    })
}

function getSchema(value,create) {
    this.schema ||= {};
    const type = typeof(value);
    if(!value || !["string","object"].includes(type)) return;
    const cname = type==="object" ? value.constructor.name : value;
    let schema = this.schema[cname];
    if(!schema) {
        if(create) {
            defineSchema.call(this,value.constructor)
        } else if(cname==="Object") {
            return;
        }
        return this.schema[cname] = getSchema.call(this,Object.getPrototypeOf(value));
    }
    schema.idKey ||= "#";
    schema.keyGenerator ||= uuid;
    schema.create ||= function (value)  { // this is the create function for a schema and does nto have to do with the `create` flag above to create the schema itself
        const instance = Object.assign(this.ctor===Array ? [] : Object.create(this.ctor.prototype),value);
        return instance;
    };
    return schema;
}

async function index(value,cname,...args) {
    const schema = this.getSchema(cname||value);
    cname ||= schema ? schema.ctor.name : value.constructor.name;
    const id = schema ? (value[schema.idKey] ||= `${cname}@${uuid()}`) : (value["#"] ||= `${cname}@${uuid()}`);
    return this.childTransaction(   async () => {
        value = serializeSpecial()(null,value);
        if(await this.put(id,value,cname,...args)) {
            if(schema) {
                for(const key of getKeys(value,schema.indexKeys)) {
                    await this.indexDB.put(key,id);
                }
            }
            return id;
        }
    });
}

function indexSync(value,cname,...args) {
    const schema = this.getSchema(cname||value);
    cname ||= schema ? schema.ctor.name : value.constructor.name;
    const id = schema ? (value[schema.idKey] ||= `${cname}@${uuid()}`) : (value["#"] ||= `${cname}@${uuid()}`);
    return this.transactionSync(  () => {
        value = serializeSpecial()(null,value);
        if(this.putSync(id,value,cname,...args)) {
            if(schema) {
                for(const key of getKeys(value,schema.indexKeys)) {
                    this.indexDB.putSync(key,id);
                }
            }
            return id;
        }
    });
}

function getKeys(key,value,schemaKeys,keys= [],hasRegExp) {
    const keyType = typeof(key);
    if(key && keyType==="object" && !Array.isArray(key)) {
        return getKeys([],key,value,keys);
    }
    const type = typeof(value);
    if(value && type==="object") {
        if(isRegExp(value) || value instanceof Date) {
            keys.push([...key,value])
        } else {
            for(const entry of Object.entries(value)) {
                const regExp = toRegExp(entry[0]),
                    next = regExp ? regExp: `${entry[0]}:`;
                if(regExp || hasRegExp || !schemaKeys || schemaKeys.some((schemaKey) => schemaKey.startsWith([...key,next].join("")))) {
                    getKeys( [...key,next],entry[1],schemaKeys,keys,!!regExp);
                }
            }
        }
    } else if(type==="string") {
        if(isSpecial(value)) {
            keys.push([...key,value])
        } else {
            tokenize(value).filter((token) => !STOPWORDS.includes(token)).forEach((token) => {
                //if(!schemaKeys || hasRegExp || schemaKeys.includes(key.join("."))) {
                    keys.push([...key,token])
                //}
            })
        }
    } else { //if(!schemaKeys || hasRegExp || schemaKeys.includes(key.join("."))) {
        keys.push([...key,value])
    }
    return keys;
}

const isRegExp = (value) => value instanceof RegExp || value.constructor.name==="RegExp";

const toRegExp = (value) => {
    if(value.match(/\/.*\/[gimuy]*$/)) {
        const li = value.lastIndexOf("/"),
            str = value.substring(1, li),
            flags = value.substring(li + 1);
        return new RegExp(str, flags);
    }
}

const deserializeSpecial = (key,value) => {
    if(key!==null && typeof(key)!=="string") return deserializeSpecial(null,key);
    if(key && value==="@undefined") return;
    if(value==="@Infinity") return Infinity;
    if(value==="@-Infinity") return -Infinity;
    if(value==="@NaN") return NaN;
    const type = typeof(value);
    if(type==="string") {
        const number = value.match(/^@BigInt\((.*)\)$/);
        if(number) return new BigInt(number[1]);
        const date = value.match(/^@Date\((.*)\)$/);
        if(date) return new Date(parseInt(date[1]));
        const regexp = value.match(/^@RegExp\((.*)\)$/);
        if(regexp) {
            const li = regexp[1].lastIndexOf("/"),
                str = regexp[1].substring(1,li),
                flags = regexp[1].substring(li+1);
            return new RegExp(str,flags)
        };
        const symbol = value.match(/^@Symbol\((.*)\)$/);
        if(symbol) return Symbol.for(symbol[1]);
        return value;
    }
    if(value && type==="object") {
        Object.entries(value).forEach(([key,data]) => {
            value[key] = deserializeSpecial(key,data);
        });
    }
    return value;
}

const isSpecial = (value) => {
    const specials = ["@undefined","@Infinity","@-Infinity","@NaN"];
    return specials.includes(value) || value.match(/@.*\(.*\)/)
}

const serializeSpecial = ({keepUndefined,keepRegExp}={}) => (key,value) => {
    if(key!==null && typeof(key)!=="string") return serializeSpecial({keepUndefined,keepRegExp})(null,key);
    if(keepUndefined && key && value===undefined) return "@undefined";
    if(value===Infinity) return "@Infinity";
    if(value===-Infinity) return "@-Infinity";
    const type = typeof(value);
    if(type==="symbol") return value.toString();
    if(type==="number" && isNaN(value)) return "@NaN";
    if(type==="bignint") return "@BigInt("+value.toString()+")";
    if(value && type==="object") {
        if(value instanceof Date) return "@Date("+value.getTime()+")";
        if(isRegExp(value)) return keepRegExp ? value : "@RegExp("+value.toString()+")";
        if(value instanceof Symbol) return "@Symbol("+value.toString()+")";
        Object.entries(value).forEach(([key,data]) => {
            value[key] = serializeSpecial({keepUndefined,keepRegExp})(key,data);
        });
    }
    return value;
}

function *matchIndex(pattern,{cname,sortable}={}) {
    const yielded = new Set(),
        matches = new Map(),
        schema = this.getSchema(cname),
        keys = getKeys(serializeSpecial({keepRegExp:true})(null,pattern),schema?.indexKeys);
    let i = 0;
    for(let key of keys) {
        const value = key.pop(),
            type = typeof (value),
            start = key.map((part) => {
                if(part && typeof(part)==="object" && part instanceof RegExp) {
                    return null;
                }
                return part;
            });
        let arg,
            method;
        if (start.length===key.length && !start.includes(null) && ["boolean", "number", "string", "symbol"].includes(type) || value === null) {
            arg = [...start, value];
            method = "getValues";
        } else {
            arg = {start};
            method = "getRange";
        }
        for (const item of this.indexDB[method](arg)) {
            const id = method === "getValues" ? item : item.value; // id is value when using getRange since getRange is accessing index
            if (cname && !id.startsWith(cname+"@")) {
                continue;
            }
            if (method === "getRange") {
                if(item.key.length!==start.length+1) {
                    continue;
                }
                let wasRegExp;
                if(key.some((part,i) => {
                    if(part && typeof(part)==="object") {
                        const key = item.key[i];
                        if(part instanceof RegExp) {
                            return part.test(key.substring(0,key.length-1)) ? false : wasRegExp = true;
                        }
                    } else if(part!==item.key[i]) {
                        return true;
                    }
                })) {
                    if(wasRegExp) continue;
                    break;
                }
                let toTest = item.key[item.key.length - 1];
                if (type === "function") {
                    if([undefined,DONE].includes(value(toTest))) break;
                } else if (value && type === "object") {
                    if(value instanceof RegExp) {
                        if(!value.test(toTest)) {
                            continue;
                        }
                    }
                    // objects always match indexes, resolved at value test, effectively a table scan
                } else if (toTest !== value) {
                    continue;
                }
            }
            if (i === 0) {
                if(keys.length===1 && !yielded.has(id)) {
                    yielded.add(id);
                    yield {id,count:1};
                }
                matches.set(id, 1);
            } else {
                let count = matches.get(id);
                if (count >= 1) {
                    count++;
                    if(i===keys.length-1) {
                        if(!yielded.has(id)) {
                            yielded.add(id);
                        }
                        yield {id,count};
                    } else {
                        matches.set(id,count);
                    }
                }
            }
        }
        if(keys.length>1) {
            for(const [id,count] of matches) {
                if(count<=i) {
                    matches.delete(id);
                    if(sortable && !yielded.has(id)) {
                        yielded.add(id);
                        yield {id,count}
                    }
                }
            }
            if(matches.size===0) {
                break;
            }
        }
        i++;
    }
}

function matchValue(pattern,value,serialized) {
    const type = typeof(pattern);
    if(pattern && type==="object") {
        if(isRegExp(pattern)) {
            if(["boolean","number"].includes(typeof(value))) value += "";
            return typeof(value)==="string" && value.match(pattern) ? value : undefined;
        }
        if(pattern instanceof Date) {
            return value && type==="object" && pattern.getTime()===value.getTime() ? value : undefined;
        }
        for(const entry of Object.entries(pattern)) {
            const key = entry[0],
                regExp = toRegExp(key);
            if(regExp) {
                for(const [key,v] of Object.entries(value)) {
                    if(regExp.test(key)) {
                        if(matchValue(entry[1],v,serialized)===undefined) {
                            return
                        }
                    }
                }
            } else if(matchValue(entry[1],value[key],true)===undefined) {
                return undefined;
            }
        }
        return value;
    }
    if(type==="function") {
        return pattern(value)!==undefined ? value : undefined;
    }
    return pattern===value ? value : undefined;
}

const deepCopy = (value) => {
    const type = typeof(value);
    if(["symbol","function"].includes(type)) {
        return value;
    }
    if(type==="string") {
        return value.split("").join("");
    }
    if(!value || type!=="object") {
        return value;
    }
    try {
        return structuredClone(value);
    } catch(e) {
        return Object.entries(value).reduce((result,[key,value]) => {
            result[key] = deepCopy(value);
            return result;
        },{})
    }
}

const selector = (value,pattern,{root=value,parent,key}={}) => {
    const type = typeof(pattern);
    if(type==="function") {
        return pattern(value,{root,parent,key});
    }
    if(value && type==="object") {
        if(isRegExp(pattern)) {
            if(typeof(value)==="string") {
                const matches = value.match(pattern)||[];
                return matches[1];
            }
            return;
        }
        if(pattern instanceof Date) {
            return value && type==="object" && pattern.getTime()===value.getTime() ? value : undefined;
        }
        for(const key in value) {
            if(!Object.keys(pattern).some((pkey)=> {
                const regExp = toRegExp(pkey);
                return (regExp && regExp.test(key)) || pkey===key;
            })) {
                delete value[key];
            }
        }
        for(const entry of Object.entries(pattern)) {
            const key = entry[0],
                regExp = toRegExp(key);
            let result;
            if(regExp) {
                for(const [key,v] of Object.entries(value)) {
                    if(regExp.test(key)) {
                        result = selector(v,entry[1], {root, parent: value, key})
                        if (result === undefined) {
                            delete value[key]
                        } else {
                            value[key] = result;
                        }
                    }
                }
            } else {
                result = selector(value[key],entry[1], {root, parent: value, key});
                if (result === undefined) {
                    delete value[key]
                } else {
                    value[key] = result;
                }
            }
        }
        return value;
    }
    return pattern===value ? value : undefined;
}

function *getRangeFromIndex(indexMatch,valueMatch,select,{cname,fulltext,sort,sortable,limit=Infinity,offset=0}={}) {
    cname ||= indexMatch.constructor.name!=="Object" ? indexMatch.constructor.name : undefined;
    if(sortable) sort = true;
    if(!(sortable||fulltext) && !valueMatch) {
        valueMatch ||= deepCopy(indexMatch);
    }
    //const matches = matchIndex.call(this,indexMatch,{cname});
    let i = 0;
    if (sortable||fulltext) {
        const matches = [...matchIndex.call(this,indexMatch,{cname,sortable:sortable||fulltext})],
            items = sortable ? matches.sort(typeof(sort)==="function" ? sort : (a, b) => b.count - a.count) : matches;
        // entries are [id,indexMatches], sort descending by count
        for (const {id, count} of items) {
            const entry = this.getEntry(id, {versions: true}),
                value = deserializeSpecial(null,entry.value);
            if (entry && (!valueMatch || valueMatch === entry.value || (typeof (valueMatch) === "object" ? matchValue(valueMatch, value) !== undefined : valueMatch(value) !== undefined))) {
                if (offset <= 0) {
                    i++;
                    if(select) {
                        entry.value = selector(entry.value,select);
                    }
                    yield entry;
                } else {
                    offset--;
                }
                if (i >= limit) return;
            }
        }
    } else {
        for(const {id} of matchIndex.call(this,indexMatch,{cname})) {
            const entry = this.getEntry(id, {versions: true});
            if (entry && (!valueMatch || valueMatch === entry.value || typeof (valueMatch) === "object" ? matchValue(valueMatch, entry.value) !== undefined : valueMatch(entry.value) !== undefined)) {
                if (offset <= 0) {
                    i++;
                    if(select) {
                        entry.value = selector(entry.value,select);
                    }
                    yield entry;
                } else {
                    offset--;
                }
                if (i >= limit) return;
            }
        }
    }
}

const functionalOperators = Object.entries(operators).reduce((operators,[key,f]) => {
    operators[key] = function(test) {
        let join;
        const op = (left,right) => {
            return join ? f(left,right) : f(left,{test});
        }
        return op;
    }
    operators.$and = (...tests) => {
        const op = (left,right) => {
            return tests.every((test) => test(left,right));
        }
        return op;
    }
    operators.$or = (...tests) => {
        const op = (left,right) => {
            return tests.some((test) => test(left,right));
        }
        return op;
    }
    operators.$not = (test) => {
        const op = (left,right) => {
            return !test(left,right);
        }
        return op;
    }
    return operators;
},{});

const withExtensions = (db,extensions={}) => {
    db.indexDB = db.openDB(`${db.name}.index`,{noMemInit:true,dupSort:true,encoding:"ordered-binary"});
    return lmdbExtend(db,{clearAsync,clearSync,copy,defineSchema,get,getRangeFromIndex,getSchema,index,indexSync,move,patch,put,putSync,remove,removeSync,...extensions})
}

export {DONE,ANY,functionalOperators as operators,withExtensions}