const DEFAULT_OPTIONS = {
  framesPerSecond: 1,
  maxFrames: 20,
  maxWidth: 640,
  audioDurationMs: 5000,
}

export async function preprocessVideoForInference(videoFile, options = {}) {
  const config = {
    ...DEFAULT_OPTIONS,
    ...options,
  }

  const onProgress = typeof config.onProgress === 'function'
    ? config.onProgress
    : () => {}

  onProgress('영상 메타데이터를 확인하는 중입니다...')

  const videoUrl = URL.createObjectURL(videoFile)
  const video = document.createElement('video')

  video.src = videoUrl
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  video.crossOrigin = 'anonymous'

  try {
    await waitForEvent(video, 'loadedmetadata', 10000)

    const durationSeconds = Number.isFinite(video.duration)
      ? video.duration
      : 0

    onProgress('영상 프레임을 추출하는 중입니다...')

    const frameFiles = await extractFramesFromVideo(video, {
      durationSeconds,
      framesPerSecond: config.framesPerSecond,
      maxFrames: config.maxFrames,
      maxWidth: config.maxWidth,
      onProgress,
    })

    onProgress('오디오를 추출하는 중입니다...')

    const audioFile = await extractAudioBestEffort(videoFile, {
      durationMs: Math.min(config.audioDurationMs, Math.max(1000, durationSeconds * 1000 || config.audioDurationMs)),
    })

    const audioMetrics = audioFile
      ? await calculateAudioFileDbfsMetrics(audioFile)
      : null

    if (audioMetrics) {
      onProgress(
        '오디오 분석 지표 계산 완료: RMS ' +
          audioMetrics.rmsDbfs +
          ' dBFS, Peak ' +
          audioMetrics.peakDbfs +
          ' dBFS'
      )
    }

    return {
      audioFile,
      audioMetrics,
      frameFiles,
      durationSeconds,
      frameRate: config.framesPerSecond,
    }
  } finally {
    URL.revokeObjectURL(videoUrl)
  }
}

async function extractFramesFromVideo(video, {
  durationSeconds,
  framesPerSecond,
  maxFrames,
  maxWidth,
  onProgress,
}) {
  const frameFiles = []

  if (!durationSeconds || durationSeconds <= 0) {
    await seekVideo(video, 0)
    const frame = await captureFrame(video, maxWidth, 0)

    return frame ? [frame] : []
  }

  const interval = 1 / Math.max(0.1, framesPerSecond)
  const candidateTimes = []

  for (let time = 0; time < durationSeconds; time += interval) {
    candidateTimes.push(time)

    if (candidateTimes.length >= maxFrames) {
      break
    }
  }

  if (candidateTimes.length === 0) {
    candidateTimes.push(Math.max(0, durationSeconds / 2))
  }

  for (let index = 0; index < candidateTimes.length; index += 1) {
    const time = Math.min(candidateTimes[index], Math.max(0, durationSeconds - 0.1))

    onProgress('프레임 추출 중 ' + (index + 1) + '/' + candidateTimes.length)

    await seekVideo(video, time)

    const frameFile = await captureFrame(video, maxWidth, index)

    if (frameFile) {
      frameFiles.push(frameFile)
    }
  }

  return frameFiles
}

async function captureFrame(video, maxWidth, index) {
  if (!video.videoWidth || !video.videoHeight) {
    return null
  }

  const scale = Math.min(1, maxWidth / video.videoWidth)
  const width = Math.round(video.videoWidth * scale)
  const height = Math.round(video.videoHeight * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  context.drawImage(video, 0, 0, width, height)

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  })

  if (!blob) {
    return null
  }

  return new File(
    [blob],
    'frame_' + String(index).padStart(3, '0') + '.jpg',
    { type: 'image/jpeg' }
  )
}

async function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('영상 프레임 이동 시간이 초과되었습니다.'))
    }, 8000)

    function cleanup() {
      window.clearTimeout(timeout)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
    }

    function handleSeeked() {
      cleanup()
      resolve()
    }

    function handleError() {
      cleanup()
      reject(new Error('영상 프레임 이동 중 오류가 발생했습니다.'))
    }

    video.addEventListener('seeked', handleSeeked, { once: true })
    video.addEventListener('error', handleError, { once: true })

    video.currentTime = Math.max(0, time)
  })
}

async function extractAudioBestEffort(videoFile, options = {}) {
  const durationMs = options.durationMs || 5000

  try {
    return await extractAudioByWebAudio(videoFile, durationMs)
  } catch {
    return null
  }
}

async function extractAudioByWebAudio(videoFile, durationMs) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext

  if (!AudioContextClass) {
    return null
  }

  let audioContext = null

  try {
    audioContext = new AudioContextClass()

    const arrayBuffer = await videoFile.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))

    if (!audioBuffer || audioBuffer.length === 0) {
      return null
    }

    const sourceSampleRate = audioBuffer.sampleRate
    const maxSamples = Math.min(
      audioBuffer.length,
      Math.floor(sourceSampleRate * (durationMs / 1000))
    )

    const source = audioBuffer.getChannelData(0).slice(0, maxSamples)
    const resampled = resampleFloat32(source, sourceSampleRate, 16000)
    const wavBuffer = encodeWav(resampled, 16000)
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' })

    return new File(
      [wavBlob],
      'uploaded_audio_' + Date.now() + '.wav',
      { type: 'audio/wav' }
    )
  } finally {
    if (audioContext) {
      await audioContext.close().catch(() => {})
    }
  }
}

async function calculateAudioFileDbfsMetrics(audioFile) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext

  if (!AudioContextClass) {
    return null
  }

  let audioContext = null

  try {
    audioContext = new AudioContextClass()

    const arrayBuffer = await audioFile.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const channelData = audioBuffer.getChannelData(0)

    return calculateDbfsMetrics(channelData)
  } catch {
    return null
  } finally {
    if (audioContext) {
      await audioContext.close().catch(() => {})
    }
  }
}

function calculateDbfsMetrics(samples) {
  if (!samples || samples.length === 0) {
    return {
      rmsDbfs: -120,
      peakDbfs: -120,
      quietAudio: true,
    }
  }

  let sumSquares = 0
  let peak = 0

  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.abs(samples[index])
    sumSquares += value * value

    if (value > peak) {
      peak = value
    }
  }

  const rms = Math.sqrt(sumSquares / samples.length)
  const rmsDbfs = linearToDbfs(rms)
  const peakDbfs = linearToDbfs(peak)

  return {
    rmsDbfs,
    peakDbfs,
    quietAudio: rmsDbfs <= -42 && peakDbfs <= -20,
  }
}

function linearToDbfs(value) {
  const safeValue = Math.max(Number(value) || 0, 0.000001)
  return Math.round(20 * Math.log10(safeValue) * 10) / 10
}

function resampleFloat32(input, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) {
    return input
  }

  const ratio = inputSampleRate / outputSampleRate
  const outputLength = Math.round(input.length / ratio)
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio
    const leftIndex = Math.floor(sourceIndex)
    const rightIndex = Math.min(leftIndex + 1, input.length - 1)
    const weight = sourceIndex - leftIndex

    output[i] = input[leftIndex] * (1 - weight) + input[rightIndex] * weight
  }

  return output
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  floatTo16BitPCM(view, 44, samples)

  return buffer
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    view.setInt16(offset, value, true)
    offset += 2
  }
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i))
  }
}

function waitForEvent(target, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(eventName + ' 대기 시간이 초과되었습니다.'))
    }, timeoutMs)

    function cleanup() {
      window.clearTimeout(timeout)
      target.removeEventListener(eventName, handleEvent)
      target.removeEventListener('error', handleError)
    }

    function handleEvent() {
      cleanup()
      resolve()
    }

    function handleError() {
      cleanup()
      reject(new Error(eventName + ' 처리 중 오류가 발생했습니다.'))
    }

    target.addEventListener(eventName, handleEvent, { once: true })
    target.addEventListener('error', handleError, { once: true })
  })
}
