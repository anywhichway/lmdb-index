import {ABORT} from "lmdb";
import {getRangeWhere,selector,matchPattern,DONE,ANY,withExtensions as lmdbExtend} from "lmdb-query";
import {copy as lmdbCopy} from "lmdb-copy";
import {move as lmdbMove} from "lmdb-move";
import {patch as lmdbPatch} from "lmdb-patch";
import {v4 as uuid} from "uuid";

getRangeWhere.SILENT = true;

const INAME_PREFIX = "@@";

function defineSchema(ctor,options={}) {
    // {indexKeys:["name","age"],name:"Person",idKey:"#"}
    let name;
    this.schema ||= {};
    options.ctor = ctor;
    this.schema[ctor.name] ||= {};
    Object.assign(this.schema[ctor.name],options)
    return this.schema[ctor.name];
}

async function copy(key,destKey,overwrite,version,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (!entry || (ifVersion != null && entry.version !== ifVersion)) return false;
    const schema = entry.value && typeof (entry.value) === "object" ? getSchema.call(this, entry.value.constructor.name) : null;
    if (!destKey) {
        if (schema) {
            const value = Object.setPrototypeOf(structuredClone(entry.value), Object.getPrototypeOf(entry.value));
            delete value[schema.idKey]
            return await this.put(null, value, version) ? value[schema.idKey] : false;
        }
        destKey = uuid();
        return await lmdbCopy.call(this,key, destKey, overwrite, version, ifVersion) ? destKey : false;
    } else if(await lmdbCopy.call(this,key, destKey, overwrite, version, ifVersion)) {
        return destKey;
    }
    return false;
}

function getSchema(value,create) {
    this.schema ||= {};
    const type = typeof(value);
    if(!value || !["string","object"].includes(type)) return;
    const cname = type==="object" ? value.constructor.name : value;
    let schema = this.schema[cname];
    if(!schema) {
        if(create) {
            schema = defineSchema.call(this,value.constructor)
        } else if(cname==="Object") {
            return;
        }
        return this.schema[cname] = getSchema.call(this,Object.getPrototypeOf(value));
    }
    schema.idKey ||= "#";
    schema.keyGenerator ||= uuid;
    schema.create ||= function (value)  {
        const instance = Object.assign(Object.create(this.ctor.prototype),value);
        Object.defineProperty(instance,"constructor",{configurable:true,writable:true,enumerable:false,value:this.ctor});
        return instance;
    };
    return schema;
}

function get(get,key,...args) {
    const value = get(key);
    if(value && typeof(value)==="object") {
        const cname = key.split("@")[0],
            schema = getSchema.call(this,cname);
        return schema ? schema.create(value) : value;
    }
    return value;
}

async function move(key,destKey,overwrite,version,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (!entry || (ifVersion != null && entry.version !== ifVersion)) return false;
    const schema = entry.value && typeof (entry.value) === "object" ? getSchema.call(this, entry.value.constructor.name) : null;
    if (!destKey) {
        if (schema) {
            const value = Object.setPrototypeOf(structuredClone(entry.value), Object.getPrototypeOf(entry.value));
            delete value[schema.idKey];
            let result = false;
            await this.childTransaction(async () => {
                if(!(result = await this.remove(key))) return;
                if(!(result = await this.put(null, value, version))) return ABORT;
                result = value[schema.idKey];
            });
            return result;
        }
        destKey = uuid();
        return await lmdbMove.call(this,key, destKey, overwrite, version) ? destKey : false;
    } else {
        return await lmdbMove.call(this,key,destKey,overwrite,version,ifVersion) ? destKey : false;
        //let result = false;
        /*await this.childTransaction(async () => {
            if(!(result = await this.remove(key))) return;
            if(!(result = await this.put(destKey, entry.value, version))) return ABORT;
            result = destKey;
        })*/
        //return result;
    }
    return false;
}

async function patch(key,patch,version,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (!entry || (ifVersion != null && entry.version !== ifVersion)) return false;
    const cname = key.split("@")[0],
        schema = getSchema.call(this,entry.value);
    if(schema) {
        const iname = INAME_PREFIX + cname;
        await this.childTransaction(async () => {
            if(!await lmdbPatch.call(this,key,patch,version,ifVersion)) {
                throw new Error(`Unable to patch ${key}`);
            }
            for(const [property,value] of Object.entries(patch)) {
                const oldValue = entry.value[property];
                if(oldValue!==undefined && oldValue!==value) {
                    await this.remove([property, oldValue, iname, key]);
                    await this.put([property,value,iname,key],true);
                }
            }
        });
        return true;
    }
    return lmdbPatch.call(this,key,patch,version,ifVersion);
}

async function put(put,key,value,version,ifVersion) {
    const schema = getSchema.call(this,value);
    if(schema) {
        value[schema.idKey] ||= key || schema.keyGenerator();
        value[schema.idKey]+="";
        value[schema.idKey] = value[schema.idKey].startsWith(schema.ctor.name+"@") ? value[schema.idKey] : schema.ctor.name+"@"+value[schema.idKey]
        if(key!=null && key!==value[schema.idKey]) throw new Error(`Key ${key} does not match id ${schema.idKey}:${value[schema.idKey]}`);
        key = value[schema.idKey];
        const entry = this.getEntry(key);
        if(ifVersion && (!entry || (entry.version!==ifVersion))) return false;
        const iname = INAME_PREFIX+value.constructor.name,
            id = key,
            now = Date.now(),
            indexKeys = schema.indexKeys || Object.keys(value),
            keys = indexKeys.reduce((keys,property) => {
                const v = value[property]!==undefined ? value[property] : null,
                    key = [property,v,iname,id];
                if((!v || typeof(v)!=="object") && !this.get(key)) keys.push([property,v,iname,id]);
                return keys;
            },[]);
        let result;
        await this.childTransaction(async () => {
            if(entry?.value && typeof(entry.value)==="object") {
                for(const [k,v] of Object.entries(entry.value)) {
                    if(value[k]!==v && (!v || typeof(v)!=="object")) {
                        await this.remove([k,v,iname,id])
                    }
                }
            }
            for(const key of keys) {
                result = await put(key,true);
                if(!result) throw new Error(`Unable to index ${key} for ${id}`)
            }
            result = await put(id,value,version,ifVersion);
            if(!result) throw new Error(`Unable to index ${id}`)
        })
        return result ? key : result;
    } else {
        const result = put(key,value,version,ifVersion);
        return result ? key : result;
    }
}

async function remove(remove,key,ifVersion) {
    const entry = this.getEntry(key);
    if(!entry || !entry?.value || typeof(entry.value)!=="object") return;
    const id = key,
        iname = INAME_PREFIX+id.split("@")[0],
        schema = getSchema.call(this,entry.value);
    if(iname) {
        // some underlying issue in lmdb has this throw a lot, so trap if not caused by removal of index entries
        let result;
        try {
            await this.childTransaction(async () => {
                await remove(key,ifVersion);
                if(schema) {
                    try {
                        for(const [property,value] of [...Object.entries(entry.value),[schema.idKey||"#",entry.value[schema.idKey||"#"]]]) {
                            if(!value || typeof(value)!=="object") {
                                await remove([property,value,iname,id]);
                            }
                        }
                    } catch(e) {
                        result = e;
                        return ABORT;
                    }
                }
            });
        } catch(e) {
            //console.log(e);
            if(result && typeof(result)==="object" && result instanceof Error) throw result;
        }
    }
    return true;
}

function *getRangeFromIndex(indexMatch,valueMatch,select,{cname=indexMatch.constructor.name,versions,offset,limit=Infinity}={}) {
    if(limit!==undefined && typeof(limit)!=="number") throw new TypeError(`limit must be a number for getRangeindexMatch, got ${typeof(limit)} : ${limit}`);
    const iname = cname===INAME_PREFIX ? (value)=>value : INAME_PREFIX+cname,
        prefix = cname===INAME_PREFIX ? (id) => id.split("@").length===2 : (id) => id.startsWith(cname) && id[cname.length]==="@",
        candidates = {};
    valueMatch ||= (value) => value;
    select ||= (value) => value;
    let total = 0;
    Object.entries(indexMatch).forEach(([property,value],i) => {
        const vtype = typeof(value),
            indexMatch = [property,value,iname];
        let some;
        for(const {key} of getRangeWhere.call(this,indexMatch)) {
            if(key.length!==4) continue;
            const id = key.pop(),
                candidate = candidates[id];
            if(!prefix(id)) {
                if(some) break;
                else continue;
            }
            if(vtype==="function" && !value(key[1])) continue;
            some = true;
            if(i===0) {
                candidates[id] = {
                    count: 1,
                    value: select===true ? {[property]:key[1]} : undefined
                };
            } else if(candidate?.count===total) {
                candidate.count++;
                if(select===true) Object.assign(candidate.value,{[property]:key[1]})
            }
        }
        total++;
    })
    const valueMatchType = typeof(valueMatch)
    for(const [key,{count,value}] of Object.entries(candidates)) {
        if(offset && offset-->0) continue;
        const entry = this.getEntry(key,{versions});
        if(!entry) continue;
        let done;
        if(select===true) {
            const result = {key},
                reduce = (entry) => {
                    if(!entry.value || typeof(entry.value)!=="object") return entry.value;
                    Object.keys(entry.value).forEach((key) => {
                        if(value[key]==undefined) delete entry.value[key];
                    })
                    return entry.value;
                };
            if(entry.version!==undefined && versions) result.version = entry.version;
            if(valueMatchType==="function" && valueMatch(value)!==undefined)  yield {...result,value:reduce(entry)}
            else if(valueMatch && valueMatchType==="object" && matchPattern(value,valueMatch)) yield {...result,value:reduce(entry)};
            else if(valueMatch===value) yield {...result,value:reduce(entry)};
        } else {
            const value = entry.value,
                result = {key};
            if(entry.version!==undefined && versions) result.version = entry.version;
            if(valueMatchType==="function" && valueMatch(value)!==undefined)  yield {...result,value:select(value)}
            else if(valueMatchType==="object" && matchPattern(value,valueMatch)) yield {...result,value:select(value)};
            else if(valueMatch===value) yield {...result,value:select(value)};
        }
        if(--limit<=0) return;
    }
}

const withExtensions = (db,extensions={}) => {
    return lmdbExtend(db,{copy,defineSchema,get,getRangeFromIndex,getSchema,move,patch,put,remove,...extensions})
}

export {copy,defineSchema,get,getRangeFromIndex,getSchema,move,patch,put,remove,withExtensions,INAME_PREFIX as ANYCNAME};

