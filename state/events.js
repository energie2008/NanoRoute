/**
 * Phase 2.3: 实时事件总线
 *
 * 轻量级 EventEmitter 单例,用于在 router 关键节点发布事件,
 * SSE 客户端订阅后实时接收(200ms 防抖合并在 server.js SSE 端点中实现)。
 *
 * 事件类型:
 *   - request_complete  请求完成(含 usage)
 *   - request_error     请求失败
 *   - provider_trip     provider 熔断跳闸
 *   - provider_recover  provider 恢复
 *   - quota_warning     配额预警
 *
 * 内存约束:setMaxListeners(20),超过 20 个 SSE 客户端不再接受新订阅。
 */
import { EventEmitter } from 'events';

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(20);
  }

  publish(type, data = {}) {
    this.emit('event', { type, data, ts: Date.now() });
  }
}

const bus = new EventBus();

export function getEventBus() {
  return bus;
}

export function publishEvent(type, data = {}) {
  bus.publish(type, data);
}
