export async function preprocessVideoForInference(videoFile, options = {}) {
  const framesPerSecond = options.framesPerSecond || 1
  const maxFrames = options.maxFrames || 20
  const maxWidth = options.maxWidth || 640
  const onProgress = options.onProgress || (() => {})

  onProgress('영상 메타데이터를 불러오는 중입니다...')

  const frameResult = await extractFramesFromVideo(videoFile, {
    framesPerSecond,
    maxFrames,
    maxWidth,
    onProgress,
  })

  onProgress('오디오 추출을 시도하는 중입니다...')

  const audioFile = await extractAudioBestEffort(videoFile)

  return {
    audioFile,
    frameFiles: frameResult.frameFiles,
    durationSeconds: frameResult.durationSeconds,
    frameRate: framesPerSecond,
  }
}

async function extractFramesFromVideo(videoFile, options) {
  const { framesPerSecond, maxFrames, maxWidth, onProgress } = options

  const videoUrl = URL.createObjectURL(videoFile)
  const video = document.createElement('video')

  video.src = videoUrl
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.controls = false

  video.style.position = 'fixed'
  video.style.left = '-9999px'
  video.style.top = '-9999px'
  video.style.width = '1px'
  video.style.height = '1px'
  video.style.opacity = '0'

  document.body.appendChild(video)

  try {
    video.load()

    await waitForEvent(video, 'loadedmetadata', 10000)

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('영상 길이를 확인할 수 없습니다. 다른 형식의 영상으로 시도해주세요.')
    }

    await waitForEvent(video, 'loadeddata', 10000).catch(() => {
      // 일부 모바일 브라우저에서는 loadeddata가 늦거나 안 올 수 있으므로 무시
    })

    const durationSeconds = video.duration
    const originalWidth = video.videoWidth || 640
    const originalHeight = video.videoHeight || 360

    const scale = Math.min(1, maxWidth / originalWidth)
    const canvasWidth = Math.max(1, Math.round(originalWidth * scale))
    const canvasHeight = Math.max(1, Math.round(originalHeight * scale))

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    canvas.width = canvasWidth
    canvas.height = canvasHeight

    const interval = 1 / framesPerSecond
    const estimatedFrameCount = Math.ceil(durationSeconds / interval)
    const targetFrameCount = Math.min(estimatedFrameCount, maxFrames)

    const frameFiles = []

    for (let index = 0; index < targetFrameCount; index += 1) {
      const time = Math.min(index * interval, Math.max(durationSeconds - 0.1, 0))

      onProgress(
        '프레임 추출 중입니다... ' +
          (index + 1) +
          '/' +
          targetFrameCount
      )

      await seekVideoSafely(video, time)

      context.drawImage(video, 0, 0, canvasWidth, canvasHeight)

      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.8)
      const frameFile = new File(
        [blob],
        'frame_' + String(index).padStart(5, '0') + '.jpg',
        {
          type: 'image/jpeg',
        }
      )

      frameFiles.push(frameFile)
    }

    return {
      frameFiles,
      durationSeconds,
    }
  } finally {
    URL.revokeObjectURL(videoUrl)

    if (video.parentNode) {
      video.parentNode.removeChild(video)
    }
  }
}

function waitForEvent(target, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false

    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error(eventName + ' 대기 시간이 초과되었습니다.'))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      target.removeEventListener(eventName, onSuccess)
      target.removeEventListener('error', onError)
    }

    function onSuccess() {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }

    function onError() {
      if (finished) return
      finished = true
      cleanup()
      reject(new Error('영상 로드 중 오류가 발생했습니다.'))
    }

    target.addEventListener(eventName, onSuccess, { once: true })
    target.addEventListener('error', onError, { once: true })
  })
}

function seekVideoSafely(video, time) {
  return new Promise((resolve) => {
    let done = false

    const timeout = setTimeout(() => {
      if (done) return
      done = true
      cleanup()
      resolve()
    }, 3000)

    function cleanup() {
      clearTimeout(timeout)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('timeupdate', onTimeUpdate)
    }

    function finish() {
      if (done) return
      done = true
      cleanup()
      resolve()
    }

    function onSeeked() {
      finish()
    }

    function onTimeUpdate() {
      if (Math.abs(video.currentTime - time) < 0.35) {
        finish()
      }
    }

    video.addEventListener('seeked', onSeeked)
    video.addEventListener('timeupdate', onTimeUpdate)

    try {
      video.currentTime = time
    } catch {
      finish()
    }
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('프레임 이미지를 생성하지 못했습니다.'))
          return
        }

        resolve(blob)
      },
      type,
      quality
    )
  })
}

async function extractAudioBestEffort(videoFile) {
  // 1차 시도: 영상 재생 스트림에서 오디오 트랙 캡처
  const recordedAudio = await extractAudioByMediaRecorder(videoFile)

  if (recordedAudio) {
    return recordedAudio
  }

  // 2차 시도: 기존 AudioContext 방식
  // 일부 webm/audio-friendly 파일에서는 이 방식이 동작할 수 있음
  const decodedAudio = await extractAudioByDecodeAudioData(videoFile)

  if (decodedAudio) {
    return decodedAudio
  }

  return null
}

async function extractAudioByMediaRecorder(videoFile) {
  const videoUrl = URL.createObjectURL(videoFile)
  const video = document.createElement('video')

  video.src = videoUrl
  video.muted = false
  video.playsInline = true
  video.preload = 'auto'
  video.controls = false

  video.style.position = 'fixed'
  video.style.left = '-9999px'
  video.style.top = '-9999px'
  video.style.width = '1px'
  video.style.height = '1px'
  video.style.opacity = '0'

  document.body.appendChild(video)

  try {
    await waitForEvent(video, 'loadedmetadata', 10000)

    const captureStream =
      video.captureStream ||
      video.mozCaptureStream ||
      video.webkitCaptureStream

    if (!captureStream || typeof MediaRecorder === 'undefined') {
      return null
    }

    const stream = captureStream.call(video)
    const audioTracks = stream.getAudioTracks()

    if (!audioTracks || audioTracks.length === 0) {
      return null
    }

    const audioOnlyStream = new MediaStream(audioTracks)

    const mimeType = getSupportedAudioMimeType()

    if (!mimeType) {
      return null
    }

    const chunks = []
    const recorder = new MediaRecorder(audioOnlyStream, {
      mimeType,
    })

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve
    })

    recorder.start()

    video.currentTime = 0

    try {
      await video.play()
    } catch {
      recorder.stop()
      return null
    }

    await waitForVideoEndedOrTimeout(video, 30000)

    if (recorder.state !== 'inactive') {
      recorder.stop()
    }

    await stopped

    if (chunks.length === 0) {
      return null
    }

    const extension = getAudioExtensionByMimeType(mimeType)
    const blob = new Blob(chunks, { type: mimeType })

    return new File([blob], 'audio' + extension, {
      type: mimeType,
    })
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(videoUrl)

    if (video.parentNode) {
      video.parentNode.removeChild(video)
    }
  }
}

async function extractAudioByDecodeAudioData(videoFile) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext

    if (!AudioContextClass) {
      return null
    }

    const audioContext = new AudioContextClass()
    const arrayBuffer = await videoFile.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const wavBuffer = audioBufferToWav(audioBuffer)
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' })

    if (audioContext.close) {
      await audioContext.close()
    }

    return new File([wavBlob], 'audio.wav', {
      type: 'audio/wav',
    })
  } catch {
    return null
  }
}

function getSupportedAudioMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ]

  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }

  return ''
}

function getAudioExtensionByMimeType(mimeType) {
  if (mimeType.includes('webm')) {
    return '.webm'
  }

  if (mimeType.includes('ogg')) {
    return '.ogg'
  }

  if (mimeType.includes('mp4')) {
    return '.m4a'
  }

  return '.webm'
}

function waitForVideoEndedOrTimeout(video, timeoutMs) {
  return new Promise((resolve) => {
    let finished = false

    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onEnded)
    }

    function onEnded() {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }

    video.addEventListener('ended', onEnded, { once: true })
    video.addEventListener('error', onEnded, { once: true })
  })
}async function extractAudioBestEffort(videoFile) {
  // 1차 시도: 영상 재생 스트림에서 오디오 트랙 캡처
  const recordedAudio = await extractAudioByMediaRecorder(videoFile)

  if (recordedAudio) {
    return recordedAudio
  }

  // 2차 시도: 기존 AudioContext 방식
  // 일부 webm/audio-friendly 파일에서는 이 방식이 동작할 수 있음
  const decodedAudio = await extractAudioByDecodeAudioData(videoFile)

  if (decodedAudio) {
    return decodedAudio
  }

  return null
}

async function extractAudioByMediaRecorder(videoFile) {
  const videoUrl = URL.createObjectURL(videoFile)
  const video = document.createElement('video')

  video.src = videoUrl
  video.muted = false
  video.playsInline = true
  video.preload = 'auto'
  video.controls = false

  video.style.position = 'fixed'
  video.style.left = '-9999px'
  video.style.top = '-9999px'
  video.style.width = '1px'
  video.style.height = '1px'
  video.style.opacity = '0'

  document.body.appendChild(video)

  try {
    await waitForEvent(video, 'loadedmetadata', 10000)

    const captureStream =
      video.captureStream ||
      video.mozCaptureStream ||
      video.webkitCaptureStream

    if (!captureStream || typeof MediaRecorder === 'undefined') {
      return null
    }

    const stream = captureStream.call(video)
    const audioTracks = stream.getAudioTracks()

    if (!audioTracks || audioTracks.length === 0) {
      return null
    }

    const audioOnlyStream = new MediaStream(audioTracks)

    const mimeType = getSupportedAudioMimeType()

    if (!mimeType) {
      return null
    }

    const chunks = []
    const recorder = new MediaRecorder(audioOnlyStream, {
      mimeType,
    })

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve
    })

    recorder.start()

    video.currentTime = 0

    try {
      await video.play()
    } catch {
      recorder.stop()
      return null
    }

    await waitForVideoEndedOrTimeout(video, 30000)

    if (recorder.state !== 'inactive') {
      recorder.stop()
    }

    await stopped

    if (chunks.length === 0) {
      return null
    }

    const extension = getAudioExtensionByMimeType(mimeType)
    const blob = new Blob(chunks, { type: mimeType })

    return new File([blob], 'audio' + extension, {
      type: mimeType,
    })
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(videoUrl)

    if (video.parentNode) {
      video.parentNode.removeChild(video)
    }
  }
}

async function extractAudioByDecodeAudioData(videoFile) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext

    if (!AudioContextClass) {
      return null
    }

    const audioContext = new AudioContextClass()
    const arrayBuffer = await videoFile.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const wavBuffer = audioBufferToWav(audioBuffer)
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' })

    if (audioContext.close) {
      await audioContext.close()
    }

    return new File([wavBlob], 'audio.wav', {
      type: 'audio/wav',
    })
  } catch {
    return null
  }
}

function getSupportedAudioMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ]

  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }

  return ''
}

function getAudioExtensionByMimeType(mimeType) {
  if (mimeType.includes('webm')) {
    return '.webm'
  }

  if (mimeType.includes('ogg')) {
    return '.ogg'
  }

  if (mimeType.includes('mp4')) {
    return '.m4a'
  }

  return '.webm'
}

function waitForVideoEndedOrTimeout(video, timeoutMs) {
  return new Promise((resolve) => {
    let finished = false

    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onEnded)
    }

    function onEnded() {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }

    video.addEventListener('ended', onEnded, { once: true })
    video.addEventListener('error', onEnded, { once: true })
  })
}

function audioBufferToWav(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const format = 1
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const blockAlign = numberOfChannels * bytesPerSample

  const samples = interleaveChannels(audioBuffer)
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format, true)
  view.setUint16(22, numberOfChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  floatTo16BitPCM(view, 44, samples)

  return buffer
}

function interleaveChannels(audioBuffer) {
  const numberOfChannels = audioBuffer.numberOfChannels
  const length = audioBuffer.length
  const result = new Float32Array(length * numberOfChannels)

  let offset = 0

  for (let i = 0; i < length; i += 1) {
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      result[offset] = audioBuffer.getChannelData(channel)[i]
      offset += 1
    }
  }

  return result
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff

    view.setInt16(offset, value, true)
    offset += 2
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}
