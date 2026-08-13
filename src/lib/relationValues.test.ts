import { describe, expect, it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { diagnoseProject } from './diagnostics'
import { generateProject } from './engine'
import { validate } from './modeling'

describe('跨表业务计算',()=>{
  it('电商订单金额汇总明细，支付金额回填订单且可复现',()=>{
    const project=cloneTemplate('commerce'),first=generateProject(project),second=generateProject(project),orders=new Map(first.data.orders.map(order=>[order.id,order]))
    first.data.orders.forEach(order=>{const expected=first.data.order_items.filter(item=>item.orderId===order.id).reduce((sum,item)=>sum+Number(item.price)*Number(item.quantity),0);expect(order.amount).toBe(Number(expected.toFixed(2)))})
    expect(first.data.payments.every(payment=>payment.amount===orders.get(payment.orderId)?.amount)).toBe(true);expect(first.data).toEqual(second.data)
    expect(first.report.checks.filter(check=>check.status==='fail')).toEqual([])
  })
  it('手工篡改金额后质量检查定位不一致记录',()=>{
    const project=cloneTemplate('commerce'),result=generateProject(project),data=structuredClone(result.data);data.orders[0].amount=0;data.payments[0].amount=-1
    expect(validate(project,data).find(check=>check.id===`relation-value-${project.tables.find(table=>table.id==='orders')!.fields.find(field=>field.name==='amount')!.id}`)).toMatchObject({status:'fail',rowIndexes:[0]})
    expect(validate(project,data).some(check=>check.label.includes('支付记录.支付金额')&&check.status==='fail')).toBe(true)
  })
  it('拒绝跨表表达式引用不存在字段',()=>{
    const project=cloneTemplate('commerce'),amount=project.tables.find(table=>table.id==='orders')!.fields.find(field=>field.name==='amount')!;amount.relationValue={...amount.relationValue!,expression:'missing * quantity'} as typeof amount.relationValue
    expect(diagnoseProject(project).some(issue=>issue.id.startsWith(`relation-value-${amount.id}`))).toBe(true)
  })
  it('同一张表的多个回填字段都会执行',()=>{
    const project=cloneTemplate('commerce'),payments=project.tables.find(table=>table.id==='payments')!,orders=project.tables.find(table=>table.id==='orders')!
    payments.fields.push({id:'payment_order_status',name:'orderStatus',label:'订单状态快照',generator:'orderStatus',dataType:'string',relationValue:{kind:'lookup',localForeignKey:'orderId',sourceTableId:'orders',sourceKey:'id',sourceField:'status'}})
    const result=generateProject(project),orderMap=new Map(result.data.orders.map(order=>[order.id,order]))
    expect(result.data.payments.every(payment=>payment.amount===orderMap.get(payment.orderId)?.amount&&payment.orderStatus===orderMap.get(payment.orderId)?.status)).toBe(true)
  })
  it('混合聚合和回填链按字段依赖排序并检测循环',()=>{
    const project=cloneTemplate('commerce'),items=project.tables.find(table=>table.id==='order_items')!,orders=project.tables.find(table=>table.id==='orders')!,productId=items.fields.find(field=>field.name==='productId')!
    items.fields.push({id:'item_product_price',name:'productPrice',label:'商品标价',generator:'amount',dataType:'number',relationValue:{kind:'lookup',localForeignKey:'productId',sourceTableId:'products',sourceKey:'id',sourceField:'price'}})
    orders.fields.find(field=>field.name==='amount')!.relationValue={kind:'aggregate',sourceTableId:'order_items',sourceForeignKey:'orderId',expression:'productPrice * quantity',operation:'sum',precision:2}
    expect(generateProject(project).report.checks.filter(check=>check.status==='fail')).toEqual([])
    productId.relationValue={kind:'lookup',localForeignKey:'orderId',sourceTableId:'orders',sourceKey:'id',sourceField:'amount'}
    orders.fields.find(field=>field.name==='amount')!.relationValue={kind:'aggregate',sourceTableId:'order_items',sourceForeignKey:'orderId',expression:'productId',operation:'sum',precision:2}
    expect(diagnoseProject(project).some(issue=>issue.id==='relation-value-cycle')).toBe(true)
  })
  it('异常模式保留定向注入的跨表金额差异',()=>{
    const project=cloneTemplate('commerce');project.mode='exception';project.tables.forEach(table=>{table.countByReference=undefined;table.count=20})
    const result=generateProject(project),mutated=Object.values(result.data).flat().filter(row=>row._mock_meta&&['amount'].includes(row._mock_meta.field))
    expect(mutated.length).toBeGreaterThan(0);expect(result.report.checks.some(check=>check.id.startsWith('relation-value-')&&check.status==='expected')).toBe(true)
  })
})
