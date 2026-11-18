import { useEffect, useState } from 'react'

export const FRAME_STALE_MS = 10000
export default function useVideoFreshness(videoRef, sessionKey, enabled) {
  const [state, setState] = useState({ key: null, lastFrameAt: null, phase: 'idle' })
  useEffect(() => {
    if (!enabled || !sessionKey) return
    const video = videoRef.current
    if (!video) return
    let active = true, lastFrameAt = null, frameHandle, lastCount = null
    const startedAt = Date.now()
    const supported = typeof video.requestVideoFrameCallback === 'function' ||
      typeof video.getVideoPlaybackQuality === 'function' || typeof video.webkitDecodedFrameCount === 'number'
    function publish() {
      if (!active) return
      const phase = document.hidden ? 'hidden' : !supported ? 'unknown' : lastFrameAt
        ? Date.now() - lastFrameAt > FRAME_STALE_MS ? 'stalled' : 'live'
        : Date.now() - startedAt > FRAME_STALE_MS ? 'stalled' : 'waiting'
      setState({ key: sessionKey, lastFrameAt, phase })
    }
    function frame() {
      if (!active) return
      lastFrameAt = Date.now()
      frameHandle = video.requestVideoFrameCallback(frame)
    }
    if (typeof video.requestVideoFrameCallback === 'function') frameHandle = video.requestVideoFrameCallback(frame)
    function tick() {
      if (typeof video.requestVideoFrameCallback !== 'function' && supported) {
        const count = video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount
        if (Number.isFinite(count) && count > 0 && lastCount !== null && count > lastCount) lastFrameAt = Date.now()
        lastCount = count
      }
      publish()
    }
    tick()
    const timer = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', publish)
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', publish);
      if (frameHandle !== undefined) video.cancelVideoFrameCallback?.(frameHandle) }
  }, [videoRef, sessionKey, enabled])
  return enabled && sessionKey ? state.key === sessionKey ? state : { lastFrameAt: null, phase: 'waiting' }
    : { lastFrameAt: null, phase: 'idle' }
}
