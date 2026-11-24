import { analysisTime,babyStatus } from './babyStatus'
const keys=['feeding','sleep','care','stable']
const labels={feeding:'배고픔',sleep:'졸림',care:'불편함',stable:'안정'}
function valid(value){if(value==null||value===''||typeof value==='boolean')return null;const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=1?n:null}
function scores(row){
 const values={}
 for(const item of row.topPredictions||row.top_predictions||[]){const state=babyStatus(item).key,value=valid(item.confidence);if(keys.includes(state)&&value!==null)values[state]=Math.max(values[state]??value,value)}
 const state=babyStatus(row).key,value=valid(row.confidence)
 if(keys.includes(state)&&value!==null)values[state]=value
 return values
}
export function averageConsecutive(rows){
 if(rows.length!==3)return null
 const latest=rows[0],primary=babyStatus(latest).key
 if(!keys.includes(primary)||rows.some(row=>babyStatus(row).key!==primary||(row.camera_id??row.cameraId??0)!==(latest.camera_id??latest.cameraId??0)))return null
 const snapshots=rows.map(scores),coverage={},means={}
 for(const state of keys){coverage[state]=snapshots.filter(row=>state in row).length;if(coverage[state]===3)means[state]=Math.round(snapshots.reduce((sum,row)=>sum+row[state],0)/3*1e6)/1e6}
 const alternatives=keys.filter(key=>key!==primary&&key in means).sort((a,b)=>means[b]-means[a]||a.localeCompare(b)).slice(0,2)
 return {...latest,need:primary,emotion:labels[primary],confidence:means[primary]??null,createdAt:analysisTime(latest),
   topPredictions:[primary,...alternatives].map(need=>({need,emotion:labels[need],confidence:means[need]??null})),
   sampleIds:rows.map(row=>row.id).reverse(),sampleCount:3,consecutiveCount:3,
   scoreBasis:'three_consecutive_mean',candidateCoverage:coverage}
}
export function representativeFromHistory(history){
 const groups=new Map(),matches=[]
 for(const row of [...history].sort((a,b)=>Number(b.id)-Number(a.id))){const camera=row.camera_id??row.cameraId??0;if(!groups.has(camera))groups.set(camera,[]);groups.get(camera).push(row)}
 for(const rows of groups.values())for(let i=0;i<=rows.length-3;i++){const result=averageConsecutive(rows.slice(i,i+3));if(result){matches.push(result);break}}
 return matches.sort((a,b)=>Number(b.id)-Number(a.id))[0]||null
}
