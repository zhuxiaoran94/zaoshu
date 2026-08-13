import { describe, expect, it } from 'vitest'
import type { TableSchema } from '../types'
import { analyzeTableFields } from './statistics'

describe('字段统计',()=>{
  it('统计缺失、空值、唯一率、范围和高频值',()=>{
    const table:TableSchema={id:'t',name:'orders',label:'订单',count:4,fields:[{id:'amount',name:'amount',label:'金额',generator:'amount',dataType:'number'},{id:'status',name:'status',label:'状态',generator:'customEnum',dataType:'string'}]}
    const result=analyzeTableFields(table,[{amount:10,status:'成功'},{amount:20,status:'成功'},{amount:null,status:'失败'},{status:'成功'}])
    expect(result[0]).toMatchObject({missing:1,nulls:1,unique:2,uniqueRate:100,min:'10',max:'20'})
    expect(result[1].topValues[0]).toEqual({value:'成功',count:3})
  })
})
