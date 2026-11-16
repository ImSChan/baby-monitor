// Run from repository root with local Vite at 5180 and VITE_API_BASE_URL=http://127.0.0.1:8793. All API responses are mocked.
const {createRequire}=await import('node:module'); const {mkdir,writeFile}=await import('node:fs/promises');
const require=createRequire(process.cwd()+'/work/review-browser/package.json'); const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const output=process.cwd()+'/work/home-preview'; await mkdir(output,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const now=Date.now(); const state=(i)=>({id:i+1,emotion:['배고픔','졸림','안정','불편함'][i%4],need:['feeding','sleep','stable','care'][i%4],confidence:.82,created_at:new Date(now-i*120000).toISOString(),message:'수유가 필요한지 살펴봐 주세요.',topPredictions:[{emotion:'배고픔',need:'feeding',confidence:.82},{emotion:'졸림',need:'sleep',confidence:.12}]});
 let mode='data';
 await page.route('**/api/**',async route=>{
  if(!['fetch','xhr'].includes(route.request().resourceType()))return route.continue();
  if(new URL(route.request().url()).origin!=='http://127.0.0.1:8793'){errors.push('Unexpected API origin');return route.abort();}
  const path=new URL(route.request().url()).pathname;
  if(mode==='error' && ['/api/dashboard','/api/emotions/history'].includes(path))return route.fulfill({status:503,contentType:'application/json',body:'{"detail":"mock offline"}'});
  let value;
  if(path==='/api/auth/me')value={id:1,name:'보호자',email:'preview@example.invalid'};
  else if(path==='/api/push/preferences')value={enabled:false};
  else if(path==='/api/dashboard')value={currentEmotion:mode==='empty'?null:{...state(0),created_at:new Date(mode==='old'?now-86400000:now).toISOString()}};
  else if(path==='/api/emotions/history')value=mode==='data'?Array.from({length:20},(_,i)=>state(i)):[];
  else if(path==='/api/live/config')value={protocolVersion:2,iceServers:[]};
  else if(path==='/api/live/sessions')value=[];
  else if(path==='/api/push/events')value={items:[],unreadCount:0};
  else return route.fulfill({status:404,contentType:'application/json',body:'{"detail":"Not Found"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.addInitScript(()=>sessionStorage.setItem('babyeye_access_token','isolated-browser-fixture'));
 await page.goto('http://127.0.0.1:5180/');await page.getByText('배가 고픈 것 같아요').waitFor();
 await page.screenshot({path:output+'/01-home-overview.png'});await page.screenshot({path:output+'/02-home-full.png',fullPage:true});
 if(await page.locator('nav a').count()!==5)throw new Error('Unexpected bottom tabs');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Horizontal overflow');
 const summary=await page.getByRole('region',{name:'최근 아기 상태'}).boundingBox();const live=await page.getByRole('region',{name:'라이브 확인'}).boundingBox();if(summary.y>=live.y)throw new Error('Live before analysis');
 await page.getByRole('button',{name:'분석 기록 20건 모두 보기'}).click();if(await page.locator('ol li').count()!==20)throw new Error('Missing history');
 await page.goto('http://127.0.0.1:5180/emotion');await page.waitForURL('http://127.0.0.1:5180/');
 mode='empty';await page.reload();await page.getByText('첫 분석을 기다리고 있어요').waitFor();await page.screenshot({path:output+'/03-home-empty.png',fullPage:true});
 mode='old';await page.reload();await page.getByText('이전 분석 기록').waitFor();await page.screenshot({path:output+'/04-home-older-result.png'});
 mode='error';await page.reload();await page.getByText('분석 결과를 불러오지 못했어요').waitFor();await page.screenshot({path:output+'/05-home-unavailable.png'});
 mode='data';await page.setViewportSize({width:320,height:740});await page.reload();await page.getByText('배가 고픈 것 같아요').waitFor();if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Narrow screen overflow');await page.screenshot({path:output+'/06-home-narrow.png'});
 if(errors.length)throw new Error(errors.join('\n'));
 const result={status:'passed',viewport:'390x844',cases:['populated','empty','older result','20-record history','legacy emotion redirect','five tabs including care','no horizontal overflow','server unavailable','320px narrow viewport'],pageErrors:errors,api:'mock'};
 await writeFile(output+'/browser-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}
