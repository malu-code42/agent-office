/**
 * A small least-recently-used map: reading or writing a key makes it the newest, and writing past `cap` drops the
 * oldest. The plate cache uses it so texts that change ("Sala de reunião · N em reunião") cannot pile up forever.
 */
export class Lru<K, V> {
  private map = new Map<K, V>()

  constructor(readonly cap: number) {}

  get size(): number {
    return this.map.size
  }

  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      // A Map keeps insertion order: re-inserting moves the key to the newest end.
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.cap) this.map.delete(this.map.keys().next().value as K)
  }

  values(): IterableIterator<V> {
    return this.map.values()
  }
}
