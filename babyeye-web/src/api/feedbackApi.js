
import {
  apiGet,
  apiPost,
  getApiBaseUrl,
} from './client'

import { getAccessToken } from './authToken'

// 최근 추론 이력
export async function getInferenceHistory(limit = 20, offset = 0) {
  return apiGet(
    `/api/inference/history?limit=${limit}&offset=${offset}`
  )
}

// 현재 사용자의 피드백 조회
export async function getFeedbackList(limit = 100, offset = 0) {
  return apiGet(
    `/api/feedback?limit=${limit}&offset=${offset}`
  )
}

// 신규 피드백 제출
export async function createFeedback(data) {
  return apiPost('/api/feedback', data)
}

// 기존 피드백 수정
export async function updateFeedback(feedbackId, data) {
  const token = getAccessToken()

  const response = await fetch(
    `${getApiBaseUrl()}/api/feedback/${feedbackId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token
          ? { Authorization: `Bearer ${token}` }
          : {}),
      },
      body: JSON.stringify(data),
    }
  )

  if (!response.ok) {
    let message = `피드백 수정 실패 (${response.status})`

    try {
      const body = await response.json()
      if (typeof body.detail === 'string') {
        message = body.detail
      }
    } catch {
      // 서버가 JSON을 반환하지 않는 경우
    }

    const error = new Error(message)
    error.status = response.status
    throw error
  }

  return response.json()
}
