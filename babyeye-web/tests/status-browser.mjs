// Loopback review_demo.py (8791) + Vite --mode review (5179). No production access.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const require = createRequire(new URL('../../work/review-browser/package.json', import.meta.url))
const { chromium } = require('playwright')
const output = resolve(process.env.STATUS_TEST_OUTPUT || 'work/status-browser/results')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const token = await (await fetch('http://127.0.0.1:8791/mock/session')).json()
  await context.addInitScript(value => sessionStorage.setItem('babyeye_access_token', value), token.access_token)
  const errors = []
  const host = await context.newPage(), viewer = await context.newPage()
  for (const page of [host, viewer]) page.on('pageerror', error => errors.push(error.message))
  await host.goto('http://127.0.0.1:5179/camera-host')
  await host.getByRole('checkbox').uncheck()
  await host.getByRole('button', { name: '홈캠 시작하기' }).click()
  await host.getByRole('region', { name: '홈캠 연결 상태' }).getByText('영상 갱신 중', { exact: true }).waitFor({ timeout: 20000 })
  await viewer.goto('http://127.0.0.1:5179/live')
  await viewer.getByRole('button').filter({ hasText: '휴대폰 홈캠' }).click()
  console.log('Viewer connecting')
  const health = viewer.getByRole('region', { name: '홈캠 연결 상태' })
  await health.getByText('영상 갱신 중', { exact: true }).waitFor({ timeout: 30000 })
  if (await health.getByText(/마지막 영상 수신 확인: 아직/).count()) throw new Error('No real frame timestamp')
  await health.screenshot({ path: resolve(output, '01-live-health.png') })
  console.log('Live frames verified')
  await viewer.locator('video').evaluate(video => video.pause())
  await health.getByText('영상 갱신이 멈췄어요', { exact: true }).waitFor({ timeout: 18000 })
  await health.screenshot({ path: resolve(output, '02-video-stalled.png') })
  console.log('Stall detected')
  await viewer.getByRole('button', { name: '영상 재생', exact: true }).click()
  await health.getByText('영상 갱신 중', { exact: true }).waitFor({ timeout: 10000 })
  await viewer.getByRole('button', { name: '다시 연결', exact: true }).click()
  await health.getByText('영상 갱신 중', { exact: true }).waitFor({ timeout: 30000 })
  const other = await (await fetch('http://127.0.0.1:8791/mock/session?user_id=2')).json()
  const ownSessions = await (await fetch('http://127.0.0.1:8791/api/live/sessions', { headers: { Authorization: 'Bearer ' + other.access_token } })).json()
  if (ownSessions.length) throw new Error('Live account isolation failed')
  await fetch('http://127.0.0.1:8791/mock/emit', { method: 'POST' })
  await viewer.evaluate(() => window.dispatchEvent(new Event('babyeye:notifications')))
  await health.getByText(/계정의 마지막 AI 분석 완료:/).filter({ hasNotText: '완료 기록 없음' }).waitFor()
  await host.getByRole('button', { name: /홈캠 종료|홈캠 중지/ }).click()
  await health.getByText('연결 안 됨', { exact: true }).waitFor({ timeout: 10000 })
  await viewer.goto('http://127.0.0.1:5179/')
  const training = viewer.getByRole('region', { name: '개인화 학습 상태' })
  await training.getByText('피드백을 기다리고 있어요').waitFor()
  for (const [stage, text] of [['queued','학습을 기다리고 있어요'],['running','개인화 학습 중이에요'],['completed','학습 완료 · 검토 대기'],['registered','개인화 모델 적용 등록됨']]) {
    await fetch('http://127.0.0.1:8791/mock/training-stage/' + stage, { method: 'POST' })
    await viewer.evaluate(() => window.dispatchEvent(new Event('babyeye:notifications')))
    await training.getByText(text, { exact: true }).waitFor({ timeout: 20000 })
    await training.screenshot({ path: resolve(output, 'training-' + stage + '.png') })
  }
  await training.getByText('저장 및 적용 내역', { exact: true }).click()
  await training.getByText(/음성 모델 적용 등록:/).waitFor()
  await training.screenshot({ path: resolve(output, '03-training-details.png'), style: 'nav{visibility:hidden!important}' })
  if (errors.length) throw new Error(errors.join('\n'))
  const result = { status: 'passed', realLocalWebRTC: true, mediaDevice: 'Chromium fake camera and microphone',
    realRenderedFrames: true, pausedVideoDetected: true, recoveryAndReconnect: true, hostEndCleanup: true,
    accountIsolation: true, trainingStages: ['queued','training','review_ready','registered'],
    trainingExecution: 'fixtures only; no model training or production activation', pageErrors: errors }
  await writeFile(resolve(output, 'browser-test-results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await browser.close() }
