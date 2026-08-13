import { useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import { AlertTriangle, BookmarkPlus, Download, FileJson, GitCompareArrows, HardDriveDownload, Layers3, RefreshCcw, RotateCcw, Share2, Trash2, Upload, X } from './Icons'
import { useAppStore } from '../store'
import { exportData } from '../lib/exporters'
import { cloneTemplate } from '../data/templates'
import { MAX_CONFIG_BYTES, parseProjectFile, safeProjectFilename, serializeProject } from '../lib/projectConfig'
import { createSnapshot, diffProjects, MAX_SNAPSHOTS, snapshotStore, type ProjectSnapshot } from '../lib/snapshots'
import { importSchemaText, type ImportPreview } from '../lib/schemaImport'
import { generationHistoryStore, type GenerationHistoryItem } from '../lib/generationHistory'
import { createShareUrl } from '../lib/share'

export function ExportDialog({open,onClose}:{open:boolean;onClose:()=>void}) {
  const s=useAppStore();const [format,setFormat]=useState('json');if(!open)return null
  const formats=[['bundle','完整交付包','JSON / CSV / SQL / 报告'],['json','JSON','完整多表结构'],['jsonl','JSON Lines','当前表逐行 JSON'],['csv','CSV','当前表，通用表格'],['tsv','TSV','当前表，制表符分隔'],['yaml','YAML','完整多表结构'],['xml','XML','完整多表结构'],['xlsx','Excel XLSX','多表工作簿'],['mysql','MySQL SQL','批量 INSERT 脚本'],['postgres','PostgreSQL SQL','批量 INSERT 脚本'],['sqlite','SQLite SQL','批量 INSERT 脚本'],['postman','Postman 数据','Collection Runner'],['playwright','Playwright','TypeScript Fixture'],['cypress','Cypress','TypeScript Fixture'],['jest','Jest','TypeScript Fixture'],['pytest','pytest','参数化测试文件'],['junit','JUnit','参数化 CSV'],['markdown','覆盖报告','Markdown 文档']]
  const run=async()=>{if(!s.result)return;await exportData(format,s.project,s.result.data,s.result.report,s.activeTableId);onClose()}
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className="modal export-modal"><header><div><span>EXPORT CENTER</span><h2>导出数据</h2><p>所有格式均打包为 ZIP，并附 Manifest、SHA-256 和生成元信息。</p></div><button className="icon-button" onClick={onClose}><X/></button></header>{!s.result?<div className="modal-empty">请先生成数据，再选择导出格式。</div>:<><div className="format-grid">{formats.map(([id,name,hint])=><button key={id} className={format===id?'active':''} onClick={()=>setFormat(id)}><FileJson/><span><strong>{name}</strong><small>{hint}</small></span></button>)}</div><div className="export-summary"><span>{s.project.name}</span><code>{s.result.report.totalRows.toLocaleString()} rows</code><code>seed {s.project.seed}</code><code>schema {s.project.version}</code></div></>}<footer><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!s.result} onClick={run}><Download/>下载 ZIP</button></footer></section></div>
}

export function PoolDialog({open,onClose}:{open:boolean;onClose:()=>void}) {
  const {pools,setPools}=useAppStore();const [name,setName]=useState('业务渠道');const [text,setText]=useState('APP\n小程序\n官网\n线下门店');const [error,setError]=useState('');const input=useRef<HTMLInputElement>(null);if(!open)return null
  const add=()=>{const values=[...new Set(text.split(/[\n,]/).map(x=>x.trim()).filter(Boolean))];if(!name.trim())return setError('请输入数据池名称');if(!values.length)return setError('请至少输入一个候选值');if(values.length>10_000)return setError('单个数据池最多保存 10,000 个候选值');if(pools.some(pool=>pool.name===name.trim()))return setError('数据池名称不能重复');setPools([...pools,{id:`pool_${Date.now()}`,name:name.trim().slice(0,80),values:values.map(value=>value.slice(0,2_000)),createdAt:new Date().toISOString()}]);setName('');setText('');setError('')}
  const parseFile=(file:File)=>{setError('');if(file.size>MAX_CONFIG_BYTES)return setError('导入文件不能超过 1 MB');const reader=new FileReader();reader.onload=()=>{const raw=String(reader.result||'');if(file.name.toLowerCase().endsWith('.json')){try{const j=JSON.parse(raw);if(!Array.isArray(j))throw new Error();setText(j.slice(0,10_000).map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join('\n'))}catch{setError('JSON 数据池必须是数组')}}else if(file.name.toLowerCase().endsWith('.csv')){const r=Papa.parse<string[]>(raw,{skipEmptyLines:true});setText(r.data.slice(0,10_000).map(row=>row[0]).filter(Boolean).join('\n'))}else setText(raw.slice(0,MAX_CONFIG_BYTES))};reader.readAsText(file)}
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className="modal pool-modal"><header><div><span>LOCAL DATA POOL</span><h2>自定义数据池</h2><p>内置数据无需导入；这里只保存你的业务枚举。</p></div><button className="icon-button" onClick={onClose}><X/></button></header><div className="pool-form"><label>数据池名称<input value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="例如：渠道编码"/></label><label>候选值<textarea rows={7} maxLength={MAX_CONFIG_BYTES} value={text} onChange={e=>setText(e.target.value)} placeholder="每行一个值，也支持逗号分隔"/></label>{error&&<div className="form-error">{error}</div>}<div className="pool-actions"><input ref={input} hidden type="file" accept=".txt,.csv,.json" onChange={e=>e.target.files?.[0]&&parseFile(e.target.files[0])}/><button className="button ghost" onClick={()=>input.current?.click()}><Upload/>读取 TXT / CSV / JSON</button><button className="button primary" onClick={add}><Layers3/>保存数据池</button></div></div>{pools.length>0&&<div className="saved-pools"><h3>已保存</h3>{pools.map(p=><article key={p.id}><div><strong>{p.name}</strong><span>{p.values.length} 个值 · {p.values.slice(0,3).join('、')}</span></div><button className="icon-button danger" onClick={()=>setPools(pools.filter(x=>x.id!==p.id))}><X/></button></article>)}</div>}</section></div>
}

const OPENAPI_SAMPLE=`{
  "openapi": "3.0.3",
  "info": { "title": "订单服务", "version": "1.0" },
  "components": { "schemas": {
    "User": { "type": "object", "required": ["id", "email"], "properties": {
      "id": { "type": "integer" }, "email": { "type": "string", "format": "email" }, "status": { "type": "string", "enum": ["正常", "冻结"] }
    }},
    "Order": { "type": "object", "required": ["id", "userId"], "properties": {
      "id": { "type": "integer" }, "userId": { "type": "integer" }, "amount": { "type": "number", "minimum": 0 }, "createdAt": { "type": "string", "format": "date-time" }
    }}
  }}
}`
const SQL_SAMPLE=`CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  email VARCHAR(120) NOT NULL UNIQUE,
  status ENUM('正常', '冻结', '注销') NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  paid BOOLEAN,
  metadata JSON,
  CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES users(id)
);`
const TYPESCRIPT_SAMPLE=`export interface User {
  id: number;
  name: string;
  email: string;
  status: '正常' | '冻结' | '注销';
  nickname?: string | null;
  createdAt: Date;
}

export interface Order {
  id: number;
  userId: number;
  buyer: User;
  amount: number;
  paid: boolean;
  tags: string[];
}`

export function SchemaImportDialog({open,onClose}:{open:boolean;onClose:()=>void}) {
  const setProject=useAppStore(state=>state.setProject),input=useRef<HTMLInputElement>(null);const[text,setText]=useState(OPENAPI_SAMPLE),[preview,setPreview]=useState<ImportPreview|null>(null),[error,setError]=useState(''),[sample,setSample]=useState<'openapi'|'sql'|'typescript'>('openapi');if(!open)return null
  const analyze=async()=>{try{setPreview(await importSchemaText(text));setError('')}catch(reason){setPreview(null);setError(reason instanceof Error?reason.message:'Schema 解析失败')}}
  const read=(file:File)=>{setError('');setPreview(null);if(file.size>MAX_CONFIG_BYTES)return setError('Schema 文件不能超过 1 MB');const reader=new FileReader();reader.onload=()=>setText(String(reader.result||''));reader.readAsText(file)}
  const apply=()=>{if(!preview)return;setProject(preview.project);onClose()}
  const selectSample=(next:'openapi'|'sql'|'typescript')=>{setSample(next);setText(next==='openapi'?OPENAPI_SAMPLE:next==='sql'?SQL_SAMPLE:TYPESCRIPT_SAMPLE);setPreview(null);setError('')}
  return <div className="modal-backdrop" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section className="modal schema-modal"><header><div><span>SCHEMA IMPORT</span><h2>从 Schema 建立项目</h2><p>可选能力：内置模板无需导入。支持 OpenAPI JSON/YAML、数据库 DDL 和 TypeScript 类型。</p></div><button className="icon-button" onClick={onClose}><X/></button></header><div className="schema-input"><div className="schema-type-switch"><button className={sample==='openapi'?'active':''} onClick={()=>selectSample('openapi')}>OpenAPI / JSON / YAML</button><button className={sample==='sql'?'active':''} onClick={()=>selectSample('sql')}>SQL CREATE TABLE</button><button className={sample==='typescript'?'active':''} onClick={()=>selectSample('typescript')}>TypeScript</button></div><div className="schema-input-head"><span>粘贴文本，或读取本地 `.json` / `.yaml` / `.sql` / `.ts` 文件</span><input hidden ref={input} type="file" accept=".json,.yaml,.yml,.sql,.ts,.tsx,application/json,application/yaml,text/yaml,text/plain" onChange={event=>event.target.files?.[0]&&read(event.target.files[0])}/><button className="button ghost" onClick={()=>input.current?.click()}><Upload/>读取文件</button></div><textarea maxLength={MAX_CONFIG_BYTES} spellCheck={false} value={text} onChange={event=>{setText(event.target.value);setPreview(null)}}/><button className="button primary" onClick={()=>void analyze()}><GitCompareArrows/>分析结构</button></div>{error&&<div className="dialog-message error">{error}</div>}{preview&&<div className="schema-preview"><header><div><strong>{preview.project.name}</strong><span>{preview.source==='openapi'?'OpenAPI 3.x':preview.source==='sql'?'SQL DDL':preview.source==='typescript'?'TypeScript 类型':'JSON/YAML 样例'} · 本地解析</span></div><b>{preview.project.tables.length} 表 · {preview.project.tables.reduce((sum,table)=>sum+table.fields.length,0)} 字段</b></header><div>{preview.project.tables.map(table=><article key={table.id}><div><strong>{table.label}</strong><code>{table.name}</code></div><span>{table.count} 条</span><span>{table.fields.length} 字段</span><small>{table.fields.slice(0,5).map(field=>field.name).join('、')}{table.fields.length>5?'…':''}</small></article>)}</div>{preview.warnings.map(warning=><p key={warning}><AlertTriangle/>{warning}</p>)}</div>}<footer><span className="privacy-note">只做本地静态解析，不执行标签、TypeScript、SQL 或任何输入代码</span><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!preview} onClick={apply}>使用此结构</button></footer></section></div>
}

const downloadText=(text:string,name:string)=>{const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

export function ProjectDialog({open,onClose}:{open:boolean;onClose:()=>void}) {
  const {project,pools,setProject,setPools,past,future,undo,redo}=useAppStore();const input=useRef<HTMLInputElement>(null);const [error,setError]=useState('');const [message,setMessage]=useState('');const[snapshots,setSnapshots]=useState<ProjectSnapshot[]>([]);const[runs,setRuns]=useState<GenerationHistoryItem[]>([]);const[snapshotName,setSnapshotName]=useState('');const[selectedSnapshotId,setSelectedSnapshotId]=useState('');useEffect(()=>{if(open){snapshotStore.load().then(setSnapshots).catch(()=>setError('无法读取浏览器中的项目快照'));generationHistoryStore.load().then(setRuns).catch(()=>setError('无法读取浏览器中的生成历史'))}},[open]);if(!open)return null
  const exportProject=()=>{downloadText(serializeProject(project),safeProjectFilename(project.name));setMessage('项目配置已下载，不包含生成结果和数据池内容。');setError('')}
  const shareProject=async()=>{try{const url=createShareUrl(project,window.location);await navigator.clipboard.writeText(url);setMessage('分享链接已复制。链接只包含 Schema 与种子，不包含结果和数据池。');setError('')}catch(reason){setError(reason instanceof Error?reason.message:'无法复制分享链接，请改用下载配置')}}
  const importProject=(file:File)=>{setError('');setMessage('');if(file.size>MAX_CONFIG_BYTES)return setError('配置文件不能超过 1 MB');const reader=new FileReader();reader.onload=()=>{try{setProject(parseProjectFile(String(reader.result||'')));setMessage('项目配置已恢复，请重新生成数据。')}catch(reason){setError(reason instanceof Error?reason.message:'导入失败')}};reader.readAsText(file)}
  const restore=()=>{setProject(cloneTemplate(project.templateId));setMessage('已恢复当前场景的内置模板。');setError('')}
  const saveSnapshot=async()=>{try{const snapshot=createSnapshot(project,snapshotName||`${project.name} · ${new Date().toLocaleString()}`),next=[snapshot,...snapshots].slice(0,MAX_SNAPSHOTS);await snapshotStore.save(next);setSnapshots(next);setSelectedSnapshotId(snapshot.id);setSnapshotName('');setMessage('项目快照已保存至当前浏览器。');setError('')}catch(reason){setError(reason instanceof Error?reason.message:'快照保存失败')}}
  const removeSnapshot=async(id:string)=>{const next=snapshots.filter(snapshot=>snapshot.id!==id);await snapshotStore.save(next);setSnapshots(next);if(selectedSnapshotId===id)setSelectedSnapshotId('')}
  const restoreRun=async(run:GenerationHistoryItem)=>{setProject(structuredClone(run.project));setMessage(`已恢复 ${new Date(run.createdAt).toLocaleString()} 的运行配置，正在重新生成…`);await useAppStore.getState().generate();setRuns(await generationHistoryStore.load())}
  const removeRun=async(id:string)=>setRuns(await generationHistoryStore.remove(id))
  const clear=async()=>{if(!window.confirm('确定清除当前项目、自定义数据池、项目快照、生成历史和浏览器本地配置吗？此操作无法撤销。'))return;localStorage.removeItem('mock-tool-ui');await Promise.all([snapshotStore.clear(),generationHistoryStore.clear()]);setSnapshots([]);setRuns([]);setPools([]);setProject(cloneTemplate('commerce'));setMessage('本地数据已清除，已恢复默认电商模板。');setError('')}
  const selected=snapshots.find(snapshot=>snapshot.id===selectedSnapshotId),changes=selected?diffProjects(selected.project,project):[]
  return <div className="modal-backdrop" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section className="modal project-modal"><header><div><span>PROJECT SAFETY</span><h2>项目与本地数据</h2><p>保存快照、复现运行、比较版本、备份规则或清理当前浏览器数据。</p></div><button className="icon-button" onClick={onClose}><X/></button></header><div className="history-strip"><div><strong>编辑历史</strong><span>最多保留 30 步结构修改</span></div><button className="button ghost" disabled={!past.length} onClick={undo}><RotateCcw/>撤销 {past.length}</button><button className="button ghost" disabled={!future.length} onClick={redo}><RefreshCcw/>重做 {future.length}</button></div><section className="run-history"><header><div><strong>最近生成</strong><span>只保存最近 10 次配置与摘要，不保存生成结果</span></div><b>{runs.length}</b></header>{runs.length?<div>{runs.map(run=><article key={run.id}><RefreshCcw/><div><strong>{run.project.name}</strong><span>{new Date(run.createdAt).toLocaleString()} · {run.project.mode} · seed {run.project.seed}</span></div><code>{run.totalRows.toLocaleString()} 条</code><code className={run.failedChecks?'failed':''}>{run.failedChecks?`${run.failedChecks} 失败`:`${run.passedChecks} 通过`}</code><button className="button ghost" onClick={()=>void restoreRun(run)}>恢复并生成</button><button className="icon-button danger" aria-label="删除生成历史" onClick={()=>void removeRun(run.id)}><Trash2/></button></article>)}</div>:<p>成功生成后会在此记录可复现配置。</p>}</section><section className="snapshot-section"><div className="snapshot-create"><div><strong>项目快照</strong><span>在浏览器中保存最多 {MAX_SNAPSHOTS} 个命名版本，仅包含 Schema。</span></div><input maxLength={80} value={snapshotName} onChange={event=>setSnapshotName(event.target.value)} placeholder="例如：订单退款联调前"/><button className="button primary" onClick={saveSnapshot}><BookmarkPlus/>保存快照</button></div>{snapshots.length>0&&<div className="snapshot-list">{snapshots.map(snapshot=><article className={selectedSnapshotId===snapshot.id?'active':''} key={snapshot.id} onClick={()=>setSelectedSnapshotId(snapshot.id)}><GitCompareArrows/><div><strong>{snapshot.name}</strong><span>{new Date(snapshot.createdAt).toLocaleString()} · {snapshot.project.tables.length} 表 · {snapshot.project.tables.reduce((sum,table)=>sum+table.fields.length,0)} 字段</span></div><button className="button ghost" onClick={event=>{event.stopPropagation();setProject(structuredClone(snapshot.project));setMessage(`已恢复快照“${snapshot.name}”。`)}}>恢复</button><button className="icon-button danger" aria-label={`删除快照 ${snapshot.name}`} onClick={event=>{event.stopPropagation();void removeSnapshot(snapshot.id)}}><Trash2/></button></article>)}</div>}{selected&&<div className="snapshot-diff"><header><div><strong>与当前项目比较</strong><span>以“{selected.name}”为基准</span></div><b>{changes.length} 项变化</b></header>{changes.length?<div>{changes.slice(0,30).map(change=><article className={change.type} key={change.id}><i>{change.type==='add'?'+':change.type==='remove'?'−':'~'}</i><span><strong>{change.title}</strong><small>{change.detail}</small></span></article>)}</div>:<p>当前项目与此快照完全一致。</p>}{changes.length>30&&<small>仅显示前 30 项，共 {changes.length} 项变化。</small>}</div>}</section><div className="project-actions"><article><Share2/><div><strong>复制隐私分享链接</strong><p>只分享 Schema 与种子；链接片段不会发送到 Cloudflare，打开后创建独立副本。</p></div><button className="button ghost" onClick={()=>void shareProject()}>复制链接</button></article><article><HardDriveDownload/><div><strong>备份项目配置</strong><p>下载经过版本标记的 `.mock.json`，不包含已生成的数据。</p></div><button className="button ghost" onClick={exportProject}>下载配置</button></article><article><Upload/><div><strong>恢复项目配置</strong><p>仅接受本工具生成且通过安全校验的配置，最大 1 MB。</p></div><input hidden ref={input} type="file" accept=".mock.json,application/json" onChange={event=>event.target.files?.[0]&&importProject(event.target.files[0])}/><button className="button ghost" onClick={()=>input.current?.click()}>选择文件</button></article><article><RotateCcw/><div><strong>恢复内置模板</strong><p>放弃当前修改，重新加载“{project.templateId}”场景模板。</p></div><button className="button ghost" onClick={restore}>恢复模板</button></article><article className="danger-zone"><Trash2/><div><strong>清除本地数据</strong><p>删除当前项目、{snapshots.length} 个快照、{runs.length} 条运行历史与 {pools.length} 个数据池。</p></div><button className="button danger-button" onClick={()=>void clear()}>清除数据</button></article></div>{error&&<div className="dialog-message error">{error}</div>}{message&&<div className="dialog-message success">{message}</div>}<footer><span className="privacy-note">所有操作仅发生在当前浏览器中</span><button className="button primary" onClick={onClose}>完成</button></footer></section></div>
}
