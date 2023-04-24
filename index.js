import {ABORT} from "lmdb";
import {getRangeWhere,matchPattern,DONE} from "lmdb-query";
import {copy as lmdbCopy} from "lmdb-copy";
import {move as lmdbMove} from "lmdb-move";
import {v4 as uuid} from "uuid";

getRangeWhere.SILENT = true;

const INAME_PREFIX = "@@";
function defineSchema(ctor,options={}) {
    // {indexKeys:["name","age"],name:"Person",idKey:"#"}
    let name;
    this.schema ||= {};
    options.ctor = ctor;
    return this.schema[ctor.name] = options;
}

async function copy(key,destKey,overwrite,version,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (ifVersion != null && entry.version !== ifVersion) return false;
    if (!destKey) {
        if (entry.value && typeof (entry.value) === "object") {
            const schema = getSchema.call(this, entry.constructor.name),
                value = Object.setPrototypeOf(structuredClone(entry.value), Object.getPrototypeOf(entry.value));
            delete value[schema.idKey]
            return await this.put(null, value, version) ? value[schema.idKey] : false;
        }
        destKey = uuid();
        return await lmdbCopy(key, destKey, overwrite, version, ifVersion) ? destKey : false;
    } else if(await lmdbCopy(key, destKey, overwrite, version, ifVersion)) {
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
    return schema;
}

function get(get,key,...args) {
    const value = get(key);
    if(value && typeof(value)==="object") {
        const cname = key.split("@")[0],
            schema = getSchema.call(this,cname)
        if(schema) {
            const object = Object.assign(Object.create(schema.ctor.prototype),value);
            Object.defineProperty(object,"constructor",{configurable:true,writable:true,value:schema.ctor});
            return object;
        }
    }
    return value;
}

async function move(key,destKey,overwrite,version,ifVersion) {
    const entry = this.getEntry(key, {versions: true});
    if (ifVersion != null && entry.version !== ifVersion) return false;
    if (!destKey) {
        if (entry.value && typeof (entry.value) === "object") {
            const schema = getSchema.call(this, entry.constructor.name),
                value = Object.setPrototypeOf(structuredClone(entry.value), Object.getPrototypeOf(entry.value));
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
        return await lmdbMove(key, destKey, overwrite, version) ? destKey : false;
    } else if(await lmdbMove(key, destKey, overwrite, version)) {
        return destKey;
    }
    return false;
}

async function put(put,key,value,version,ifVersion) {
    const schema = getSchema.call(this,value,true);
    if(schema) {
        value[schema.idKey] ||= key || schema.keyGenerator();
        value[schema.idKey]+="";
        value[schema.idKey] = value[schema.idKey].startsWith(schema.ctor.name+"@") ? value[schema.idKey] : schema.ctor.name+"@"+value[schema.idKey]
        if(key!=null && key!==value[schema.idKey]) throw new Error(`Key ${key} does not match id ${schema.idKey}:${value[schema.idKey]}`);
        key = value[schema.idKey];
        const entry = this.getEntry(key);
        if(ifVersion && (!entry || (entry.version!==ifVersion))) return false;
        const iname = INAME_PREFIX+value.constructor.name,
            now = Date.now(),
            indexKeys = schema.indexKeys || Object.keys(value),
            keys = [...indexKeys.reduce((keys,property) => {
                const v = value[property]!==undefined ? value[property] : null;
                if(!v || typeof(v)!=="object") keys.push([property,v,iname,key]);
                return keys;
            },[]),...indexKeys.reduce((keys,property) => {
                const v = value[property]!==undefined ? value[property] : null;
                if(!v || typeof(v)!=="object") keys.push([key,property,v]);
                return keys;
            },[])];
        let result;
        await this.childTransaction(async () => {
            if(entry) {
                const id = key;
                for(const {key} of getRangeWhere.call(this,[id])) {
                    const [id,property,v] = key;
                    if(value[property]!==v) { // should be deepEqual
                        await this.remove(key);
                        await this.remove([property,v,iname,id])
                    }
                }
            }
            for(const key of keys) {
                if(this.get(key)!=null) continue;
                result = await put(key,true);
                if(!result) throw new Error(`Unable to index ${key}`)
            }
            result = await put(key,value,version,ifVersion);
            if(!result) throw new Error(`Unable to index ${key}`)
        })
        return result;
    } else {
        return put(key,value,version,ifVersion);
    }
}

async function remove(remove,key,ifVersion) {
    let result;
    await this.childTransaction(async () => {
        const entry = this.getEntry(key);
        if(!entry) return;
        result = await remove(key,ifVersion);
        if(!result) return;
        const id = key,
            iname = INAME_PREFIX+id.split("@")[0];
        Object.entries(entry.value).forEach(async ([property,v]) => {
            if(typeof(v)!=="object") {
                await remove([property,v,iname,id]);
                await remove([id,property,v]);
            }
        })
    })
    return result;
}

function *getRangeFromIndex(indexMatch,valueMatch,select,{cname=indexMatch.constructor.name,versions,offset,limit=Infinity}={}) {
    if(limit!==undefined && typeof(limit)!=="number") throw new TypeError(`limit must be a number for getRangeindexMatch, got ${typeof(limit)} : ${limit}`);
    const iname = cname===INAME_PREFIX ? cname : INAME_PREFIX+cname,
        candidates = {};
    valueMatch ||= (value) => value;
    select ||= (value) => value;
    let total = 0;
    Object.entries(indexMatch).forEach(([property,value],i) => {
        const vtype = typeof(value),
            indexMatch = [property,value,iname];
        for(const {key} of getRangeWhere.call(this,indexMatch)) {
            if(key.length!==4) continue;
            const id = key.pop(),
                candidate = candidates[id];
            if(vtype==="function" && !value(key[1])) continue;
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
        if(--limit===0) return;
    }
}

import {withExtensions} from "lmdb-extend";

export {copy,defineSchema,get,getRangeFromIndex,move,put,remove,withExtensions,INAME_PREFIX as ANYCNAME};

// select([{Person: {name(value)=>value}}]).from({Person:{as:"P"}}).where({P:{name:"John"}})
// select().from(Person).where({name:"John"})

function select(selector) {
    return {
        from: (...classes) => {
            const create = selector===undefined && classes.length===1 ? (value) => Object.assign(Object.create(classes[0].prototype),value) : (value) => value;
            return {
                where: (where) => {

                }
            }
        }
    }

}
