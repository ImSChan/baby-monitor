import {afterEach,expect,it,vi} from 'vitest'
const mock=vi.hoisted(()=>({post:vi.fn()}))
vi.mock('./client',()=>({apiGet:vi.fn(),apiPostFormData:mock.post}))
import {requestMultimodalInference} from './inferenceApi'
afterEach(()=>vi.clearAllMocks())
it('does not associate an unknown-time video with current care records',()=>{
  requestMultimodalInference({capturedAt:new Date().toISOString()})
  expect(mock.post.mock.calls[0][1].get('care_context_allowed')).toBe('false')
})
it('opts in live/known-time analysis without accepting client context scores',()=>{
  requestMultimodalInference({capturedAt:'2026-11-16T23:00:00Z',careContextAllowed:true})
  const form=mock.post.mock.calls[0][1]
  expect(form.get('care_context_allowed')).toBe('true');expect(form.get('care_context')).toBeNull()
})
