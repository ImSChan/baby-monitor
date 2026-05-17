import { apiGet, apiPostFormData } from './client'

export function requestMultimodalInference({
  audioFile,
  frameFiles,
  cameraId,
  capturedAt,
  frameRate,
  durationSeconds,
}) {
  const formData = new FormData()

  if (audioFile) {
    formData.append('audio_file', audioFile)
  }

  frameFiles.forEach((frameFile) => {
    formData.append('frame_files', frameFile)
  })

  if (cameraId) {
    formData.append('camera_id', String(cameraId))
  }

  if (capturedAt) {
    formData.append('captured_at', capturedAt)
  }

  if (frameRate) {
    formData.append('frame_rate', String(frameRate))
  }

  if (durationSeconds) {
    formData.append('duration_seconds', String(durationSeconds))
  }

  return apiPostFormData('/api/inference/multimodal', formData)
}

export function getInferenceStatus(requestId) {
  return apiGet('/api/inference/requests/' + requestId + '/status')
}

export function getInferenceResult(requestId) {
  return apiGet('/api/inference/requests/' + requestId + '/result')
}

export function buildInferenceDebugUrls(apiBaseUrl, requestId) {
  return {
    lastFrameUrl:
      apiBaseUrl + '/api/inference/requests/' + requestId + '/last-frame',
    audioUrl:
      apiBaseUrl + '/api/inference/requests/' + requestId + '/audio',
    metadataUrl:
      apiBaseUrl + '/api/inference/requests/' + requestId + '/metadata',
    statusUrl:
      apiBaseUrl + '/api/inference/requests/' + requestId + '/status',
    resultUrl:
      apiBaseUrl + '/api/inference/requests/' + requestId + '/result',
  }
}
