import { describe, expect, it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { createSnapshot, diffProjects } from './snapshots'

describe('项目快照与差异',()=>{
  it('创建快照时深拷贝当前项目并校验名称',()=>{
    const project=cloneTemplate('commerce'),snapshot=createSnapshot(project,'退款联调前')
    project.tables[0].label='已修改'
    expect(snapshot.name).toBe('退款联调前')
    expect(snapshot.project.tables[0].label).not.toBe('已修改')
    expect(()=>createSnapshot(project,'   ')).toThrow(/快照名称/)
  })
  it('识别项目、表和字段级变化',()=>{
    const before=cloneTemplate('users'),after=structuredClone(before)
    after.seed=99;after.tables[0].count+=10;after.tables[0].fields[0].generator='uuid';after.tables.splice(1,1);after.tables.push({id:'new_table',name:'events',label:'事件',count:3,fields:[{id:'new_id',name:'id',label:'ID',generator:'autoId',dataType:'number'}]})
    const changes=diffProjects(before,after)
    expect(changes.some(change=>change.id==='project-seed')).toBe(true)
    expect(changes.some(change=>change.id===`table-change-${before.tables[0].id}`)).toBe(true)
    expect(changes.some(change=>change.id===`field-change-${before.tables[0].fields[0].id}`)).toBe(true)
    expect(changes.some(change=>change.type==='remove'&&change.scope==='table')).toBe(true)
    expect(changes.some(change=>change.type==='add'&&change.scope==='table')).toBe(true)
  })
  it('相同项目没有差异',()=>{const project=cloneTemplate('testing');expect(diffProjects(project,structuredClone(project))).toEqual([])})
})
