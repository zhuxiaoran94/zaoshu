import { CalendarClock, Command, Download, FlaskConical, FolderCog, Play, ShieldCheck, Upload, X } from './Icons'
import { useAppStore } from '../store'
import type { DataMode } from '../types'

const modes:Array<{id:DataMode;label:string;hint:string}>=[{id:'random',label:'随机',hint:'按字段规则生成'},{id:'realistic',label:'真实分布',hint:'按权重与范围生成'},{id:'boundary',label:'边界',hint:'覆盖临界值'},{id:'exception',label:'异常',hint:'注入可追溯缺陷'},{id:'pairwise',label:'组合',hint:'进入组合实验室'}]

export default function Header({onExport,onProject,onSchemaImport,onCommand}:{onExport:()=>void;onProject:()=>void;onSchemaImport:()=>void;onCommand:()=>void}) {
  const {project,updateProject,generate,cancelGenerate,result,setPanel,isGenerating,generationError}=useAppStore()
  const run=()=>project.mode==='pairwise'?setPanel('pairwise'):generate()
  const referenceDate=(project.referenceDate??'2026-08-14T00:00:00.000Z').slice(0,10),setReferenceDate=(value:string)=>{if(value)updateProject({referenceDate:`${value}T00:00:00.000Z`})}
  return <>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><FlaskConical size={20}/></span><div><strong>竹小冉mock造数</strong><span>TEST DATA WORKBENCH</span></div></div>
      <div className="project-name"><label>当前项目</label><input value={project.name} onChange={e=>updateProject({name:e.target.value})}/></div>
      <div className="top-actions"><button className="button ghost command-button" onClick={onCommand} aria-keyshortcuts="Meta+K Control+K"><Command size={16}/>命令<kbd>⌘K</kbd></button><button className="button ghost schema-import-button" onClick={onSchemaImport}><Upload size={16}/>Schema</button><button className="button ghost project-button" onClick={onProject}><FolderCog size={16}/>项目</button><button className="button ghost export-button" onClick={onExport}><Download size={16}/>导出</button>{isGenerating?<button className="button cancel" onClick={cancelGenerate}><X size={16}/>取消生成</button>:<button className="button primary" onClick={run} aria-keyshortcuts="Meta+Enter Control+Enter"><Play size={16} fill="currentColor"/>{project.mode==='pairwise'?'打开组合实验室':'生成数据'}</button>}</div>
    </header>
    <section className="pipeline" aria-label="造数流水线">
      <div className="pipeline-label"><span>造数模式</span><strong>{modes.find(m=>m.id===project.mode)?.hint}</strong></div>
      <div className="mode-track">{modes.map((mode,i)=><button key={mode.id} className={`mode-node ${project.mode===mode.id?'active':''}`} onClick={()=>updateProject({mode:mode.id})}><i>{i+1}</i><span>{mode.label}</span></button>)}</div>
      <div className="reference-date-control" title={`相对日期、订单号和格式模板均以 ${project.referenceDate??referenceDate} 为基准`}><CalendarClock/><label><span>时间基准</span><input aria-label="时间基准" type="date" value={referenceDate} onChange={event=>setReferenceDate(event.target.value)}/></label><button onClick={()=>updateProject({referenceDate:new Date().toISOString()})}>设为现在</button></div>
      <div className={`run-stats ${isGenerating?'running':''}`}><ShieldCheck size={18}/><div><strong>{isGenerating?'正在分块生成…':result?`${result.report.totalRows.toLocaleString()} 条`:'等待生成'}</strong><span>{generationError||(!isGenerating&&result?`${result.report.duration}ms · 本地完成`:'数据不会离开浏览器')}</span></div></div>
    </section>
  </>
}
