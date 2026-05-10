const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export async function apiGet(path) {
  const response = await fetch(${API_BASE_URL}, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const message = await safeReadError(response)
    throw new Error(message || API 요청 실패: )
  }

  return response.json()
}

export async function apiPost(path, body) {
  const response = await fetch(${API_BASE_URL}, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const message = await safeReadError(response)
    throw new Error(message || API 요청 실패: )
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
