
import { getAccessToken } from './authToken'

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost'
).replace(/\/$/, '')

export function getApiBaseUrl() {
  return API_BASE_URL
}

async function request(path, options = {}) {
  const token = getAccessToken()

  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(API_BASE_URL + path, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const message = await safeReadError(response)
    const error = new Error(
      message || `API 요청 실패: ${response.status}`
    )
    error.status = response.status
    throw error
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

export function apiGet(path) {
  return request(path, {
    method: 'GET',
  })
}

export function apiPost(path, body) {
  return request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export function apiPostFormData(path, formData) {
  return request(path, {
    method: 'POST',
    body: formData,
  })
}

async function safeReadError(response) {
  try {
    const data = await response.json()

    if (typeof data.detail === 'string') {
      return data.detail
    }

    return data.message || JSON.stringify(data.detail || data)
  } catch {
    return response.statusText
  }
}
