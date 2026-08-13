import { Database, Layers3, Plus, Search } from './Icons'
import { TEMPLATES } from '../data/templates'
import { useAppStore } from '../store'

export default function Sidebar({onPool}:{onPool:()=>void}) {
  const s=useAppStore();const table=s.project.tables.find(t=>t.id===s.activeTableId);const fields=table?.fields.filter(f=>`${f.label}${f.name}`.toLowerCase().includes(s.search.toLowerCase()))||[]
  return <aside className="sidebar">
    <section className="side-section"><div className="section-title"><span>场景模板</span><small>{TEMPLATES.length} 套</small></div><div className="template-grid">{TEMPLATES.map(t=><button key={t.templateId} className={s.project.templateId===t.templateId?'active':''} onClick={()=>s.chooseTemplate(t.templateId)} title={t.description}><span>{({users:'用户',commerce:'电商',finance:'金融',game:'游戏',community:'社区',logistics:'物流',testing:'通用'} as Record<string,string>)[t.templateId]}</span><small>{t.tables.length} 表</small></button>)}</div></section>
    <section className="side-section table-section"><div className="section-title"><span>数据表</span><div className="section-actions"><small>{s.project.tables.length}</small><button className="icon-button" onClick={s.addTable} title="新增数据表"><Plus size={15}/></button></div></div><div className="table-list">{s.project.tables.map(t=><button key={t.id} className={s.activeTableId===t.id?'active':''} onClick={()=>s.setActiveTable(t.id)}><Database size={14}/><span>{t.label}</span><small>{t.count}</small></button>)}</div></section>
    <section className="side-section field-section"><div className="section-title"><span>字段</span><button className="icon-button" onClick={s.addField} title="添加字段"><Plus size={15}/></button></div><label className="search-box"><Search size={14}/><input placeholder="搜索字段" value={s.search} onChange={e=>s.setSearch(e.target.value)}/></label><div className="field-list">{fields.map((f,i)=><button key={f.id} className={s.selectedFieldId===f.id?'active':''} onClick={()=>s.selectField(f.id)}><span className={`type-dot ${f.dataType}`}></span><span><strong>{f.label}</strong><small>{f.name}</small></span><em>{i+1}</em></button>)}</div></section>
    <section className="pool-entry"><button onClick={onPool}><Layers3 size={16}/><span><strong>自定义数据池</strong><small>{s.pools.length?s.pools.map(p=>p.name).join('、'):'可选 · 内置数据可直接用'}</small></span><Plus size={14}/></button></section>
  </aside>
}
