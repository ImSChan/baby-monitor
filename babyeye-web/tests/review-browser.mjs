// Run with the loopback review_demo.py and Vite (5179 -> 8791) already running.
// Playwright is installed in ignored work/review-browser, not product packages.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const require = createRequire(new URL('../../work/review-browser/package.json', import.meta.url))
const { chromium } = require('playwright')
const output = resolve(process.env.REVIEW_TEST_OUTPUT || 'work/review-browser/results')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  // Simulate only the native device boundary; app context/banner/routes are real.
  await page.route('**/src/services/pushService.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const isAndroid = () => true;
    export const resumePush = () => {};
    export const registerToken = async () => {};
    export const revokePush = async () => {};
  ` }))
  await page.route('**/@capacitor_push-notifications.js*', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.__mockPushHandlers = {};
    export const PushNotifications = {
      addListener: async (name, handler) => { window.__mockPushHandlers[name] = handler; return {remove() {}}; },
      checkPermissions: async () => ({receive: 'granted'}),
      requestPermissions: async () => ({receive: 'granted'}),
      createChannel: async () => {}, register: async () => {}, removeAllDeliveredNotifications: async () => {},
    };
  ` }))
  const session = await (await fetch('http://127.0.0.1:8791/mock/session')).json()
  await page.addInitScript(token => sessionStorage.setItem('babyeye_access_token', token), session.access_token)
  await page.goto('http://127.0.0.1:5179/notifications')
  await page.getByText('아직 도착한 알림이 없어요.').waitFor()
  const emitted = await (await fetch('http://127.0.0.1:8791/mock/emit', { method: 'POST' })).json()
  if (emitted.analyses !== 21 || emitted.outboxCount !== 2) throw new Error(JSON.stringify(emitted))
  const outbox = await (await fetch('http://127.0.0.1:8791/mock/outbox')).json()
  await page.waitForFunction(() => !!window.__mockPushHandlers?.pushNotificationReceived)
  await page.evaluate(notification => window.__mockPushHandlers.pushNotificationReceived(notification), outbox.items[0])
  await page.getByText('새 상태 알림이 도착했어요').waitFor()
  await page.screenshot({ path: resolve(output, '01-mock-push-banner.png'), fullPage: true })
  await page.getByRole('link', { name: '알림 확인', exact: true }).click()
  await page.getByRole('button', { name: '졸렸어요', exact: true }).click()
  await page.getByText('3개 분석에 일괄 반영했어요.').waitFor()
  await page.getByRole('button', { name: '실행 취소' }).click()
  await page.getByText('이전 응답으로 되돌렸어요.').waitFor()
  if (await page.getByRole('slider').count()) throw new Error('Range control remains')
  await page.getByRole('button', { name: '배고팠어요', exact: true }).click()
  await page.getByText('3개 분석에 일괄 반영했어요.').waitFor()
  await page.screenshot({ path: resolve(output, '02-automatic-feedback-saved.png'), fullPage: true })
  await fetch('http://127.0.0.1:8791/mock/remind', { method: 'POST' })
  const digestOutbox = await (await fetch('http://127.0.0.1:8791/mock/outbox')).json()
  const digest = digestOutbox.items.find(message => message.data.kind === 'review')
  if (!digest) throw new Error('No scheduled digest delivered')
  await page.evaluate(notification => window.__mockPushHandlers.pushNotificationActionPerformed({ notification }), digest)
  await page.getByRole('heading', { name: '지난 12시간 돌아보기', exact: true }).waitFor()
  await page.getByRole('button', { name: '응답 완료 · 확인/수정' }).waitFor()
  await page.getByText('졸림 감지', { exact: true }).waitFor()
  await page.screenshot({ path: resolve(output, '04-twelve-hour-review.png'), fullPage: true })
  await page.getByText('정기 돌아보기 알림 설정', { exact: true }).click()
  const checkbox = page.getByRole('checkbox', { name: '돌아보기 알림 받기' })
  await checkbox.uncheck()
  await page.getByRole('button', { name: '알림 설정 저장' }).click()
  await page.getByText('돌아보기 알림 설정을 저장했어요.').waitFor()
  // Same results must not leak into another account.
  const other = await page.request.get('http://127.0.0.1:8791/api/reviews', { headers: { Authorization: 'Bearer invalid' } })
  if (other.status() !== 401) throw new Error('Invalid JWT was accepted')
  if (errors.length) throw new Error(errors.join('\n'))
  const result = { status: 'passed', analyses: 21, immediateNotifications: 2, scheduledNotifications: 1,
    automaticFeedbackCount: 3, oneTapFeedbackAndUndo: true, nativeBridge: 'mock', FCMTransport: 'captured', pageErrors: errors }
  await writeFile(resolve(output, 'browser-test-results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally { await browser.close() }
