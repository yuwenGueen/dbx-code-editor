export interface Snapshot { path:string;content:string;revision:string;encoding:string }
export interface Proposal { path:string;content:string;before?:Snapshot;applied?:string;rejected?:boolean }
export interface SessionState { draft:string;mode:'agent'|'ask';model?:{configId:string;model:string};context:string[];proposals:Proposal[] }
const pathOK=(p:unknown):p is string=>typeof p==='string'&&p.length>0&&p.length<4096&&!/[\\:\x00]/.test(p)&&!p.split('/').some(s=>!s||s==='.'||s==='..'||s.toLowerCase()==='.git');
export function restoreSessionState(value:unknown):SessionState {
 const empty:SessionState={draft:'',mode:'agent',context:[],proposals:[]};
 if(!value||typeof value!=='object')return empty;
 const v=value as Partial<SessionState>;
 empty.draft=typeof v.draft==='string'?v.draft.slice(0,8000):'';
 empty.mode=v.mode==='ask'?'ask':'agent';
 if(v.model&&typeof v.model.configId==='string'&&typeof v.model.model==='string')empty.model={configId:v.model.configId,model:v.model.model};
 if(Array.isArray(v.context))empty.context=v.context.filter(pathOK).slice(0,100);
 if(Array.isArray(v.proposals))for(const p of v.proposals.slice(0,8)){
  if(!p||!pathOK(p.path)||typeof p.content!=='string'||p.content.length>16000)continue;
  if(p.before&&(!pathOK(p.before.path)||p.before.path!==p.path||typeof p.before.content!=='string'||p.before.content.length>12000||typeof p.before.revision!=='string'||typeof p.before.encoding!=='string'))continue;
  empty.proposals.push({path:p.path,content:p.content,before:p.before?{...p.before}:undefined,applied:typeof p.applied==='string'?p.applied:undefined,rejected:p.rejected===true});
 }
 return empty;
}
