type ResolveValue<T> = T extends PromiseLike<infer V> ? V : T
// type AsyncFunction<T> = T extends (
//   ...args: infer A
// ) => Generator<infer Y, infer R, unknown>
//   ? (...args: A) => Generator<Y, ResolveValue<R>, ResolveValue<Y>>
//   : never

function _asyncToGenerator<R, T = unknown, A extends Array<any> = Array<any>>(
  fn: (...args: A) => Generator<T, R, any>
): (...args: A) => Promise<ResolveValue<R>> {
  return function (this: void, ...args) {
    const self = this
    // 将返回值promise化
    return new Promise(function (resolve, reject) {
      // 获取迭代器实例
      const gen = fn.apply(self, args)
      // 执行下一步
      function _next(...nextArgs: [] | [T]) {
        // 把自己放进去
        asyncGeneratorStep(
          gen,
          resolve,
          reject,
          _next,
          _throw,
          'next',
          ...nextArgs
        )
      }
      // 抛出异常
      function _throw(err: any) {
        asyncGeneratorStep(gen, resolve, reject, _next, _throw, 'throw', err)
      }
      // 启动迭代器
      _next()
    })
  }
}

function asyncGeneratorStep<
  R,
  TNext = unknown,
  T extends Generator = Generator
>(
  gen: T,
  resolve: (value: R) => void,
  reject: (reason?: any) => void,
  _next: (...args: [] | [TNext]) => void,
  _throw: (err: any) => void,
  key: 'next' | 'throw',
  // 只有一个参数，同时需要满足 next 和 throw，所以直接 any 就好了
  arg?: any
): void {
  try {
    // yield 后的值是返回出来的，我们现在需要将其放在定义的值前面
    const { value, done } = gen[key](arg)
    if (done) {
      // 迭代器完成
      resolve(value)
    } else {
      // -- 这行代码就是精髓 --
      // 将所有值promise化
      // 比如 yield 1
      // const a = Promise.resolve(1) a 是一个 promise
      // const b = Promise.resolve(a) b 是一个 promise
      // 可以做到统一 promise 输出
      // 当 promise 执行完之后再执行下一步
      // 递归调用 next 函数，直到 done === true
      // _next是从上面传入到下面的
      Promise.resolve(value).then(_next, _throw)
    }
  } catch (error) {
    reject(error)
  }
}
