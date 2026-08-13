import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import FieldEditor from './components/FieldEditor'
import Preview from './components/Preview'
import { ExportDialog, PoolDialog, ProjectDialog, SchemaImportDialog } from './components/Dialogs'
import { useAppStore } from './store'
import { ArrowDown, ArrowUp, Copy, Trash2 } from './components/Icons'
import PwaStatus from './components/PwaStatus'
import type { PaletteCommand } from './components/CommandPalette'
import { TEMPLATES } from './data/templates'
import type { DataMode } from './types'

const CommandPalette=lazy(()=>import('./components/CommandPalette'))

export default function App(){
  const [exportOpen,setExportOpen]=useState(false);const[poolOpen,setPoolOpen]=useState(false);const[projectOpen,setProjectOpen]=useState(false);const[schemaOpen,setSchemaOpen]=useState(false);const[commandOpen,setCommandOpen]=useState(false);const {project,activeTableId,updateTable,duplicateTable,removeTable,moveTable,chooseTemplate,updateProject,generate,setPanel,undo,redo,past,future,result,isGenerating}=useAppStore();const table=project.tables.find(t=>t.id===activeTableId)
  const run=()=>{if(isGenerating)return;if(project.mode==='pairwise')setPanel('pairwise');else void generate()}
  const commands=useMemo<PaletteCommand[]>(()=>{
    const modes:Array<[DataMode,string,string]>=[['random','随机模式','按字段规则快速生成'],['realistic','真实分布模式','按权重与分布生成'],['boundary','边界模式','覆盖最小值、最大值与空值'],['exception','异常模式','注入可追溯缺陷'],['pairwise','Pairwise 组合模式','用较少用例覆盖参数对']]
    return[
      {id:'generate',label:project.mode==='pairwise'?'打开组合实验室':'生成数据',hint:`当前 ${project.name} · seed ${project.seed}`,group:'快捷操作',keywords:'run mock 造数',shortcut:'⌘↵',disabled:isGenerating,action:run},
      {id:'export',label:'打开导出中心',hint:result?`${result.report.totalRows.toLocaleString()} 条结果可导出`:'生成后可导出 18 种格式',group:'快捷操作',keywords:'download zip csv json xlsx sql',shortcut:'⌘⇧E',action:()=>setExportOpen(true)},
      {id:'project',label:'项目与本地数据',hint:'快照、历史、分享、备份与清理',group:'快捷操作',keywords:'snapshot history share backup',shortcut:'⌘⇧P',action:()=>setProjectOpen(true)},
      {id:'schema',label:'从 Schema 建立项目',hint:'OpenAPI、JSON、YAML、SQL DDL、TypeScript',group:'快捷操作',keywords:'import openapi yaml ddl typescript',action:()=>setSchemaOpen(true)},
      {id:'pool',label:'管理自定义数据池',hint:'导入公司内部枚举与业务码',group:'快捷操作',keywords:'custom enum data pool',action:()=>setPoolOpen(true)},
      {id:'undo',label:'撤销结构修改',hint:past.length?`可撤销 ${past.length} 步`:'没有可撤销的修改',group:'编辑',keywords:'undo',shortcut:'⌘Z',disabled:!past.length,action:undo},
      {id:'redo',label:'重做结构修改',hint:future.length?`可重做 ${future.length} 步`:'没有可重做的修改',group:'编辑',keywords:'redo',shortcut:'⌘⇧Z',disabled:!future.length,action:redo},
      ...modes.map(([id,label,hint])=>({id:`mode-${id}`,label,hint,group:'造数模式',keywords:id,action:()=>updateProject({mode:id})})),
      ...TEMPLATES.map(template=>({id:`template-${template.templateId}`,label:`切换到${template.name}`,hint:`${template.tables.length} 表 · ${template.tables.reduce((sum,item)=>sum+item.count,0)} 条默认数据`,group:'业务场景',keywords:`${template.templateId} ${template.description}`,action:()=>chooseTemplate(template.templateId)})),
      ...([['data','数据预览','表格、JSON 与树形结果'],['quality','质量检查','定位类型、约束与关系问题'],['coverage','覆盖报告','查看缺口并一键最少补数'],['statistics','字段统计','空值、唯一率、范围与高频值'],['relations','表关系','生成顺序与外键连线'],['diagnostics','生成前诊断','配置问题与修复建议'],['pairwise','组合实验室','参数组合、排除与强制用例'],['states','状态链','订单、支付、物流与任务轨迹']] as const).map(([id,label,hint])=>({id:`panel-${id}`,label:`查看${label}`,hint,group:'结果与实验室',keywords:id,action:()=>setPanel(id)})),
    ]
  },[future.length,isGenerating,past.length,project.mode,project.name,project.seed,result,chooseTemplate,generate,setPanel,undo,redo,updateProject])
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{const modifier=event.metaKey||event.ctrlKey,target=event.target as HTMLElement|null,editing=target?.matches('input, textarea, select, [contenteditable="true"]'),dialogOpen=exportOpen||projectOpen||schemaOpen||poolOpen||commandOpen;if(modifier&&event.key.toLocaleLowerCase()==='k'){event.preventDefault();setCommandOpen(open=>!open)}else if(dialogOpen)return;else if(modifier&&event.key==='Enter'&&!editing){event.preventDefault();run()}else if(modifier&&event.shiftKey&&event.key.toLocaleLowerCase()==='e'&&!editing){event.preventDefault();setExportOpen(true)}else if(modifier&&event.shiftKey&&event.key.toLocaleLowerCase()==='p'&&!editing){event.preventDefault();setProjectOpen(true)}else if(modifier&&event.key.toLocaleLowerCase()==='z'&&!editing){event.preventDefault();event.shiftKey?redo():undo()}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[commandOpen,exportOpen,isGenerating,poolOpen,project.mode,projectOpen,schemaOpen,generate,setPanel,undo,redo])
  return <div className="app-shell"><Header onExport={()=>setExportOpen(true)} onProject={()=>setProjectOpen(true)} onSchemaImport={()=>setSchemaOpen(true)} onCommand={()=>setCommandOpen(true)}/><div className="workspace"><Sidebar onPool={()=>setPoolOpen(true)}/><div className="center-column">{table&&<div className="table-toolbar"><div className="table-identity"><input aria-label="数据表显示名称" value={table.label} maxLength={80} onChange={e=>updateTable(table.id,{label:e.target.value})}/><input aria-label="数据表名称" value={table.name} maxLength={80} onChange={e=>updateTable(table.id,{name:e.target.value.replace(/[^A-Za-z0-9_]/g,'_')})}/></div><label>生成数量<input type="number" min="1" max="100000" value={table.count} onChange={e=>updateTable(table.id,{count:Math.max(1,Math.min(100000,Number(e.target.value)))})}/></label><label>随机种子<input type="number" value={project.seed} onChange={e=>useAppStore.getState().updateProject({seed:Number(e.target.value)})}/></label><span>{table.fields.length} 字段</span><div className="table-actions"><button className="icon-button" onClick={()=>moveTable(table.id,-1)} title="数据表上移" aria-label="数据表上移"><ArrowUp/></button><button className="icon-button" onClick={()=>moveTable(table.id,1)} title="数据表下移" aria-label="数据表下移"><ArrowDown/></button><button className="icon-button" onClick={()=>duplicateTable(table.id)} title="复制数据表" aria-label="复制数据表"><Copy/></button><button className="icon-button danger" onClick={()=>removeTable(table.id)} title="删除数据表" aria-label="删除数据表"><Trash2/></button></div></div>}<FieldEditor/></div><Preview/></div><ExportDialog open={exportOpen} onClose={()=>setExportOpen(false)}/><PoolDialog open={poolOpen} onClose={()=>setPoolOpen(false)}/><ProjectDialog open={projectOpen} onClose={()=>setProjectOpen(false)}/><SchemaImportDialog open={schemaOpen} onClose={()=>setSchemaOpen(false)}/>{commandOpen&&<Suspense fallback={null}><CommandPalette open onClose={()=>setCommandOpen(false)} commands={commands}/></Suspense>}<PwaStatus/></div>
}
