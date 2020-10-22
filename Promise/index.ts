enum Status {
  PENDING = 'pending',
  FULFILLED = 'fulfilled',
  REJECTED = 'rejected'
}

type Resolve<T> = (value: T | PromiseLike<T>) => void
type Reject = (reason?: any) => void

type Executor<T> = (resolve: Resolve<T>, reject: Reject) => void

type onFulfilled<T, TResult1> =
  | ((value: T) => TResult1 | PromiseLike<TResult1>)
  | undefined
  | null

type onRejected<TResult2> =
  | ((reason: any) => TResult2 | PromiseLike<TResult2>)
  | undefined
  | null

type onFinally = (() => void) | undefined | null

/* 
	将判断 Promise 提出来，减少代码冗余，不然每次都需要使用：
	((typeof value === 'object' && value !== null) ||
      typeof value === 'function') && typeof (value as PromiseLike<T>).then === 'function'
	 来进行判断，同时也有更好的 typescript 提示
*/
function isPromise(value: any): value is PromiseLike<any> {
  return (
    ((typeof value === 'object' && value !== null) ||
      typeof value === 'function') &&
    typeof value.then === 'function'
  )
}

function resolvePromise<T>(
  promise2: MyPromise<T>,
  x: T | PromiseLike<T>,
  resolve: Resolve<T>,
  reject: Reject
) {
  // 不能引用同一个对象，不然会无限循环的
  if (promise2 === x) {
    const e = new TypeError(
      'TypeError: Chaining cycle detected for promise #<MyPromise>'
    )
    // 清空栈信息，不太清楚为什么 Promise 要清除这个，先不管了，继续往下
    e.stack = ''
    // 直接进入错误的回调
    return reject(e)
  }
  let called = false // 防止多次调用

  // 如果 x 为 Promise，通过上面的知识我们知道判断是否是个 Promise 或者像 Promise 我们是判断一个对象是否有 then 方法，可以发现在下面判断是否是对象或者函数中也有相同的判断，所以这里我们可以直接省略

  // 如果 x 是对象或函数
  if ((typeof x === 'object' && x != null) || typeof x === 'function') {
    try {
      /* 
      存储了一个指向 x.then 的引用，然后测试并调用该引用，以避免多次访问 x.then 属性。这种预防措施确保了该属性的一致性，因为其值可能在检索调用时被改变。
      注：这里可以用我们封装的判断方法 isPromise 判断，但是既然跟着解决过程走，那么还是老老实实操作一下吧
      */
      // 手动转一下类型
      const then = (x as PromiseLike<T>).then
      if (typeof then === 'function') {
        // 这里其实就是调用传入的 Promise 的 then 方法，下面代码就是执行了 x.then(()=>{},()=>{})
        then.call(
          x,
          (y) => {
            if (called) return
            called = true
            // 如果是 Promise，我们应该递归地获取到最终状态的值，传入相同的处理函数，不论是成功还是失败都能直接抛出到最外层
            resolvePromise(promise2, y, resolve, reject)
          },
          (r) => {
            if (called) return
            called = true
            // 如果传入的 Promise 被拒绝，直接抛出到最外层
            reject(r)
          }
        )
      } else {
        // 不是 Promise 对象，当做普通值处理
        resolve(x)
      }
    } catch (e) {
      // 如果中间有错误。直接变为拒绝态
      // 但是如果出现错误之前已经改变了状态，那么久不用管
      if (called) return
      called = true
      reject(e)
    }
  } else {
    // 普通值处理
    resolve(x)
  }
}

class MyPromise<T> {
  status: Status = Status.PENDING
  // 保存当前 Promise 的终值，这里让它一定会有值
  private value!: T
  private reason?: any
  private onFulfilledCallback: (() => void)[] = [] //成功的回调
  private onRejectedCallback: (() => void)[] = [] //失败的回调

  constructor(executor: Executor<T>) {
    try {
      // 防止 this 丢失
      executor(this._resolve.bind(this), this._reject.bind(this))
    } catch (e) {
      this._reject(e)
    }
  }
  // 内部的 resolve 函数，就是我们实例 Promise 传入给用户调用的 resolve
  private _resolve(value: T | PromiseLike<T>) {
    // 推入事件环最后，这里应该是微任务， ES6 的 Promise 内部并不是用 setTimeout，这里我们只能用 setTimeout 进行模拟微任务
    try {
      if (isPromise(value)) {
        value.then(this._resolve.bind(this), this._reject.bind(this))
        return
      }

      setTimeout(() => {
        // 如果是 pending 状态就变为 fulfilled
        if (this.status === Status.PENDING) {
          this.status = Status.FULFILLED
          this.value = value
          // resolve 后执行 .then 时传入的回调
          this.onFulfilledCallback.forEach((fn) => fn())
        }
      })
    } catch (error) {
      this._reject(error)
    }
  }

  // 内部的 reject 函数，就是我们实例 Promise 传入给用户调用的 reject
  private _reject(reason: any) {
    // 大体用法同上，这里不用进行值穿透，所以不用判断是否为 Promise 对象了
    setTimeout(() => {
      if (this.status === Status.PENDING) {
        this.status = Status.REJECTED
        this.reason = reason
        this.onRejectedCallback.forEach((fn) => fn())
      }
    })
  }

  public then<TResult1 = T, TResult2 = never>(
    onfulfilled?: onFulfilled<T, TResult1>,
    onrejected?: onRejected<TResult2>
  ): MyPromise<TResult1 | TResult2> {
    // 保证是函数
    const onfulfilledFn =
      typeof onfulfilled === 'function'
        ? onfulfilled
        : (v: T | TResult1) => v as TResult1
    const onrejectedFn =
      typeof onrejected === 'function'
        ? onrejected
        : (e: any) => {
            throw e
          }

    // 将下面的 onfulfilled 改成 onfulfilledFn，onrejected 改成 onrejectedFn 就行了
    // 现在我们将这个新生成的 Promise 和现在的 Promise 相互联系
    const promise2 = new MyPromise<TResult1 | TResult2>((resolve, reject) => {
      if (this.status === Status.FULFILLED) {
        setTimeout(() => {
          try {
            //  获取到 x，然后与要返回的 Promise 产生联系
            let x = onfulfilledFn(this.value)
            resolvePromise(promise2, x, resolve, reject)
          } catch (e) {
            reject(e)
          }
        })
      }
      if (this.status === Status.REJECTED) {
        setTimeout(() => {
          try {
            //  获取到 x，然后与要返回的 Promise 产生联系
            let x = onrejectedFn(this.reason)
            resolvePromise(promise2, x, resolve, reject)
          } catch (e) {
            reject(e)
          }
        })
      }
      if (this.status === Status.PENDING) {
        // 如果为 pending，需要将 onFulfilled 和 onRejected 函数都存放起来，状态确定后再依次执行
        // 执行回调的时候有 setTimeout，这里就不加了
        this.onFulfilledCallback.push(() => {
          try {
            let x = onfulfilledFn(this.value)
            resolvePromise(promise2, x, resolve, reject)
          } catch (e) {
            reject(e)
          }
        })
        this.onRejectedCallback.push(() => {
          try {
            let x = onrejectedFn(this.reason)
            resolvePromise(promise2, x, resolve, reject)
          } catch (e) {
            reject(e)
          }
        })
      }
    })

    return promise2
  }
  public catch<TResult = never>(
    onrejected?: onRejected<TResult>
  ): MyPromise<T | TResult> {
    return this.then(null, onrejected)
  }

  static resolve(): MyPromise<void>
  static resolve<T>(value: T | PromiseLike<T>): MyPromise<T>
  static resolve<T>(value?: T | PromiseLike<T>): MyPromise<T> {
    if (value instanceof MyPromise) {
      return value
    }
    return new MyPromise((resolve) => {
      resolve(value!)
    })
  }

  static reject<T = never>(reason?: any): MyPromise<T> {
    return new MyPromise((resolve, reject) => {
      reject(reason)
    })
  }

  // 无论如何都会执行，不会传值给回调函数
  public finally(onfinally?: onFinally): MyPromise<T> {
    return this.then(
      (value) =>
        // 如果 onfinally 返回的是一个 thenable 也会等返回的 thenable 状态改变才会进行后续的 Promise
        MyPromise.resolve(
          typeof onfinally === 'function' ? onfinally() : onfinally
        ).then(() => value),
      (reason) =>
        MyPromise.resolve(
          typeof onfinally === 'function' ? onfinally() : onfinally
        ).then(() => {
          throw reason
        })
    )
  }
  static all<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10>(
    values: readonly [
      T1 | PromiseLike<T1>,
      T2 | PromiseLike<T2>,
      T3 | PromiseLike<T3>,
      T4 | PromiseLike<T4>,
      T5 | PromiseLike<T5>,
      T6 | PromiseLike<T6>,
      T7 | PromiseLike<T7>,
      T8 | PromiseLike<T8>,
      T9 | PromiseLike<T9>,
      T10 | PromiseLike<T10>
    ]
  ): MyPromise<[T1, T2, T3, T4, T5, T6, T7, T8, T9, T10]>
  static all<T1, T2, T3, T4, T5, T6, T7, T8, T9>(
    values: readonly [
      T1 | PromiseLike<T1>,
      T2 | PromiseLike<T2>,
      T3 | PromiseLike<T3>,
      T4 | PromiseLike<T4>,
      T5 | PromiseLike<T5>,
      T6 | PromiseLike<T6>,
      T7 | PromiseLike<T7>,
      T8 | PromiseLike<T8>,
      T9 | PromiseLike<T9>
    ]
  ): MyPromise<[T1, T2, T3, T4, T5, T6, T7, T8, T9]>
  static all<T1, T2, T3, T4, T5, T6, T7, T8>(
    values: readonly [
      T1 | PromiseLike<T1>,
      T2 | PromiseLike<T2>,
      T3 | PromiseLike<T3>,
      T4 | PromiseLike<T4>,
      T5 | PromiseLike<T5>,
      T6 | PromiseLike<T6>,
      T7 | PromiseLike<T7>,
      T8 | PromiseLike<T8>
    ]
  ): MyPromise<[T1, T2, T3, T4, T5, T6, T7, T8]>
  static all<T1, T2, T3, T4, T5, T6, T7>(
    values: readonly [
      T1 | PromiseLike<T1>,
      T2 | PromiseLike<T2>,
      T3 | PromiseLike<T3>,
      T4 | PromiseLike<T4>,
      T5 | PromiseLike<T5>,
      T6 | PromiseLike<T6>,
      T7 | PromiseLike<T7>
    ]
  ): MyPromise<[T1, T2, T3, T4, T5, T6, T7]>
  static all<T1, T2, T3, T4, T5, T6>(
    values: readonly [
      T1 | PromiseLike<T1>,
      T2 | PromiseLike<T2>,
      T3 | PromiseLike<T3>,
      T4 | PromiseLike<T4>,
      T5 | PromiseLike<T5>,
      T6 | PromiseLike<T6>
    ]
  ): MyPromise<[T1, T2, T3, T4, T5, T6]>
  static all<T1, T2, T3, T4, T5>(
    values: readonly [
      T1 | PromiseLike<T1>,
      T2 | PromiseLike<T2>,
      T3 | PromiseLike<T3>,
      T4 | PromiseLike<T4>,
      T5 | PromiseLike<T5>
    ]
  ): MyPromise<[T1, T2, T3, T4, T5]>
  static all<T1, T2, T3, T4>(
    values: readonly [
      T1 | PromiseLike<T1>,
      T2 | PromiseLike<T2>,
      T3 | PromiseLike<T3>,
      T4 | PromiseLike<T4>
    ]
  ): MyPromise<[T1, T2, T3, T4]>
  static all<T1, T2, T3>(
    values: readonly [
      T1 | PromiseLike<T1>,
      T2 | PromiseLike<T2>,
      T3 | PromiseLike<T3>
    ]
  ): MyPromise<[T1, T2, T3]>
  static all<T1, T2>(
    values: readonly [T1 | PromiseLike<T1>, T2 | PromiseLike<T2>]
  ): MyPromise<[T1, T2]>
  static all<T>(values: readonly (T | PromiseLike<T>)[]): MyPromise<T[]>
  static all<T>(values: Iterable<T | PromiseLike<T>>): MyPromise<T[]>
  static all<T>(values: Iterable<T | PromiseLike<T>>): MyPromise<T[]> {
    return new MyPromise((resolve, reject) => {
      // PromiseLike<T> 对象会跟踪转换为 T
      const resultArr: T[] = []
      // 获取迭代器对象
      let iter = values[Symbol.iterator]()
      //  判断是否已经全部完成了
      const doneArr: boolean[] = []
      // 获取值 {value:xxx, done: false}
      let cur = iter.next()
      // 判断迭代器是否迭代完毕同时将最后得到的值放入结果数组中
      const resolveResult = (value: T, index: number, done?: boolean) => {
        resultArr[index] = value
        doneArr[index] = true
        if (done && doneArr.every((item) => item)) {
          resolve(resultArr)
        }
      }
      for (let i = 0; !cur.done; i++) {
        const value = cur.value
        doneArr.push(false)
        cur = iter.next()
        if (isPromise(value)) {
          value.then((value: T) => {
            resolveResult(value, i, cur.done)
          }, reject)
        } else {
          resolveResult(value, i, cur.done)
        }
      }
    })
  }

  static race<T>(
    values: Iterable<T>
  ): MyPromise<T extends PromiseLike<infer U> ? U : T>
  static race<T>(
    values: readonly T[]
  ): MyPromise<T extends PromiseLike<infer U> ? U : T>
  static race<T>(
    values: Iterable<T>
  ): MyPromise<T extends PromiseLike<infer U> ? U : T> {
    return new MyPromise((resolve, reject) => {
      const iter = values[Symbol.iterator]()
      let cur = iter.next()
      while (!cur.done) {
        const value = cur.value
        cur = iter.next()
        if (isPromise(value)) {
          value.then(resolve, reject)
        } else {
          // 普通值,这时的值为 T，但是 Typescript 无法再深度判断了，需要自己手动转换
          resolve(value as T extends PromiseLike<infer U> ? U : T)
        }
      }
    })
  }

  static allSettled<T extends readonly unknown[] | readonly [unknown]>(
    values: T
  ): MyPromise<
    {
      -readonly [P in keyof T]: PromiseSettledResult<
        T[P] extends PromiseLike<infer U> ? U : T[P]
      >
    }
  >
  static allSettled<T>(
    values: Iterable<T>
  ): MyPromise<PromiseSettledResult<T extends PromiseLike<infer U> ? U : T>[]>
  static allSettled<T>(values: Iterable<T>): MyPromise<any> {
    return new MyPromise((reslove) => {
      const resultArr: any[] = []
      const doneArr: boolean[] = []
      // 获取迭代器
      const iter = values[Symbol.iterator]()
      // 当前值
      let cur = iter.next()
      const resolveResult = (value: any, index: number, done?: boolean) => {
        resultArr[index] = {
          status: Status.FULFILLED,
          value
        }
        doneArr[index] = true
        if (done && doneArr.every((item) => item)) {
          reslove(resultArr)
        }
      }
      for (let i = 0; !cur.done; i++) {
        const value = cur.value
        doneArr.push(false)
        cur = iter.next()
        if (isPromise(value)) {
          value.then(
            (value) => {
              resolveResult(value, i, cur.done)
            },
            (reason) => {
              // 这里和 resolve 基本也没什么区别，修改一下状态和属性就ok了
              resultArr[i] = {
                status: Status.REJECTED,
                reason
              }
              doneArr[i] = true
              if (cur.done && doneArr.every((item) => item)) {
                reslove(resultArr)
              }
            }
          )
          // 不是 thenable 直接存储
        } else {
          resolveResult(value, i, cur.done)
        }
      }
    })
  }
  // 与 MyPromise.all 正好相反
  static any<T>(
    values: (T | PromiseLike<T>)[] | Iterable<T | PromiseLike<T>>
  ): MyPromise<T> {
    return new MyPromise((resolve, reject) => {
      // 接收迭代器
      const iter = values[Symbol.iterator]()
      let cur = iter.next()
      const doneArr: boolean[] = []
      for (let i = 0; !cur.done; i++) {
        const value = cur.value
        cur = iter.next()
        doneArr.push(false)
        if (isPromise(value)) {
          // 如果为 thenable，根据该 thenable 的状态进行判断
          value.then(resolve, () => {
            doneArr[i] = true
            // 只有传入迭代器的值全是 thenable 并且 thenable 的状态全部为 rejected 才会触发
            if (cur.done && doneArr.every((item) => item)) {
              //应该抛出 AggregateError 的错误类型，但是因为 AggregateError 因为是实验版本，所有只有最新版浏览器才会有，我这里就用 Error代替了
              const e = new Error('All promises were rejected')
              e.stack = ''
              reject(e)
            }
          })
        } else {
          resolve(value)
        }
      }
    })
  }
}

//@ts-ignore
MyPromise.defer = MyPromise.deferred = function () {
  let dfd: any = {}
  dfd.promise = new MyPromise((resolve, reject) => {
    dfd.resolve = resolve
    dfd.reject = reject
  })
  return dfd
}

export = MyPromise
