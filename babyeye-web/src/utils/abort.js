export function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError')
}
export function abortableDelay(ms, signal) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(new DOMException('작업이 취소되었습니다.', 'AbortError')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve() }, ms)
    signal?.addEventListener('abort', stop, { once: true })
  })
}
