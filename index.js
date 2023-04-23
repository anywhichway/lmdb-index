import {getRangeWhere,matchPattern} from "lmdb-query";
import {v4 as uuid} from "uuid";

function defineSchema(ctor,options={}) {
    // {indexKeys:["name","age"],name:"Person",idKey:"#"}
    this.schema ||= {};
    options.ctor = ctor;
    this.schema[ctor.name||options.name] = options;
}

async function copy(key,destKey,overwrite,version,ifVersion) {
    //
}

function getSchema(value) {
    this.schema ||= {};
    if(!value || typeof(value)!=="object") return;
    const cname = value.constructor.name,
        schema = this.schema[cname];
    if(!schema) {
        if(cname==="Object") return;
        return this.schema[cname] = getSchema.call(this,Object.getPrototypeOf(value));
    }
    schema.idKey ||= "#";
    schema.keyGenerator ||= uuid;
    return schema;
}

async function put(put,key,value,version,ifVersion) {
    const db = this,
        schema = getSchema.call(db,value);
    if(schema) {
        value[schema.idKey] ||= key || schema.keyGenerator();
        value[schema.idKey]+="";
        if(key!=null && key!==value[schema.idKey]) throw new Error(`Key ${key} does not match id ${schema.idKey}:${value[schema.idKey]}`);
        key = value[schema.idKey];
        const entry = this.getEntry(key);
        if(ifVersion && (!entry || (entry.version!==ifVersion))) return false;
        const cname = value.constructor.name,
            now = Date.now(),
            indexKeys = schema.indexKeys || Object.keys(value),
            keys = [...indexKeys.reduce((keys,property) => {
                const v = value[property]!==undefined ? value[property] : null;
                if(!v || typeof(v)!=="object") keys.push([property,v,cname,key]);
                return keys;
            },[]),...indexKeys.reduce((keys,property) => {
                const v = value[property]!==undefined ? value[property] : null;
                if(!v || typeof(v)!=="object") keys.push([key,property,v,cname]);
                return keys;
            },[])];
        let result;
        await this.transaction(async () => {
            if(entry) {
                const id = key;
                for(const {key} of getRangeWhere.call(db,[id])) {
                    const [id,property,v,cname] = key;
                    if(value[property]!==v) { // should be deepEqual
                        await this.remove(key);
                        await this.remove([property,v,cname,id])
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
    const db = this;
    let result;
    await this.transaction(async () => {
        result = await remove(key,ifVersion);
        if(!result) return;
        const id = key;
        for(const {key} of getRangeWhere.call(db,[id])) {
            if(key.length!==4) continue;
            const [id,property,v,cname] = key;
            if(typeof(property)!=="string" || typeof(cname)!=="string") continue;
            await remove(key);
            await remove([property,v,cname,id])
        }
    })
    return result;
}

function *getRangeFromIndex(indexMatch,valueMatch,select,{cname=indexMatch.constructor.name,versions,offset,limit=Infinity}={}) {
    if(limit!==undefined && typeof(limit)!=="number") throw new TypeError(`limit must be a number for getRangeindexMatch, got ${typeof(limit)} : ${limit}`);
    const candidates = {};
    valueMatch ||= (value) => value;
    select ||= (value) => value;
    let total = 0;
    Object.entries(indexMatch).forEach(([property,value],i) => {
        const vtype = typeof(value),
            indexMatch = [property,value,cname];
        for(const {key} of getRangeWhere.call(this,indexMatch,null,null,{wideRangeKeyStrings:true})) {
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
        const entry = this.getEntry(key,{versions:true});
        if(!entry) continue;
        if(select===true) {
            if(valueMatchType==="function" && valueMatch(value)!==undefined) yield {key,value};
            else if(valueMatch && valueMatchType==="object" && matchPattern(value,valueMatch)) yield {key,value};
            else if(valueMatch===undefined) yield {key,value};
            else if(valueMatch===value) yield {key,value};
        } else {
            const value = entry.value,
                result = {key};
            if(entry.version!==undefined) result.version = entry.version;
            if(valueMatchType==="function" && valueMatch(value)!==undefined) yield {...result,value:select(value)};
            else if(valueMatchType==="object" && matchPattern(value,valueMatch)) yield {...result,value:select(value)};
            else if(valueMatch===value) yield {...result,value:select(value)};
        }
        if(--limit===0) return;
    }
}

import {withExtensions} from "lmdb-extend";

export {defineSchema,put,remove,getRangeFromIndex,withExtensions};

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
