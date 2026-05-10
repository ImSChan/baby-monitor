import { useEffect, useState } from 'react'

export function useApi(fetcher, dependencies = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let ignore = false

    async function load() {
      try {
        setLoading(true)
        setError(null)

        const result = await fetcher()

        if (!ignore) {
          setData(result)
        }
      } catch (err) {
        if (!ignore) {
          setError(err)
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, dependencies)

  return {
    data,
    loading,
    error,
  }
}
