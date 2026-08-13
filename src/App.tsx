import { useEffect, useState } from 'react'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import FieldEditor from './components/FieldEditor'
import Preview from './components/Preview'
import { ExportDialog, PoolDialog } from './components/Dialogs'
import { useAppStore } from './store'

export default function App(){
  const [exportOpen,setExportOpen]=useState(false);const[poolOpen,setPoolOpen]=useState(false);const {project,activeTableId,updateTable,result}=useAppStore();const table=project.tables.find(t=>t.id===activeTableId)
  useEffect(()=>{if(!result)useAppStore.getState().generate()},[])
  return <div className="app-shell"><Header onExport={()=>setExportOpen(true)}/><div className="workspace"><Sidebar onPool={()=>setPoolOpen(true)}/><div className="center-column">{table&&<div className="table-toolbar"><div><strong>{table.label}</strong><code>{table.name}</code></div><label>生成数量<input type="number" min="1" max="100000" value={table.count} onChange={e=>updateTable(table.id,{count:Math.max(1,Math.min(100000,Number(e.target.value)))})}/></label><label>随机种子<input type="number" value={project.seed} onChange={e=>useAppStore.getState().updateProject({seed:Number(e.target.value)})}/></label><span>{table.fields.length} 字段</span></div>}<FieldEditor/></div><Preview/></div><ExportDialog open={exportOpen} onClose={()=>setExportOpen(false)}/><PoolDialog open={poolOpen} onClose={()=>setPoolOpen(false)}/></div>
}
