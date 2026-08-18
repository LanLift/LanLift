'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MiniEventEmitter } = require('../src/event-emitter');

test('on/emit 基本行為與回傳值', () => {
  const emitter = new MiniEventEmitter();
  assert.equal(emitter.emit('nothing'), false);
  let called = 0;
  const listener = () => { called += 1; };
  emitter.on('tick', listener);
  assert.equal(emitter.emit('tick'), true);
  assert.equal(called, 1);
  emitter.emit('tick', 1, 2);
  assert.equal(called, 2);
});

test('once 只觸發一次', () => {
  const emitter = new MiniEventEmitter();
  let called = 0;
  emitter.once('once', () => { called += 1; });
  emitter.emit('once');
  emitter.emit('once');
  assert.equal(called, 1);
});

test('off 移除指定監聽器；移除不存在的監聽器不拋錯', () => {
  const emitter = new MiniEventEmitter();
  const a = () => {};
  const b = () => {};
  emitter.on('x', a);
  emitter.on('x', b);
  emitter.off('x', a);
  assert.equal(emitter.emit('x'), true);
  emitter.off('x', a); // 不存在
  emitter.off('y', b); // 事件不存在
  assert.equal(emitter.emit('x'), true);
  emitter.off('x', b);
  assert.equal(emitter.emit('x'), false);
});

test('removeAllListeners 清空全部或指定事件', () => {
  const emitter = new MiniEventEmitter();
  emitter.on('a', () => {});
  emitter.on('b', () => {});
  emitter.removeAllListeners('a');
  assert.equal(emitter.emit('a'), false);
  assert.equal(emitter.emit('b'), true);
  emitter.removeAllListeners();
  assert.equal(emitter.emit('b'), false);
});
