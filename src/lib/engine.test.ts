import { describe, expect, it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { generatePairwise, generateProject, sortTables } from './engine'
import { toCSV, toSQL } from './exporters'

describe('Mock造数引擎',()=>{
  it('相同随机种子生成一致结果',()=>{
    const project=cloneTemplate('commerce');project.tables.forEach(t=>t.count=4)
    const a=generateProject(project).data
    const b=generateProject(project).data
    expect(a).toEqual(b)
  })
  it('多表引用保持完整',()=>{
    const project=cloneTemplate('commerce');project.tables.forEach(t=>t.count=6)
    const {data}=generateProject(project)
    const userIds=new Set(data.users.map(r=>r.id))
    expect(data.orders.every(r=>userIds.has(r.userId))).toBe(true)
    const orderIds=new Set(data.orders.map(r=>r.id))
    expect(data.order_items.every(r=>orderIds.has(r.orderId))).toBe(true)
  })
  it('异常模式包含可追溯元数据',()=>{
    const project=cloneTemplate('users');project.mode='exception';project.tables.forEach(t=>t.count=10)
    const result=generateProject(project)
    expect(result.report.abnormalRows).toBeGreaterThan(0)
    expect(Object.values(result.data).flat().some(r=>r._mock_meta?.expected)).toBe(true)
  })
  it('Pairwise 覆盖任意二元组合',()=>{
    const dims=[{name:'A',values:['1','2','3']},{name:'B',values:['x','y']},{name:'C',values:['on','off']}]
    const rows=generatePairwise(dims)
    for(let i=0;i<dims.length;i++)for(let j=i+1;j<dims.length;j++)for(const a of dims[i].values)for(const b of dims[j].values)expect(rows.some(r=>r[dims[i].name]===a&&r[dims[j].name]===b)).toBe(true)
  })
  it('SQL 和 CSV 可解析导出',()=>{
    const project=cloneTemplate('testing');project.tables.forEach(t=>t.count=2)
    const {data}=generateProject(project)
    expect(toCSV(data.api_requests)).toContain('method')
    expect(toSQL(project,data,'postgres')).toContain('INSERT INTO')
    expect(toSQL(project,data,'mysql')).toContain('SET FOREIGN_KEY_CHECKS=0')
  })
  it('循环依赖会被拒绝',()=>{
    const project=cloneTemplate('users');project.tables[0].fields[0].ref={tableId:'addresses',field:'id'}
    expect(()=>sortTables(project.tables)).toThrow(/循环依赖/)
  })
})
