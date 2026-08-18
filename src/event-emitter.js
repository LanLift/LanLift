'use strict';

// 跨端迷你 EventEmitter：Node.js 與瀏覽器通用（不依賴 node:events）。
// 僅實作 LanLift 需要的子集：on / off / once / emit / removeAllListeners。

class MiniEventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(type, listener) {
    const set = this.listeners.get(type) || new Set();
    set.add(listener);
    this.listeners.set(type, set);
    return this;
  }

  off(type, listener) {
    const set = this.listeners.get(type);
    if (!set) {return this;}
    set.delete(listener);
    if (set.size === 0) {this.listeners.delete(type);}
    return this;
  }

  once(type, listener) {
    const wrapper = (...args) => {
      this.off(type, wrapper);
      listener(...args);
    };
    return this.on(type, wrapper);
  }

  emit(type, ...args) {
    const set = this.listeners.get(type);
    if (!set) {return false;}
    for (const listener of [...set]) {listener(...args);}
    return true;
  }

  removeAllListeners(type) {
    if (type === undefined) {this.listeners.clear();}
    else {this.listeners.delete(type);}
    return this;
  }
}

module.exports = { MiniEventEmitter };
