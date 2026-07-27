// BUG REAL encontrado 2026-07-25 procesando Colombia (322MB, 2.6x Ecuador): V8 limita `Set`/`Map`
// nativos a ~16.7 millones de entradas (comparten la misma tabla hash interna) -- Ecuador (124MB)
// nunca se acercó a ese límite, Colombia sí (`RangeError: Set maximum size exceeded` juntando los
// nodos referenciados por TODAS las ways de streets+buildings+landuse+green en una sola pasada).
// `BigIdSet`/`BigIdMap` shardean por `id % numShards` en varios Set/Map nativos -- mismo API
// mínimo que ya usa `osmPbfParser.js` (`add`/`has` para Set, `set`/`get`/`values()` para Map), sin
// tocar la lógica de los llamadores.
const NUM_SHARDS = 64;

class BigIdSet {
  constructor() {
    this.shards = Array.from({ length: NUM_SHARDS }, () => new Set());
  }
  add(id) {
    this.shards[id % NUM_SHARDS].add(id);
    return this;
  }
  has(id) {
    return this.shards[id % NUM_SHARDS].has(id);
  }
  get size() {
    return this.shards.reduce((sum, s) => sum + s.size, 0);
  }
}

class BigIdMap {
  constructor() {
    this.shards = Array.from({ length: NUM_SHARDS }, () => new Map());
  }
  set(id, value) {
    this.shards[id % NUM_SHARDS].set(id, value);
    return this;
  }
  get(id) {
    return this.shards[id % NUM_SHARDS].get(id);
  }
  has(id) {
    return this.shards[id % NUM_SHARDS].has(id);
  }
  get size() {
    return this.shards.reduce((sum, s) => sum + s.size, 0);
  }
  *values() {
    for (const s of this.shards) yield* s.values();
  }
  *entries() {
    for (const s of this.shards) yield* s.entries();
  }
}

module.exports = { BigIdSet, BigIdMap };
