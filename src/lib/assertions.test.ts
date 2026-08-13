import { describe, expect, it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { diagnoseProject } from './diagnostics'
import { generateProject } from './engine'
import { validate } from './modeling'

describe('业务断言',()=>{
  it('内置成功支付时间规则通过并可随项目配置保存',()=>{
    const project=cloneTemplate('commerce'),result=generateProject(project),check=result.report.checks.find(item=>item.id.includes('successful-payment-time'))
    expect(check).toMatchObject({status:'pass',issueCount:0})
    expect(project.tables.find(table=>table.id==='payments')?.assertions).toHaveLength(1)
  })

  it('篡改数据后按失败和警告级别定位真实问题行',()=>{
    const project=cloneTemplate('commerce'),result=generateProject(project),payments=project.tables.find(table=>table.id==='payments')!,successIndex=result.data.payments.findIndex(row=>row.status==='成功')
    result.data.payments[successIndex].paidAt=null
    let check=validate(project,result.data).find(item=>item.id.includes('successful-payment-time'))!
    expect(check).toMatchObject({status:'fail',rowIndexes:[successIndex],issueCount:1})
    payments.assertions![0].severity='warning';check=validate(project,result.data).find(item=>item.id.includes('successful-payment-time'))!
    expect(check.status).toBe('warning')
  })

  it('异常模式把规则违例标为预期异常',()=>{
    const project=cloneTemplate('commerce');project.mode='exception';project.tables.find(table=>table.id==='orders')!.assertions=[{id:'positive',name:'订单金额必须为正',expression:'amount > 0',message:'金额不能为零或负数',severity:'error'}]
    const data=generateProject(project).data;data.orders[0].amount=-1
    expect(validate(project,data).find(item=>item.id==='assertion-orders-positive')?.status).toBe('expected')
  })

  it('生成前拒绝语法错误、缺失字段和重复 ID',()=>{
    const project=cloneTemplate('users'),table=project.tables[0];table.assertions=[{id:'same',name:'坏语法',expression:'id;',message:'无效',severity:'error'},{id:'same',name:'缺失字段',expression:'missing > 0',message:'无效',severity:'error'}]
    const issues=diagnoseProject(project)
    expect(issues.some(issue=>issue.id.startsWith('assertion-syntax'))).toBe(true)
    expect(issues.some(issue=>issue.id.startsWith('assertion-fields'))).toBe(true)
    expect(issues.some(issue=>issue.id.startsWith('assertion-duplicate'))).toBe(true)
  })
})
