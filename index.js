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
import deepEqual from "fast-deep-equal";

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
    schema.title = ctor.name;
    schema.idKey ||= "#";
    return schema;
}

function getSchema(value,create) {
    this.schema ||= {};
    const type = typeof(value);
    if(!value || !["string","object"].includes(type)) return;
    const cname = type==="object" ? value.constructor.name : value;
    let schema = this.schema[cname] ||= this.schemata.get(cname)
    if(!schema) {
        if(create) {
            return defineSchema.call(this,type==="object" ? value.constructor : new Function(`return function ${cname}(){};`)())
        } else if(cname==="Object") {
            return;
        }
        return this.schema[cname] = getSchema.call(this,Object.getPrototypeOf(value));
    }
    schema.title = cname;
    schema.idKey ||= "#";
    schema.keyGenerator ||= uuid;
    schema.create ||= function (value)  { // this is the create function for a schema and does nto have to do with the `create` flag above to create the schema itself
        this.ctor ||= new Function(`return function ${this.title}(){};`)();
        const instance = Object.assign(this.ctor===Array ? [] : Object.create(this.ctor.prototype),value);
        return instance;
    };
    return schema;
}

// todo clearAsync and clearSync should remove indexes

async function clearAsync(clearAsync,clearSchema) {
    await clearAsync()
    if(this.propertyIndex) await this.propertyIndex.clearAsync();
    if(this.valueIndex) await this.valueIndex.clearAsync();
    if(this.vectors) await this.vectors.clearAsync();
    if(clearSchema && this.schemata) await this.schemata.clearAsync();
}

function clearSync(clearSync,clearSchema) {
    clearSync()
    if(this.propertyIndex) this.propertyIndex.clearSync();
    if(this.valueIndex) this.valueIndex.clearSync();
    if(this.vectors) this.vectors.clearSync();
    if(clearSchema && this.schemata) this.schemata.clearSync();
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

function get(get,key) {
    const value = deserializeSpecial(null,get.call(this,key));
    if(value && typeof(value)==="object") {
        const cname = key.split("@")[0],
            schema = getSchema.call(this,cname);
        return schema ? schema.create(value) : value;
    }
    return value;
}

async function learnSchema(values,{cname,vectors,put,baseURI="",$schema,schemata={}}={}) {
    for(let value of values) {
        if(!value || typeof(value)!=="object") continue;
        cname ||= value.constructor.name;
        const schema = getSchema.call(this,cname,true);
        schemata[cname] ||= schema;
        if(this.useVectors && vectors===undefined) {
            vectors = Array.isArray(this.useVectors) ? this.useVectors.includes(cname) : true;
        }
        if($schema) {
            schema.$schema ||= $schema;
        }
        schema.$id ||= `${baseURI}/${cname.toLowerCase()}.schema.json`;
        schema.title = cname;
        if(value && typeof(value)==="object" && [Date,RegExp,Uint8Array,Uint16Array,Uint32Array,Uint8ClampedArray].some((ctor)=>value instanceof ctor)) {
            continue;
        }
        value = serializeSpecial()(null,value);
        for(const key of getKeys.call(this,value,null,{noTokens:true})) {
            schema.indexKeys ||= [];
            const keyStr = key.slice(0,key.length-1).join(".");
            if(!schema.indexKeys.includes(keyStr)) {
                schema.indexKeys.push(keyStr);
            }
            if(key[0]!==schema.idKey) {
                schema.properties ||= {};
                let node = schema.properties,
                    object = value;
                for(let i=0;i<key.length-i;i++) {
                    const property = key[i],
                        v = object[property],
                        type = Array.isArray(v) ? "array" : typeof(v);
                    node = node[property] ||= {type};
                    if(node.type!==type) throw new Error(`type mismatch for ${property}`);
                    if(type==="string") {
                        node.enum ||= [];
                        if(!node.enum.includes(v)) {
                            node.enum.push(v);
                        }
                    } else if(type==="number") {
                        node.minimum = Math.min(node.minimum||v,v);
                        node.maximum = Math.max(node.maximum||v,v);
                    } else if(type==="array") {
                        object = v;
                        if(value.constructor.name==="Array") {
                            node.minItems = Math.min(node.minItems||v.length,v.length);
                            node.maxItems = Math.max(node.maxItems||v.length,v.length);
                            if(node.uniqueItems!==false) {
                                node.uniqueItems = value.every((v,i)=>value.indexOf(v)===i);
                            }
                            if(node.items!==false) {
                                node.items ||= {};
                                if(value.some((item,i) => typeof(item)!==typeof(v[0]))) {
                                    node.items = false
                                } else {
                                    node.items.type = typeof(v[0])
                                }
                            }
                        } else {
                            this.learnSchema([v],{vectors,put,baseURI,$schema,schemata});
                            node.$ref = schema[v.constructor.name].$id;
                        }
                    } else if(type==="object") {
                        object = v;
                        if(object.constructor.name!=="Object") {
                            this.learnSchema([v],{vectors,put,baseURI,$schema,schemata});
                            node.$ref = schemata[object.constructor.name].$id;
                        }
                    }
                    if(i===0) {
                        let required;
                        for(const item of values) {
                            if(item[property]===undefined)  {
                                required = false;
                                break;
                            }
                        }
                        if(required) {
                            schema.required ||= [];
                            if(!schema.required.includes(property)) {
                                schema.required.push(property);
                            }
                        }
                    }
                }
            }
        }
        if(!schema.indexKeys.includes(schema.idKey)) {
            schema.indexKeys.push(schema.idKey);
        }
        if(!schema.properties[schema.idKey]) {
            schema.properties[schema.idKey] = {type:"string"};
        }
        if(vectors) {
            for(const key of getKeys.call(this,value,schema.vectorKeys,{noTokens:true})) {
                const value = key[key.length-1],
                    type = typeof(value);
                if(type==="string" || type==="number") {
                    schema.vectorKeys ||= []; // it is correct to do this after the call to getKeys
                    key.pop();
                    const keyStr = key.join(".");
                    if(!schema.vectorKeys.includes(keyStr)) schema.vectorKeys.push(keyStr);
                }
            }
        }
    }
    if(put) {
        for(const [cname,schema] of Object.entries(schemata)) {
            await this.schemata.put(cname,schema);
        }
    }
    return schemata;
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
    if (!await this.remove(key, version, ifVersion)) return;
    return await this.put(destKey, entry.value, version);
}

async function patch(key,patch,version,ifVersion) {
    const entry = this.getEntry(key, {versions: true}),
        cname = entry.value.constructor.name,
        isObject = entry.value && typeof (entry.value) === "object",
        schema = isObject ? getSchema.call(this, cname,this.learnSchema) : null;
    if(schema) {
        return this.childTransaction(async () => {
            patch = serializeSpecial()(patch);
            if(!await lmdbPatch.call(this,key,patch,version,ifVersion)) {
                return false;
            }
            const id = key,
                patchKeys = getKeys.call(this,patch,schema.indexKeys),
                entryKeys = getKeys.call(this,serializeSpecial()(entry.value),schema.indexKeys),
                keysToRemove = entryKeys.filter((ekey)=> patchKeys.some((pkey) => pkey.length==ekey.length && pkey.every((item,i)=> i==pkey.length-1 || item===ekey[i]))),
                keysToAdd = patchKeys.filter((pkey)=> entryKeys.some((ekey) => ekey.length==pkey.length && ekey.every((item,i)=> i==ekey.length-1 ? item!==pkey[i] : item===pkey[i])));
            for(const key of keysToRemove) {
                await this.propertyIndex.remove([...key, id]);
                await this.valueIndex.remove([key.pop(),...key,id]);
            }
            for(const key of keysToAdd) {
                // todo: add schema learning
                const propertyKey = [...key,id],
                    valueKey = [key.pop(),...key,id],
                    propertyCount = this.propertyIndex.get(propertyKey)||0,
                    valueCount = this.valueIndex.get(valueKey)||0;
                await this.propertyIndex.put(propertyKey,propertyCount+1);
                await this.valueIndex.put(valueKey,valueCount+1);
                // todo: add vector support
            }
            return true;
        });
    }
    return lmdbPatch.call(this,key,patch,version,ifVersion);
}

async function put(put,key,value,cname,...args) {
    value = serializeSpecial()(null, value);
    const type = typeof(value),
        schema = this.getSchema(cname||value),
        hasCname = !!cname;
    cname ||= schema ? schema.ctor.name : value.constructor.name;
    const id = schema ? (value[schema.idKey] ||= `${cname}@${uuid()}`) : (value && typeof(value)==="object" ? (value["#"] ||= key || `${cname}@${uuid()}`) : undefined);
    if(key==null || id!==undefined) {
            if(id && key && id!==key) {
                throw new Error(`id ${id} does not match key ${key}`);
            }
           return this.transaction(   async () => {
            if(await put(id,value,...args)) {
                if(schema) {
                    let i = 0;
                    for(const key of getKeys.call(this,value,schema.indexKeys)) {
                        const propertyKey = [...key,id],
                            valueKey = [key.pop(),...key,id],
                            propertyCount = i>0 ? this.propertyIndex.get(propertyKey)||0 : 0,
                            valueCount = i>0 ? this.valueIndex.get(valueKey)||0 : 0;
                        await this.propertyIndex.put(propertyKey,propertyCount+1);
                        await this.valueIndex.put(valueKey,valueCount+1);
                        i++;
                    }
                    const vector = getVector.call(this,value,cname)
                    if(vector?.length) await this.vectors.put(id,vector);
                }
                return id;
            }
        });
    }
    return put(key,value,...args).then((result)=> {
        return result ? key : undefined
    });
}

function putSync(putSync,key,value,cname,...args) {
    //return this.indexSync(value,cname,...args);
    value = serializeSpecial()(null, value);
    const type = typeof(value),
        schema = this.getSchema(cname || value),
        hasCname = !!cname;
    cname ||= schema ? schema.ctor.name : value.constructor.name;
    const id = schema ? (value[schema.idKey] ||= `${cname}@${uuid()}`) : value && type==="object" ? (value["#"] ||= key || `${cname}@${uuid()}`) : undefined;
    if(key==null || id!==undefined) {
        if(id && key && id!==key) {
            throw new Error(`id ${id} does not match key ${key}`);
        }
        return this.transactionSync(() => {
            if (putSync(id, value, ...args)) {
                if (schema) {
                    let i = 0;
                    for(const key of getKeys.call(this,value,schema.indexKeys)) {
                        const propertyKey = [...key,id],
                            valueKey = [key.pop(),...key,id],
                            propertyCount = i>0 ? this.propertyIndex.get(propertyKey)||0 : 0,
                            valueCount = i>0 ? this.valueIndex.get(valueKey)||0 : 0;
                        this.propertyIndex.putSync(propertyKey,propertyCount+1);
                        this.valueIndex.putSync(valueKey,valueCount+1);
                        i++;
                    }
                }
                return id;
            }
        });
    }
    // putSync always seems to return false, so we need to check the value ... UGB
    const serialize = serializeSpecial();
    putSync(key,serialize(null,value),...args);
    const entry = this.getEntry(key, {versions: true});
    // deepEqual sometimes fails when it should not, UGH
    //if(deepEqual(serialize(entry.value),serialize(value)) && args[1]===entry.version) return key;
    return JSON.stringify(serialize(entry.value))===JSON.stringify(value) && (args[0]===undefined || args[0]===entry.version) ? key : undefined;
}

async function remove(remove,key,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (!entry || (ifVersion != null && entry.version !== ifVersion)) return false;
    const schema = this.getSchema(entry.value?.constructor?.name);
    return this.childTransaction(async () => {
        if(await remove.call(this,key, ifVersion)) {
            if(entry.value && typeof(entry.value)==="object") {
                const value = serializeSpecial()(entry.value),
                    id = key;
                for(const key of getKeys.call(this,value,schema?.indexKeys)) {
                    await this.propertyIndex.remove([key,id]);
                    await this.valueIndex.remove([key.pop(),...key,id]);
                }
                await this.vectors.remove(id);
            }
            return key;
        }
    })
}

function removeSync(removeSync,key,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (!entry || (ifVersion != null && entry.version !== ifVersion)) return false;
    const schema = this.getSchema(entry.value?.constructor?.name)
    return this.transactionSync ( ()=> {
        if(removeSync.call(this,key, ifVersion)) {
            if(entry.value && typeof(entry.value)==="object") {
                const value = serializeSpecial()(entry.value),
                    id = key;
                for(const key of getKeys.call(this,value,schema?.indexKeys)) {
                    this.propertyIndex.removeSync([key,id]);
                    this.valueIndex.removeSync([key.pop(),...key,id]);
                }
            }
            return key;
        }
    })
}

async function index(value,cname,...args) {
    return await this.put(null,value,cname,...args);
}

function indexSync(value,cname,...args) {
    return this.putSync(null,value,cname,...args);
}

function getKeys(key,value,schemaKeys,{noTokens,keys= [],hasRegExp}={}) {
    const keyType = typeof(key);
    if(key && keyType==="object" && !Array.isArray(key)) {
        return getKeys.call(this,[],key,value,schemaKeys);
    }
    const type = typeof(value);
    if(value && type==="object") {
        if(isRegExp(value) || value instanceof Date) {
            keys.push([...key,value])
        } else {
            for(const entry of Object.entries(value)) {
                const regExp = toRegExp(entry[0]),
                    next = regExp ? regExp: entry[0];
                if(regExp || hasRegExp || !schemaKeys || schemaKeys.some((schemaKey) => schemaKey.startsWith([...key,next].join(".")))) {
                    getKeys.call(this, [...key,next],entry[1],schemaKeys,{noTokens,keys,hasRegExp:!!regExp});
                }
            }
        }
    } else if(type==="string") {
        if(isSpecial(value)) {
            keys.push([...key,value])
        } else if(noTokens) {
            keys.push([...key,value])
        } else {
            if(this?.indexOptions?.fulltext) {
                tokenize(value).filter((token) => !STOPWORDS.includes(token)).forEach((token) => {
                    keys.push([...key,token])
                })
            }
            if(!this?.indexOptions?.fulltext && !this.indexOptions?.trigram) {
                keys.push([...key,value])
            }
        }
    } else { //if(!schemaKeys || hasRegExp || schemaKeys.includes(key.join("."))) {
        keys.push([...key,value])
    }
    return keys;
}

function euclidianDistance(a, b) {
    return a
            .map((x, i) => Math.abs( x - b[i] ) ** 2) // square the difference
            .reduce((sum, now) => sum + now) // sum
        ** (1/2)
}

function getVector(value,cname) {
    const schema = this.getSchema(cname||value);
    if(!schema.vectorKeys) return;
    const vector = [],
        keys = getKeys.call(this,value,schema.vectorKeys,{noTokens: true});
    schema.vectorKeys.forEach((vectorKey) => {
        if(!keys.some((key) => {
            key = key.slice(0,key.length-1).join(".");
            return key===vectorKey
        })) {
            keys.push([...vectorKey.split("."),null])
        }
    });
    keys.sort((a,b) => {
            a = a.slice(0,a.length-1).join(".");
            b = b.slice(0,b.length-1).join(".");
            return schema.vectorKeys.indexOf(a) - schema.vectorKeys.indexOf(b)
        });
    return keys.map((key) => {
        const def = schema.properties[key[0]], // todo: handle nesting
            value = key[key.length-1];
        if(value===null) return null;
        if(def.enum) {
            for(let i=0;i<def.enum.length;i++) {
                if(def.enum[i].toLowerCase()===value.toLowerCase()) {
                    return (i+1)/def.enum.length;
                }
            }
        }
        if(def.type==="number") {
            // normalize to 0-1
            const range = def.maximum - def.minimum;
            return range ? (value - def.minimum) / range : range;
        }
    });
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
        if(value instanceof Date || value.constructor.name==="Date") return "@Date("+value.getTime()+")";
        if(isRegExp(value)) return keepRegExp ? value : "@RegExp("+value.toString()+")";
        if(value instanceof Symbol) return "@Symbol("+value.toString()+")";
        Object.entries(value).forEach(([key,data]) => {
            value[key] = serializeSpecial({keepUndefined,keepRegExp})(key,data);
        });
    }
    return value;
}

const operatorFails = (value) => value==undefined || value===DONE;

function *matchIndex(pattern,{cname,minScore,sortable,fulltext,scan}={}) {
    const yielded = new Set(),
        matches = new Map(),
        schema = this.getSchema(cname),
        keys = getKeys.call(this,serializeSpecial({keepRegExp:true})(null,pattern),schema?.indexKeys);
    let i = 0;
    if(keys.length===0 && scan) {
        const start = [cname+"@"];
        //try {
            for(const entry of this.getRange({start})) {
                if(!entry.key.startsWith(start)) {
                    break;
                }
                yield {id:entry.key,count:0};
            }
       // } catch(e) {
        //    true; // above sometimes throws due to underlying lmdb issue
       // }
        return;
    }
    for(let key of keys) {
        const value = key.pop(),
            type = typeof (value),
            start = key.map((part) => {
                if (part && typeof (part) === "object" && part instanceof RegExp) {
                    return null;
                }
                return part;
            });
        let arg,
            method,
            index,
            hasNull = start.includes(null),
            lengthBump = 2; // if getValues is ever used for index, this will need to be 1
        if (["boolean", "number", "string", "symbol"].includes(type) || value === null) {
            if(!hasNull) {
                arg = {start:[...start, value]};
                method = "getRange";
                index = this.propertyIndex;
            } else {
                arg = {start:[value,...start.slice(0,start.indexOf(null))]};
                key = [value,...key];
                method = "getRange";
                index = this.valueIndex;
            }
        } else {
            arg = {start};
            method = "getRange";
            index = this.propertyIndex;
        }
        for (const item of index[method](arg)) {
            const id = method === "getValues" ? item : item.key[item.key.length-1]; // id is value when using getRange since getRange is accessing index
            if (cname && !id.startsWith(cname+"@")) {
                continue;
            }
            if (method === "getRange") {
                if(item.key.length!==start.length+lengthBump) {
                    continue;
                }
                let wasRegExp;
                if(key.some((part,i) => {
                    if(part && typeof(part)==="object") {
                        const key = item.key[i];
                        if(part instanceof RegExp) {
                            return part.test(key) ? false : wasRegExp = true;
                        }
                    } else if(part!==item.key[i]) {
                        return true;
                    }
                })) {
                    if(wasRegExp) continue;
                    break;
                }
                let toTest = index===this.valueIndex ? item.key[0] : item.key[item.key.length - 2];
                if (type === "function") {
                    if(!(typeof(toTest)=="string" && fulltext) && [undefined,DONE].includes(value(toTest))) break;
                } else if (value && type === "object") {
                    if(value instanceof RegExp) {
                        if(!value.test(toTest)) {
                            continue;
                        }
                    }
                    // objects always match indexes, resolved at value test
                } else if (toTest !== value) {
                    continue;
                }
            }
            const count = method=== "getRange" ? item.value : 1;
            if (i === 0) {
                if(keys.length===1 && !yielded.has(id) && 1>=minScore) {
                    yielded.add(id);
                    yield {id,count};
                }
                matches.set(id, count);
            } else {
                let count = matches.get(id);
                if (count >= 1) {
                    count++;
                    if(i===keys.length-1 && count>=minScore) {
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
                    if(sortable && !yielded.has(id) && count>=minScore) {
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
                        if(operatorFails(matchValue(entry[1],v,serialized))) {
                            return
                        }
                    }
                }
            } else if(operatorFails(matchValue(entry[1],value[key],true))) {
                return undefined;
            }
        }
        return value;
    }
    if(type==="function") {
        return operatorFails(pattern(value)) ? undefined : value;
    }
    return pattern===value ? value : undefined;
}

const deepCopy = (value) => {
    const type = typeof(value);
    if(["symbol","function"].includes(type)) {
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
                        if ([undefined,DONE].includes(result)) {
                            delete value[key]
                        } else {
                            value[key] = result;
                        }
                    }
                }
            } else {
                result = selector(value[key],entry[1], {root, parent: value, key});
                if ([undefined,DONE].includes(result)) {
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

function *getRangeFromIndex(indexMatch,valueMatch,select,{cname,fulltext,scan,sort,sortable,minScore,limit=Infinity,offset=0}={}) {
    cname ||= indexMatch.constructor.name!=="Object" ? indexMatch.constructor.name : undefined;
    if(sortable) sort = true;
    if(minScore===undefined) {
        if(fulltext) {
            if(fulltext===true) {
                minScore = 0;
            } else {
                if(typeof(fulltext)==="number" && fulltext>=0 && fulltext<=1) {
                    const keys = getKeys.call(this,serializeSpecial()(indexMatch));
                    minScore = keys.length * fulltext;
                } else {
                    throw new TypeError(`fulltext must be a number between 0 and 1, or true, not ${fulltext}`);
                }
            }
        } else {
            minScore = 0;
        }
    }
    if(!(sortable||fulltext) && !valueMatch) {
        valueMatch ||= deepCopy(indexMatch);
    }
    let i = 0;
    if (sortable||fulltext) {
        const matches = [...matchIndex.call(this,indexMatch,{cname,scan,minScore,sortable:sortable||fulltext,fulltext})],
            items = sortable ? matches.sort(typeof(sort)==="function" ? sort : (a, b) => b.count - a.count) : matches;
        // entries are [id,count], sort descending by count
        for (const {id, count} of items) {
            const entry = this.getEntry(id, {versions: true});
                //value = entry ? deserializeSpecial(null,entry.value) : undefined;
            if (entry && (!valueMatch || valueMatch === entry.value || (typeof (valueMatch) === "object" ? matchValue(valueMatch, entry.value) !== undefined : valueMatch(entry.value) !== undefined))) {
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
        for(const {id} of matchIndex.call(this,indexMatch,{cname,scan,minScore})) {
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

function *getRangeFromVector(vectorMatch,valueMatch,select,{cname,distance=euclidianDistance,sort=true,maxDistance=Infinity,limit=Infinity,offset=0}={}) {
    if(!this.useVectors) throw new Error("Vectors are not enabled");
    cname ||= vectorMatch.constructor.name!=="Object" ? vectorMatch.constructor.name : undefined;
    let i = 0;
    const start = cname ? cname + "@" : "",
        masterVector = this.getVector(vectorMatch,cname),
        toYield = [];
    for(let {key,value} of this.vectors.getRange({start})) {
        if(start && !key.startsWith(start)) break;
        let vector = [...masterVector]
        for(let i=0;i<vector.length;) {
            if(vector[i]===null) {
                vector.splice(i,1);
                value.splice(i,1);
            } else {
                i++
            }
        }
        for(let i=0;i<value.length;) {
            if(value[i]===null) {
                value.splice(i,1);
                vector.splice(i,1);
            } else {
                i++
            }
        }
        const d = distance(vector,value);
        if(d>maxDistance) continue;
        const entry = this.getEntry(key, {versions: true});
        if (entry && (!valueMatch || valueMatch === entry.value || (typeof (valueMatch) === "object" ? matchValue(valueMatch, entry.value) !== undefined : valueMatch(entry.value) !== undefined))) {
            entry.distance = d;
            if (offset <= 0) {
                i++;
                if(select) {
                    entry.value = selector(entry.value,select);
                }
                if(sort) {
                    toYield.push(entry);
                } else {
                    yield entry;
                }
            } else {
                offset--;
            }
            if (i >= limit) return;
        }
    }
    if(sort) {
        for(const item of toYield.sort((a,b) => a.distance-b.distance)) {
            yield item;
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
    db.data = db.openDB(`${db.name}.data`);
    db.data.valueIndex = db.openDB(`${db.name}.valueIndex`);
    db.data.propertyIndex = db.openDB(`${db.name}.propertyIndex`);
    if(db.useVectors) db.data.vectors = db.openDB(`${db.name}.vectors`);
    db.data.schemata = db.openDB(`${db.name}.schemata`);
    //db.valueIndex = db.propertyIndex;
    /* index, indexSync */
    db.data.indexOptions = db.indexOptions;
    db.data.useVectors = db.useVectors;
    return lmdbExtend(db.data,{clearAsync,clearSync,copy,defineSchema,euclidianDistance,get,getRangeFromIndex,getRangeFromVector,getSchema,getVector,index,learnSchema,move,patch,put,putSync,remove,removeSync,...extensions})
}

export {DONE,ANY,functionalOperators as operators,withExtensions}