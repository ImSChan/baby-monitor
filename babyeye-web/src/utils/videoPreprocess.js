export async function preprocessVideoForInference(videoFile, options = {}) {
  const framesPerSecond = options.framesPerSecond || 1

  const frameResult = await extractFramesFromVideo(videoFile, framesPerSecond)
  const audioFile = await extractAudioBestEffort(videoFile)

  return {
    audioFile,
    frameFiles: frameResult.frameFiles,
    durationSeconds: frameResult.durationSeconds,
    frameRate: framesPerSecond,
  }
}

async function extractFramesFromVideo(videoFile, framesPerSecond) {
  const videoUrl = URL.createObjectURL(videoFile)
  const video = document.createElement('video')

  video.src = videoUrl
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  await waitForLoadedMetadata(video)

  const durationSeconds = video.duration || 0
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  canvas.width = video.videoWidth || 640
  canvas.height = video.videoHeight || 360

  const interval = 1 / framesPerSecond
  const frameFiles = []
  let frameIndex = 0

  for (let time = 0; time < durationSeconds; time += interval) {
    const safeTime = Math.min(time, Math.max(durationSeconds - 0.05, 0))

    await seekVideo(video, safeTime)

    context.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85)
    const frameFile = new File(
      [blob],
      'frame_' + String(frameIndex).padStart(5, '0') + '.jpg',
      {
        type: 'image/jpeg',
      }
    )

    frameFiles.push(frameFile)
    frameIndex += 1
  }

  URL.revokeObjectURL(videoUrl)

  return {
    frameFiles,
    durationSeconds,
  }
}

function waitForLoadedMetadata(video) {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('영상 메타데이터를 불러오지 못했습니다.'))
  })
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error('영상 프레임 이동 중 오류가 발생했습니다.'))
    video.currentTime = time
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
