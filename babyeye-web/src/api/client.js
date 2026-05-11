const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export async function apiGet(path) {
  const response = await fetch(API_BASE_URL + path, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const message = await safeReadError(response)
    throw new Error(message || 'API 요청 실패: ' + response.status)
  }

  return response.json()
}

export async function apiPost(path, body) {
  const response = await fetch(API_BASE_URL + path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const message = await safeReadError(response)
    throw new Error(message || 'API 요청 실패: ' + response.status)
  }

  return response.json()
}

export async function apiPostFormData(path, formData) {
  const response = await fetch(API_BASE_URL + path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  })

  if (!response.ok) {
    const message = await safeReadError(response)
    throw new Error(message || 'API 요청 실패: ' + response.status)
  }

  return response.json()
}

async function safeReadError(response) {
  try {
    const data = await response.json()
    return data.detail || data.message || JSON.stringify(data)
  } catch {
    return response.statusText
  }
}
