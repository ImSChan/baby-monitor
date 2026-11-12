import React from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get:vi.fn(), post:vi.fn(), revoke:vi.fn() }))
vi.mock('../api/client', () => ({ apiGet:mocks.get, apiPost:mocks.post }))
vi.mock('../services/pushService', () => ({ revokePush:mocks.revoke }))
import { AuthProvider, useAuth } from './AuthContext'
import { setAccessToken, getAccessToken } from '../api/authToken'
import { registerLiveCleanup } from '../services/liveResources'
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b}); return {promise, resolve, reject} }
beforeEach(() => {
  vi.clearAllMocks()
  const storage = new Map()
  vi.stubGlobal('sessionStorage', { getItem:k => storage.get(k) || null, setItem:(k,v) => storage.set(k,v), removeItem:k => storage.delete(k) })
  mocks.get.mockResolvedValue({id:1}); mocks.post.mockResolvedValue({access_token:'new-token'}); mocks.revoke.mockResolvedValue()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const wrapper = ({children}) => <AuthProvider>{children}</AuthProvider>
it('does not restore an old account after its session has ended', async () => {
  setAccessToken('old-token'); const restored = defer(); mocks.get.mockReturnValue(restored.promise)
  const {result} = renderHook(() => useAuth(), {wrapper})
  act(() => result.current.expireSession())
  await act(async () => restored.resolve({id:1}))
  expect(result.current.user).toBe(null); expect(getAccessToken()).toBe(null)
})
it('does not clear a new login when a previous logout finishes late', async () => {
  setAccessToken('old-token')
  const {result} = renderHook(() => useAuth(), {wrapper})
  await waitFor(() => expect(result.current.user?.id).toBe(1))
  const revoked = defer(); mocks.revoke.mockReturnValue(revoked.promise)
  let logout; act(() => { logout = result.current.logout() })
  mocks.get.mockResolvedValue({id:2})
  await act(async () => result.current.login('two@example.com','password'))
  await act(async () => { revoked.resolve(); await logout })
  expect(result.current.user.id).toBe(2); expect(getAccessToken()).toBe('new-token')
})
it('releases live resources before waiting for push deregistration', async () => {
  setAccessToken('old-token')
  const {result} = renderHook(() => useAuth(), {wrapper})
  await waitFor(() => expect(result.current.user?.id).toBe(1))
  const stopped = vi.fn(), remove = registerLiveCleanup(stopped)
  const revoked = defer(); mocks.revoke.mockReturnValue(revoked.promise)
  let outcome; act(() => { outcome = result.current.logout().catch(error => error.message) })
  expect(stopped).toHaveBeenCalledOnce()
  await act(async () => { revoked.reject(new Error('offline')); await outcome })
  expect(getAccessToken()).toBe('old-token'); remove()
})
it('ignores a superseded login response', async () => {
  const first = defer(); mocks.post.mockReturnValueOnce(first.promise)
  const {result} = renderHook(() => useAuth(), {wrapper})
  let old; act(() => { old = result.current.login('one@example.com','password').catch(error => error.name) })
  mocks.get.mockResolvedValue({id:2})
  await act(async () => result.current.login('two@example.com','password'))
  await act(async () => { first.resolve({access_token:'stale-token'}); await old })
  expect(result.current.user.id).toBe(2); expect(getAccessToken()).toBe('new-token')
})
