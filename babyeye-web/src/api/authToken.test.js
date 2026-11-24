import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {AUTH_TOKEN_KEY,getAccessToken,setAccessToken,clearAccessToken} from './authToken'
const mock=vi.hoisted(()=>({stop:vi.fn()}))
vi.mock('../services/liveResources',()=>({stopAllLiveResources:mock.stop}))
beforeEach(()=>{
 const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),clear:()=>values.clear()}}
 vi.stubGlobal('localStorage',storage());vi.stubGlobal('sessionStorage',storage());vi.clearAllMocks()
})
afterEach(()=>{vi.unstubAllGlobals()})
it('keeps the credential when tab session storage is cleared or the app reopens',()=>{
 setAccessToken('persistent');sessionStorage.clear()
 expect(getAccessToken()).toBe('persistent');expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('persistent')
})
it('migrates a legacy tab credential once',()=>{
 sessionStorage.setItem(AUTH_TOKEN_KEY,'legacy')
 expect(getAccessToken()).toBe('legacy');expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('legacy')
 expect(sessionStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
})
it('does not restore a stale tab credential over the persisted account',()=>{
 localStorage.setItem(AUTH_TOKEN_KEY,'new');sessionStorage.setItem(AUTH_TOKEN_KEY,'old')
 expect(getAccessToken()).toBe('new');expect(sessionStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
})
it('clears both storage locations and stops live resources on logout',()=>{
 localStorage.setItem(AUTH_TOKEN_KEY,'new');sessionStorage.setItem(AUTH_TOKEN_KEY,'old')
 clearAccessToken();expect(getAccessToken()).toBeNull();expect(mock.stop).toHaveBeenCalledOnce()
})
