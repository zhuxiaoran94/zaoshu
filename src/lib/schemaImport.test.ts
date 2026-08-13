import { describe, expect, it } from 'vitest'
import { importSchemaText } from './schemaImport'

describe('Schema 导入',()=>{
  it('从 OpenAPI 3 推断表、生成器、枚举和外键',async()=>{
    const input={openapi:'3.0.3',info:{title:'订单 API',version:'2.1'},components:{schemas:{User:{type:'object',required:['id','email'],properties:{id:{type:'integer'},email:{type:'string',format:'email'},status:{type:'string',enum:['正常','冻结']}}},Order:{type:'object',properties:{id:{type:'integer'},userId:{type:'integer'},amount:{type:'number',minimum:0,maximum:999},createdAt:{type:'string',format:'date-time'}}}}}}
    const result=await importSchemaText(JSON.stringify(input)),users=result.project.tables.find(table=>table.name==='user')!,orders=result.project.tables.find(table=>table.name==='order')!
    expect(result.source).toBe('openapi');expect(users.fields.find(field=>field.name==='email')?.generator).toBe('email');expect(users.fields.find(field=>field.name==='status')?.values).toEqual(['正常','冻结'])
    expect(orders.fields.find(field=>field.name==='userId')?.ref).toEqual({tableId:users.id,field:'id'});expect(orders.fields.find(field=>field.name==='amount')).toMatchObject({min:0,max:999});expect(orders.fields.find(field=>field.name==='createdAt')?.dataType).toBe('date')
  })
  it('从单表 JSON 数组推断字段和必填性',async()=>{
    const result=await importSchemaText(JSON.stringify([{id:1,name:'A',enabled:true},{id:2,name:'B'}])),table=result.project.tables[0]
    expect(result.source).toBe('json');expect(table.fields.find(field=>field.name==='id')).toMatchObject({dataType:'number',primaryKey:true});expect(table.fields.find(field=>field.name==='enabled')?.missing).toBe(15);expect(table.fields.find(field=>field.name==='name')?.missing).toBe(0)
  })
  it('从多数组 JSON 推断多表和 ID 关系',async()=>{
    const result=await importSchemaText(JSON.stringify({users:[{id:1,name:'A'}],orders:[{id:2,userId:1,amount:9.9}]})),users=result.project.tables.find(table=>table.name==='users')!,orders=result.project.tables.find(table=>table.name==='orders')!
    expect(result.project.tables).toHaveLength(2);expect(orders.fields.find(field=>field.name==='userId')?.ref).toEqual({tableId:users.id,field:'id'})
  })
  it('拒绝无效、非对象和超大输入',async()=>{
    await expect(importSchemaText('{')).rejects.toThrow(/JSON|YAML|解析/);await expect(importSchemaText('123')).rejects.toThrow(/根节点/);await expect(importSchemaText(JSON.stringify(['a','b']))).rejects.toThrow(/对象元素/);await expect(importSchemaText(' '.repeat(1024*1024+1))).rejects.toThrow(/1 MB/)
  })
  it('从 MySQL DDL 推断主键、唯一、枚举、精度和外键',async()=>{
    const ddl=`CREATE TABLE users (id BIGINT PRIMARY KEY, email VARCHAR(120) NOT NULL UNIQUE, status ENUM('正常','冻结'));\nCREATE TABLE orders (id BIGINT, user_id BIGINT NOT NULL, amount DECIMAL(12,2), paid TINYINT(1), metadata JSON, PRIMARY KEY (id), CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id));`
    const result=await importSchemaText(ddl),users=result.project.tables.find(table=>table.name==='users')!,orders=result.project.tables.find(table=>table.name==='orders')!
    expect(result.source).toBe('sql');expect(users.fields.find(field=>field.name==='email')).toMatchObject({length:120,unique:true,missing:0});expect(users.fields.find(field=>field.name==='status')?.values).toEqual(['正常','冻结'])
    expect(orders.fields.find(field=>field.name==='amount')).toMatchObject({dataType:'number',precision:2});expect(orders.fields.find(field=>field.name==='paid')?.dataType).toBe('boolean');expect(orders.fields.find(field=>field.name==='metadata')?.dataType).toBe('object');expect(orders.fields.find(field=>field.name==='user_id')?.ref).toEqual({tableId:users.id,field:'id'})
  })
  it('支持 PostgreSQL/SQLite 引号标识符和行内 REFERENCES',async()=>{
    const ddl=`CREATE TABLE "teams" ("id" UUID PRIMARY KEY, "name" TEXT NOT NULL); CREATE TABLE "members" ("id" INTEGER PRIMARY KEY, "team_id" UUID REFERENCES "teams"("id"), "joined_at" TIMESTAMP);`
    const result=await importSchemaText(ddl),teams=result.project.tables.find(table=>table.name==='teams')!,members=result.project.tables.find(table=>table.name==='members')!
    expect(teams.fields.find(field=>field.name==='id')).toMatchObject({dataType:'string',generator:'uuid',primaryKey:true});expect(members.fields.find(field=>field.name==='team_id')?.ref).toEqual({tableId:teams.id,field:'id'});expect(members.fields.find(field=>field.name==='joined_at')?.dataType).toBe('date')
  })
  it('DDL 只识别 CREATE TABLE，不执行其中语句',async()=>{
    const result=await importSchemaText(`DROP TABLE secrets; CREATE TABLE safe_table (id INTEGER PRIMARY KEY, note TEXT); INSERT INTO safe_table VALUES (1, 'x');`)
    expect(result.project.tables.map(table=>table.name)).toEqual(['safe_table']);expect(result.project.tables[0].count).toBe(20)
  })
  it('从 TypeScript interface 推断可选、可空、枚举、日期和外键',async()=>{
    const source=`export interface User { readonly id: number; email: string; status: '正常' | '冻结'; nickname?: string | null; createdAt: Date }\nexport interface Order { id: number; userId: number; buyer: User; amount: number; paid: boolean; tags: string[] }`
    const result=await importSchemaText(source),users=result.project.tables.find(table=>table.name==='user')!,orders=result.project.tables.find(table=>table.name==='order')!
    expect(result.source).toBe('typescript');expect(users.fields.find(field=>field.name==='status')?.values).toEqual(['正常','冻结']);expect(users.fields.find(field=>field.name==='nickname')).toMatchObject({missing:15,nullable:10});expect(users.fields.find(field=>field.name==='createdAt')).toMatchObject({dataType:'date',generator:'dateTime'})
    expect(orders.fields.find(field=>field.name==='userId')?.ref).toEqual({tableId:users.id,field:'id'});expect(orders.fields.find(field=>field.name==='buyer')?.ref).toEqual({tableId:users.id,field:'id'});expect(orders.fields.find(field=>field.name==='tags')).toMatchObject({dataType:'object',fixedValue:'[]'})
  })
  it('TypeScript 解析不执行代码，并对无法识别的成员给出告警',async()=>{
    ;(globalThis as Record<string,unknown>).__mockExecuted=false
    const result=await importSchemaText(`interface Safe { id: number; run(): void; payload: { nested: string }; note: string = ((globalThis.__mockExecuted = true) as any) }`)
    expect((globalThis as Record<string,unknown>).__mockExecuted).toBe(false);expect(result.project.tables[0].fields.some(field=>field.name==='payload')).toBe(true);expect(result.warnings.length).toBeGreaterThan(0)
  })
  it('直接导入 OpenAPI YAML 并推断字段',async()=>{
    const yaml=`openapi: 3.0.3\ninfo:\n  title: 会员 API\n  version: 1.4\ncomponents:\n  schemas:\n    Member:\n      type: object\n      required: [id, email]\n      properties:\n        id: { type: integer }\n        email: { type: string, format: email }\n        role:\n          type: string\n          enum: [普通, 管理员]\n`
    const result=await importSchemaText(yaml),member=result.project.tables[0];expect(result.source).toBe('openapi');expect(result.project.name).toContain('会员 API');expect(member.fields.find(field=>field.name==='email')?.generator).toBe('email');expect(member.fields.find(field=>field.name==='role')?.values).toEqual(['普通','管理员'])
  })
  it('拒绝 YAML 重复键和未知执行标签',async()=>{
    await expect(importSchemaText('openapi: 3.0.3\nopenapi: 3.1.0')).rejects.toThrow(/解析|Map keys|键/)
    await expect(importSchemaText('payload: !!js/function "function(){ return 1 }"')).rejects.toThrow(/解析|tag/)
  })
  it('展开 OpenAPI 本地 $ref 与 allOf，并保持对象数组类型',async()=>{
    const input={openapi:'3.0.3',info:{title:'复用模型',version:'1'},components:{schemas:{Base:{type:'object',required:['id'],properties:{id:{type:'integer'},createdAt:{type:'string',format:'date-time'}}},User:{allOf:[{$ref:'#/components/schemas/Base'},{type:'object',required:['email'],properties:{email:{type:'string',format:'email'},roles:{type:'array',items:{type:'string'}}}}]},Order:{type:'object',properties:{id:{type:'integer'},userId:{type:'integer'},buyer:{$ref:'#/components/schemas/User'}}}}}}
    const result=await importSchemaText(JSON.stringify(input)),users=result.project.tables.find(table=>table.name==='user')!,orders=result.project.tables.find(table=>table.name==='order')!
    expect(users.fields.map(field=>field.name)).toEqual(expect.arrayContaining(['id','createdAt','email','roles']));expect(users.fields.find(field=>field.name==='email')?.missing).toBe(0);expect(users.fields.find(field=>field.name==='roles')).toMatchObject({dataType:'object',generator:'fixed',fixedValue:'[]'});expect(orders.fields.find(field=>field.name==='buyer')?.ref).toEqual({tableId:users.id,field:'id'});expect(orders.fields.find(field=>field.name==='userId')?.ref).toEqual({tableId:users.id,field:'id'})
  })
  it('拒绝外部或缺失 $ref，并对循环引用告警',async()=>{
    const external={openapi:'3.0.3',components:{schemas:{Unsafe:{$ref:'https://example.com/schema.json'}}}};await expect(importSchemaText(JSON.stringify(external))).rejects.toThrow(/拒绝外部/)
    const missing={openapi:'3.0.3',components:{schemas:{Broken:{$ref:'#/components/schemas/Missing'}}}};await expect(importSchemaText(JSON.stringify(missing))).rejects.toThrow(/目标不存在/)
    const circular={openapi:'3.0.3',components:{schemas:{Node:{type:'object',properties:{child:{$ref:'#/components/schemas/Node'}}}}}};const result=await importSchemaText(JSON.stringify(circular));expect(result.warnings.some(warning=>warning.includes('循环'))).toBe(true)
  })
})
