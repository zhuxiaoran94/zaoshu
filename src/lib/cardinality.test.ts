import { describe, expect, it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { diagnoseProject } from './diagnostics'
import { generateProject } from './engine'
import { childrenForParent, plannedProjectCounts } from './cardinality'
import { validate } from './modeling'

describe('一对多基数生成',()=>{
  it('同一种子为每个父记录稳定生成范围内的子记录',()=>{
    const first=Array.from({length:20},(_,index)=>childrenForParent(42,'orders',index,1,3)),second=Array.from({length:20},(_,index)=>childrenForParent(42,'orders',index,1,3))
    expect(first).toEqual(second);expect(first.every(count=>count>=1&&count<=3)).toBe(true);expect(new Set(first).size).toBeGreaterThan(1)
  })
  it('电商模板连续驱动订单与明细，结果和计划完全一致',()=>{
    const project=cloneTemplate('commerce'),counts=plannedProjectCounts(project),first=generateProject(project),second=generateProject(project)
    expect(first.data.orders).toHaveLength(counts.orders);expect(first.data.order_items).toHaveLength(counts.order_items);expect(first.data).toEqual(second.data)
    const ordersByUser=new Map(first.data.users.map(user=>[user.id,first.data.orders.filter(order=>order.userId===user.id).length]));expect([...ordersByUser.values()].every(count=>count>=1&&count<=3)).toBe(true)
    const itemsByOrder=new Map(first.data.orders.map(order=>[order.id,first.data.order_items.filter(item=>item.orderId===order.id).length]));expect([...itemsByOrder.values()].every(count=>count>=2&&count<=4)).toBe(true)
    expect(first.report.checks.filter(check=>check.status==='fail')).toEqual([])
  })
  it('阻止一对多驱动字段使用唯一约束或留空规则',()=>{
    const project=cloneTemplate('commerce'),orders=project.tables.find(table=>table.id==='orders')!,driver=orders.fields.find(field=>field.id===orders.countByReference!.fieldId)!
    driver.unique=true;driver.nullable=10
    const ids=diagnoseProject(project).map(issue=>issue.id)
    expect(ids).toContain(`cardinality-unique-${orders.id}`);expect(ids).toContain(`cardinality-empty-${orders.id}`)
  })
  it('质量检查发现单个父记录的子数据基数被手工破坏',()=>{
    const project=cloneTemplate('commerce'),result=generateProject(project),firstUser=result.data.users[0].id
    const edited={...result.data,orders:result.data.orders.filter(order=>order.userId!==firstUser)}
    expect(validate(project,edited).find(check=>check.id==='cardinality-orders')).toMatchObject({status:'fail',issueCount:1})
  })
})
