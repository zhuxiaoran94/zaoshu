import { describe, expect, it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { analyzePairwiseCoverage, generatePairwise, generateProject, generateStateEvents, matchesFieldCondition, parsePairwiseRules, refreshGeneratedResult, regenerateDataRow, sortTables } from './engine'
import { neutralizeSpreadsheetFormula, toCSV, toSQL } from './exporters'
import { parseProjectFile, serializeProject } from './projectConfig'
import type { FieldRule } from '../types'

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
  it('Pairwise 支持排除和强制组合并保持 100% 合法参数对覆盖',()=>{
    const dims=[{name:'设备',values:['iOS','Android','Web']},{name:'登录',values:['密码','微信']},{name:'状态',values:['正常','注销']},{name:'网络',values:['WiFi','弱网']}]
    const exclusions=[{状态:'注销',登录:'微信'}],forced=[{设备:'iOS',网络:'弱网'}]
    const rows=generatePairwise(dims,{exclusions,forced})
    expect(rows.every(row=>!(row.状态==='注销'&&row.登录==='微信'))).toBe(true)
    expect(rows.some(row=>row.设备==='iOS'&&row.网络==='弱网')).toBe(true)
    expect(analyzePairwiseCoverage(dims,rows,exclusions)).toMatchObject({percentage:100,missing:[]})
    expect(generatePairwise(dims,{exclusions,forced})).toEqual(rows)
  })
  it('Pairwise 文本规则会校验未知维度、未知值和强制冲突',()=>{
    const dims=[{name:'A',values:['1','2']},{name:'B',values:['x','y']}]
    expect(parsePairwiseRules('A=1, B=x',dims)).toEqual([{A:'1',B:'x'}])
    expect(()=>parsePairwiseRules('C=1',dims)).toThrow(/未知维度/)
    expect(()=>parsePairwiseRules('A=3',dims)).toThrow(/不包含候选值/)
    expect(()=>generatePairwise(dims,{exclusions:[{A:'1'}],forced:[{A:'1',B:'x'}]})).toThrow(/冲突/)
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
  it('项目配置可以安全导出与恢复',()=>{
    const project=cloneTemplate('commerce')
    expect(parseProjectFile(serializeProject(project))).toEqual(project)
    expect(()=>parseProjectFile(JSON.stringify({fileType:'other',fileVersion:1,project}))).toThrow(/不是 Mock造数工具/)
  })
  it('拒绝危险或过大的项目配置',()=>{
    const project=cloneTemplate('users')
    project.tables[0].fields[0].name='id; DROP TABLE users'
    expect(()=>parseProjectFile(serializeProject(project))).toThrow(/字段名/)
    const tooLarge='x'.repeat(1024*1024+1)
    expect(()=>parseProjectFile(tooLarge)).toThrow(/1 MB/)
  })
  it('CSV 与 Excel 文本会阻断公式注入',()=>{
    expect(neutralizeSpreadsheetFormula('=HYPERLINK("https://evil.test")')).toBe(`'=HYPERLINK("https://evil.test")`)
    expect(toCSV([{value:'@SUM(1,2)'}])).toContain(`'@SUM(1,2)`)
  })
  it('条件字段支持 AND、OR、空值和数值比较',()=>{
    const field:FieldRule={id:'paidAt',name:'paidAt',label:'支付时间',generator:'dateTime',dataType:'date',condition:{combinator:'and',rules:[{field:'status',operator:'equals',value:'成功'},{field:'amount',operator:'greaterThan',value:'100'}],otherwise:'null'}}
    expect(matchesFieldCondition(field,{status:'成功',amount:101})).toBe(true)
    expect(matchesFieldCondition(field,{status:'失败',amount:101})).toBe(false)
    field.condition={combinator:'or',rules:[{field:'status',operator:'empty'},{field:'status',operator:'equals',value:'成功'}],otherwise:'null'}
    expect(matchesFieldCondition(field,{status:null})).toBe(true)
  })
  it('条件不满足时按配置置空或移除字段',()=>{
    const project=cloneTemplate('commerce');const payments=project.tables.find(table=>table.id==='payments')!;payments.count=4
    const result=generateProject(project).data.payments
    expect(result.filter(row=>row.status==='成功').every(row=>typeof row.paidAt==='string')).toBe(true)
    expect(result.filter(row=>row.status!=='成功').every(row=>row.paidAt===null)).toBe(true)
    const paidAt=payments.fields.find(field=>field.name==='paidAt')!;paidAt.condition!.otherwise='omit'
    const omitted=generateProject(project).data.payments
    expect(omitted.filter(row=>row.status!=='成功').every(row=>!('paidAt' in row))).toBe(true)
  })
  it('状态链支持固定终态、停留时长与可复现结果',()=>{
    const options={terminalIndex:2,minStayMinutes:15,maxStayMinutes:30,errorMode:'none' as const}
    const events=generateStateEvents('order',3,42,options)
    expect(events).toHaveLength(9)
    expect(events.filter(event=>event.entityId==='order-1').map(event=>event.status)).toEqual(['待支付','已支付','待发货'])
    expect(events.filter(event=>event.stayMinutes!==null).every(event=>event.stayMinutes!>=15&&event.stayMinutes!<=30)).toBe(true)
    expect(generateStateEvents('order',3,42,options)).toEqual(events)
  })
  it('状态链可定向注入倒退、跳过和重复事件',()=>{
    for(const errorMode of ['rollback','skip','duplicate'] as const){
      const events=generateStateEvents('logistics',4,42,{errorMode})
      expect(events.some(event=>!event.valid&&event.mutation===errorMode)).toBe(true)
      expect(events.every((event,index,array)=>index===0||event.entityId!==array[index-1].entityId||new Date(event.occurredAt)>new Date(array[index-1].occurredAt))).toBe(true)
    }
  })
  it('单行重生成保留主键和锁定字段并重新满足外键',()=>{
    const project=cloneTemplate('commerce');project.tables.forEach(table=>table.count=6);const result=generateProject(project),before=result.data.orders[2]
    const regenerated=regenerateDataRow(project,result.data,'orders',2,{},['status'],123)
    expect(regenerated.id).toBe(before.id)
    expect(regenerated.status).toBe(before.status)
    expect(new Set(result.data.users.map(row=>row.id)).has(regenerated.userId)).toBe(true)
    expect(regenerated.orderNo).not.toBe(before.orderNo)
  })
  it('编辑结果后重算总量、异常量与质量报告',()=>{
    const project=cloneTemplate('testing');project.tables.forEach(table=>table.count=3);const result=generateProject(project),data={...result.data,api_requests:result.data.api_requests.slice(1)}
    const refreshed=refreshGeneratedResult(project,result,data)
    expect(refreshed.report.totalRows).toBe(result.report.totalRows-1)
    expect(refreshed.report.checks.find(check=>check.id==='count-api_requests')?.status).toBe('fail')
  })
})
