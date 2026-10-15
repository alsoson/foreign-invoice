import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/api'

/**
 * 載入資料的共用 hook：回傳 data、error、loading，以及 reload()。
 * deps 改變時自動重新載入；reload 時保留舊資料，不會閃爍。
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    try {
      const d = await fnRef.current()
      if (my === seq.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (my === seq.current) setError(errorMessage(e))
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload, setData }
}
