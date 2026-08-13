import { del, get, set } from 'idb-keyval'
import type { FieldRule, ProjectSchema, TableSchema } from '../types'
import { MAX_CONFIG_BYTES, parseProjectFile, serializeProject } from './projectConfig'

const SNAPSHOT_KEY='mock-tool-snapshots'
export const MAX_SNAPSHOTS=20

export interface ProjectSnapshot { id:string; name:string; createdAt:string; project:ProjectSchema }
export interface SnapshotChange { id:string; type:'add'|'remove'|'change'; scope:'project'|'table'|'field'; title:string; detail:string }

const validSnapshot=(value:unknown):ProjectSnapshot|null=>{
  if(!value||typeof value!=='object')return null
  const candidate=value as Partial<ProjectSnapshot>
  if(typeof candidate.id!=='string'||typeof candidate.name!=='string'||candidate.name.length<1||candidate.name.length>80||typeof candidate.createdAt!=='string'||!candidate.project)return null
  try{return{...candidate,project:parseProjectFile(serializeProject(candidate.project))} as ProjectSnapshot}catch{return null}
}

export const snapshotStore={
  async load(){const raw=await get<unknown>(SNAPSHOT_KEY);if(!Array.isArray(raw))return[];return raw.slice(0,MAX_SNAPSHOTS).map(validSnapshot).filter((item):item is ProjectSnapshot=>!!item)},
  async save(items:ProjectSnapshot[]){const limited=items.slice(0,MAX_SNAPSHOTS);if(limited.some(item=>new Blob([serializeProject(item.project)]).size>MAX_CONFIG_BYTES))throw new Error('单个快照不能超过 1 MB');await set(SNAPSHOT_KEY,limited)},
  clear:()=>del(SNAPSHOT_KEY),
}

export function createSnapshot(project:ProjectSchema,name:string):ProjectSnapshot {
  const safe=name.trim().slice(0,80);if(!safe)throw new Error('请输入快照名称')
  return{id:`snapshot_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,name:safe,createdAt:new Date().toISOString(),project:structuredClone(project)}
}

const fieldsChanged=(before:FieldRule,after:FieldRule)=>Object.keys({...before,...after}).filter(key=>key!=='id'&&JSON.stringify(before[key as keyof FieldRule])!==JSON.stringify(after[key as keyof FieldRule]))
const tableName=(table:TableSchema)=>`${table.label}（${table.name}）`

export function diffProjects(before:ProjectSchema,after:ProjectSchema):SnapshotChange[] {
  const changes:SnapshotChange[]=[]
  if(before.name!==after.name)changes.push({id:'project-name',type:'change',scope:'project',title:'项目名称已修改',detail:`${before.name} → ${after.name}`})
  if(before.mode!==after.mode)changes.push({id:'project-mode',type:'change',scope:'project',title:'造数模式已修改',detail:`${before.mode} → ${after.mode}`})
  if(before.seed!==after.seed)changes.push({id:'project-seed',type:'change',scope:'project',title:'随机种子已修改',detail:`${before.seed} → ${after.seed}`})
  const beforeTables=new Map(before.tables.map(table=>[table.id,table])),afterTables=new Map(after.tables.map(table=>[table.id,table]))
  before.tables.forEach(table=>{if(!afterTables.has(table.id))changes.push({id:`table-remove-${table.id}`,type:'remove',scope:'table',title:'删除数据表',detail:tableName(table)})})
  after.tables.forEach(table=>{const previous=beforeTables.get(table.id);if(!previous){changes.push({id:`table-add-${table.id}`,type:'add',scope:'table',title:'新增数据表',detail:`${tableName(table)} · ${table.fields.length} 字段`});return}
    const tableProps:string[]=[];if(previous.label!==table.label||previous.name!==table.name)tableProps.push(`名称 ${tableName(previous)} → ${tableName(table)}`);if(previous.count!==table.count)tableProps.push(`数量 ${previous.count} → ${table.count}`);if(tableProps.length)changes.push({id:`table-change-${table.id}`,type:'change',scope:'table',title:`修改数据表 ${table.label}`,detail:tableProps.join('；')})
    const beforeFields=new Map(previous.fields.map(field=>[field.id,field])),afterFields=new Map(table.fields.map(field=>[field.id,field]));previous.fields.forEach(field=>{if(!afterFields.has(field.id))changes.push({id:`field-remove-${field.id}`,type:'remove',scope:'field',title:`删除字段 ${previous.label}.${field.label}`,detail:field.name})});table.fields.forEach(field=>{const old=beforeFields.get(field.id);if(!old)changes.push({id:`field-add-${field.id}`,type:'add',scope:'field',title:`新增字段 ${table.label}.${field.label}`,detail:`${field.name} · ${field.generator}`});else{const keys=fieldsChanged(old,field);if(keys.length)changes.push({id:`field-change-${field.id}`,type:'change',scope:'field',title:`修改字段 ${table.label}.${field.label}`,detail:`变更属性：${keys.join('、')}`})}})
  })
  return changes
}
