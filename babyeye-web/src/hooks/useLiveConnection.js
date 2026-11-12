import { useEffect, useRef, useState } from 'react'
import { LiveHost, LiveViewer } from '../services/liveConnection'
import { registerLiveCleanup } from '../services/liveResources'

function useController(Controller, videoRef) {
  const controllerRef = useRef(null)
  const streamRef = useRef(null)
  if (!controllerRef.current) controllerRef.current = new Controller()
  const controller = controllerRef.current
  const [state, setState] = useState(controller.state)
  controller.onStream = stream => {
    streamRef.current = stream
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      if (stream) video.play()?.catch(() => {})
    }
  }
  useEffect(() => {
    controller.onState = setState
    const stop = () => controller.stop()
    const unregister = registerLiveCleanup(stop)
    window.addEventListener('pagehide', stop)
    return () => {
      controller.onState = null
      unregister(); window.removeEventListener('pagehide', stop)
      controller.stop()
    }
  }, [controller])
  return { ...state, streamRef, start: session => controller.start(session), stop: () => controller.stop() }
}
export const useLiveHost = videoRef => useController(LiveHost, videoRef)
export const useLiveViewer = videoRef => useController(LiveViewer, videoRef)
