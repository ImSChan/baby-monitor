import { apiPostFormData } from './client'

export function requestMultimodalInference({
  videoFile,
  audioFile,
  frameFiles,
  cameraId,
  capturedAt,
  frameRate,
  durationSeconds,
}) {
  const formData = new FormData()

  if (videoFile) {
    formData.append('video_file', videoFile)
  }

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
