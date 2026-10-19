# 当前页码：第 387 页

## 2026-06-27 | 青衣
p.381-387 | Web Storage
本节围绕 `JSON.stringify()` / `JSON.parse()` 和 Web Storage 的基础方法做了收束。学习者先从“注意事项”切入，能立刻判断对象和数组存进 `localStorage` / `sessionStorage` 前要先转成字符串，取出后再还原；也能明确说出“不会自动变回对象”。随后依次确认了 `removeItem()` 用于删除单个键、`clear()` 用于清空全部、`getItem()` 读不到时返回 `null`，这些基础边界都答得很稳。课堂末尾开始引入 `sessionStorage`，强调它只在当前会话内有效，但还没来得及展开与 `localStorage` 的更细对比。整体来看，这一节学习者对“只存字符串”这个核心约束已经掌握，后续可以直接进入 sessionStorage 的细节和二者差异。