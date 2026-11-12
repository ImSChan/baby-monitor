import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ get:vi.fn(), post:vi.fn() }))
vi.mock('./client', () => ({ apiGet:mocks.get, apiPost:mocks.post, getApiBaseUrl:() => 'https://api.example.test' }))
import { getLiveSessions, getLiveConfig, endLiveSession } from './liveApi'
beforeEach(() => vi.clearAllMocks())
it('refuses legacy servers before fetching a globally visible session list', async () => {
  mocks.get.mockRejectedValue({status:404})
  await expect(getLiveSessions()).rejects.toThrow('적용이 필요')
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/api/live/config', {})
})
it('rejects unsupported authentication protocol versions', async () => {
  mocks.get.mockResolvedValue({protocolVersion:1,iceServers:[]})
  await expect(getLiveConfig()).rejects.toThrow('인증 버전')
})
it('scopes cleanup to the captured token and uses keepalive', async () => {
  const fetcher = vi.fn().mockResolvedValue({status:204}); vi.stubGlobal('fetch',fetcher)
  await endLiveSession('room','original-account-token')
  expect(fetcher).toHaveBeenCalledWith('https://api.example.test/api/live/sessions/room', {
    method:'DELETE', headers:{Authorization:'Bearer original-account-token'}, keepalive:true,
  })
  vi.unstubAllGlobals()
})
