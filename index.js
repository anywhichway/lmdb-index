import {getRangeWhere} from "lmdb-query";

async function put(put,key,value,version,ifVersion) {
    const db = this,
        isObject = value && typeof(value),
        doIndex = key==null && isObject;
    key = doIndex ? (value[this.idKey||"#"] ||= Math.random())+"" : key;
    if(doIndex) {
        const entry = this.getEntry(key);
        if(ifVersion && (!entry || (entry.version!==ifVersion))) return false;
        const cname = value.constructor.name,
            now = Date.now(),
            schema = this.schema ? this.schema[cname] : null,
            indexKeys = schema?.indexKeys || Object.keys(value),
            keys = [...indexKeys.map((property) => {
                const v = value[property]!==undefined ? value[property] : null;
                return [property,v,cname,key]
            }),...indexKeys.map((property) => {
                const v = value[property]!==undefined ? value[property] : null;
                return [key,property,v,cname]
            })];
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

function *getRangeFromIndex(where,partial,cname=where.constructor.name) {
    const candidates = {};
    let total = 0;
    Object.entries(where).forEach(([property,value],i) => {
        const vtype = typeof(value),
            where = [property,value,cname];
        for(const {key} of getRangeWhere.call(this,where,null,null,{wideRangeKeyStrings:true})) {
            const id = key.pop(),
                candidate = candidates[id];
            if(vtype==="function" && !value(key[1])) continue;
            if(i===0) {
                candidates[id] = {
                    count: 1,
                    value: partial ? {[property]:value} : undefined
                };
            } else if(candidate?.count===total) {
                candidate.count++;
                if(partial) Object.assign(candidate.value,{[property]:value})
            }
        }
        total++;
    })
    for(const [key,{count,value}] of Object.entries(candidates)) {
        if(count===total) {
            if(partial) {
                yield {key,value};
            } else {
                const entry = this.getEntry(key,{versions:true});
                if(entry) yield {key,...entry}
            }
        }
    }
}

import {withExtensions} from "lmdb-extend";

export {put,getRangeFromIndex,withExtensions};

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
