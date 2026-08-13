import { useEffect, useState } from 'react'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import FieldEditor from './components/FieldEditor'
import Preview from './components/Preview'
import { ExportDialog, PoolDialog, ProjectDialog } from './components/Dialogs'
import { useAppStore } from './store'
import { ArrowDown, ArrowUp, Copy, Trash2 } from './components/Icons'

export default function App(){
  const [exportOpen,setExportOpen]=useState(false);const[poolOpen,setPoolOpen]=useState(false);const[projectOpen,setProjectOpen]=useState(false);const {project,activeTableId,updateTable,result,duplicateTable,removeTable,moveTable}=useAppStore();const table=project.tables.find(t=>t.id===activeTableId)
  useEffect(()=>{if(!result)useAppStore.getState().generate()},[])
  return <div className="app-shell"><Header onExport={()=>setExportOpen(true)} onProject={()=>setProjectOpen(true)}/><div className="workspace"><Sidebar onPool={()=>setPoolOpen(true)}/><div className="center-column">{table&&<div className="table-toolbar"><div className="table-identity"><input aria-label="数据表显示名称" value={table.label} maxLength={80} onChange={e=>updateTable(table.id,{label:e.target.value})}/><input aria-label="数据表名称" value={table.name} maxLength={80} onChange={e=>updateTable(table.id,{name:e.target.value.replace(/[^A-Za-z0-9_]/g,'_')})}/></div><label>生成数量<input type="number" min="1" max="100000" value={table.count} onChange={e=>updateTable(table.id,{count:Math.max(1,Math.min(100000,Number(e.target.value)))})}/></label><label>随机种子<input type="number" value={project.seed} onChange={e=>useAppStore.getState().updateProject({seed:Number(e.target.value)})}/></label><span>{table.fields.length} 字段</span><div className="table-actions"><button className="icon-button" onClick={()=>moveTable(table.id,-1)} title="数据表上移"><ArrowUp/></button><button className="icon-button" onClick={()=>moveTable(table.id,1)} title="数据表下移"><ArrowDown/></button><button className="icon-button" onClick={()=>duplicateTable(table.id)} title="复制数据表"><Copy/></button><button className="icon-button danger" onClick={()=>removeTable(table.id)} title="删除数据表"><Trash2/></button></div></div>}<FieldEditor/></div><Preview/></div><ExportDialog open={exportOpen} onClose={()=>setExportOpen(false)}/><PoolDialog open={poolOpen} onClose={()=>setPoolOpen(false)}/><ProjectDialog open={projectOpen} onClose={()=>setProjectOpen(false)}/></div>
}
