import { describe, expect, it } from 'vitest'
import { importSchemaText } from './schemaImport'

describe('Schema 导入',()=>{
  it('从 OpenAPI 3 推断表、生成器、枚举和外键',()=>{
    const input={openapi:'3.0.3',info:{title:'订单 API',version:'2.1'},components:{schemas:{User:{type:'object',required:['id','email'],properties:{id:{type:'integer'},email:{type:'string',format:'email'},status:{type:'string',enum:['正常','冻结']}}},Order:{type:'object',properties:{id:{type:'integer'},userId:{type:'integer'},amount:{type:'number',minimum:0,maximum:999},createdAt:{type:'string',format:'date-time'}}}}}}
    const result=importSchemaText(JSON.stringify(input)),users=result.project.tables.find(table=>table.name==='user')!,orders=result.project.tables.find(table=>table.name==='order')!
    expect(result.source).toBe('openapi');expect(users.fields.find(field=>field.name==='email')?.generator).toBe('email');expect(users.fields.find(field=>field.name==='status')?.values).toEqual(['正常','冻结'])
    expect(orders.fields.find(field=>field.name==='userId')?.ref).toEqual({tableId:users.id,field:'id'});expect(orders.fields.find(field=>field.name==='amount')).toMatchObject({min:0,max:999});expect(orders.fields.find(field=>field.name==='createdAt')?.dataType).toBe('date')
  })
  it('从单表 JSON 数组推断字段和必填性',()=>{
    const result=importSchemaText(JSON.stringify([{id:1,name:'A',enabled:true},{id:2,name:'B'}])),table=result.project.tables[0]
    expect(result.source).toBe('json');expect(table.fields.find(field=>field.name==='id')).toMatchObject({dataType:'number',primaryKey:true});expect(table.fields.find(field=>field.name==='enabled')?.missing).toBe(15);expect(table.fields.find(field=>field.name==='name')?.missing).toBe(0)
  })
  it('从多数组 JSON 推断多表和 ID 关系',()=>{
    const result=importSchemaText(JSON.stringify({users:[{id:1,name:'A'}],orders:[{id:2,userId:1,amount:9.9}]})),users=result.project.tables.find(table=>table.name==='users')!,orders=result.project.tables.find(table=>table.name==='orders')!
    expect(result.project.tables).toHaveLength(2);expect(orders.fields.find(field=>field.name==='userId')?.ref).toEqual({tableId:users.id,field:'id'})
  })
  it('拒绝无效、非对象和超大输入',()=>{
    expect(()=>importSchemaText('{')).toThrow(/JSON/);expect(()=>importSchemaText('123')).toThrow(/根节点/);expect(()=>importSchemaText(JSON.stringify(['a','b']))).toThrow(/对象元素/);expect(()=>importSchemaText(' '.repeat(1024*1024+1))).toThrow(/1 MB/)
  })
})
