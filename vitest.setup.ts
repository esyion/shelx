import "@testing-library/jest-dom/vitest";

// jsdom 没有 ResizeObserver;react-resizable-panels(AppShell 停靠右栏)挂载时需要它。
// 空实现即可:布局断言只看树结构,不依赖真实测量。
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub,
    writable: true,
    configurable: true,
  });
}
