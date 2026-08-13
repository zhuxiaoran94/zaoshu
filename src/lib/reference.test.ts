import { describe, expect, it } from 'vitest'
import { analyzeReferenceDistribution, selectReferenceValue } from './reference'

const parents=[{id:1},{id:2},{id:3}]

describe('外键分配工具',()=>{
  it('轮询与一对一按行索引稳定选择',()=>{
    const random=()=>0.9
    expect(Array.from({length:7},(_,index)=>selectReferenceValue({tableId:'p',field:'id',strategy:'roundRobin'},index,parents,random))).toEqual([1,2,3,1,2,3,1])
    expect(Array.from({length:3},(_,index)=>selectReferenceValue({tableId:'p',field:'id',strategy:'oneToOne'},index,parents,random))).toEqual([1,2,3])
    expect(selectReferenceValue({tableId:'p',field:'id',strategy:'oneToOne'},3,parents,random)).toBeNull()
  })
  it('统计实际引用分布与重复行',()=>{
    expect(analyzeReferenceDistribution([{parentId:1},{parentId:1},{parentId:2}], 'parentId', parents, 'id')).toEqual({assigned:3,distinct:2,unused:1,minimum:0,maximum:2,topShare:67,duplicateRows:[1]})
    expect(analyzeReferenceDistribution([{parentId:99}], 'parentId', parents, 'id')).toMatchObject({assigned:1,distinct:0,unused:3})
  })
})
