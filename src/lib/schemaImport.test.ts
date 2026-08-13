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
  it('从 MySQL DDL 推断主键、唯一、枚举、精度和外键',()=>{
    const ddl=`CREATE TABLE users (id BIGINT PRIMARY KEY, email VARCHAR(120) NOT NULL UNIQUE, status ENUM('正常','冻结'));\nCREATE TABLE orders (id BIGINT, user_id BIGINT NOT NULL, amount DECIMAL(12,2), paid TINYINT(1), metadata JSON, PRIMARY KEY (id), CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id));`
    const result=importSchemaText(ddl),users=result.project.tables.find(table=>table.name==='users')!,orders=result.project.tables.find(table=>table.name==='orders')!
    expect(result.source).toBe('sql');expect(users.fields.find(field=>field.name==='email')).toMatchObject({length:120,unique:true,missing:0});expect(users.fields.find(field=>field.name==='status')?.values).toEqual(['正常','冻结'])
    expect(orders.fields.find(field=>field.name==='amount')).toMatchObject({dataType:'number',precision:2});expect(orders.fields.find(field=>field.name==='paid')?.dataType).toBe('boolean');expect(orders.fields.find(field=>field.name==='metadata')?.dataType).toBe('object');expect(orders.fields.find(field=>field.name==='user_id')?.ref).toEqual({tableId:users.id,field:'id'})
  })
  it('支持 PostgreSQL/SQLite 引号标识符和行内 REFERENCES',()=>{
    const ddl=`CREATE TABLE "teams" ("id" UUID PRIMARY KEY, "name" TEXT NOT NULL); CREATE TABLE "members" ("id" INTEGER PRIMARY KEY, "team_id" UUID REFERENCES "teams"("id"), "joined_at" TIMESTAMP);`
    const result=importSchemaText(ddl),teams=result.project.tables.find(table=>table.name==='teams')!,members=result.project.tables.find(table=>table.name==='members')!
    expect(teams.fields.find(field=>field.name==='id')).toMatchObject({dataType:'string',generator:'uuid',primaryKey:true});expect(members.fields.find(field=>field.name==='team_id')?.ref).toEqual({tableId:teams.id,field:'id'});expect(members.fields.find(field=>field.name==='joined_at')?.dataType).toBe('date')
  })
  it('DDL 只识别 CREATE TABLE，不执行其中语句',()=>{
    const result=importSchemaText(`DROP TABLE secrets; CREATE TABLE safe_table (id INTEGER PRIMARY KEY, note TEXT); INSERT INTO safe_table VALUES (1, 'x');`)
    expect(result.project.tables.map(table=>table.name)).toEqual(['safe_table']);expect(result.project.tables[0].count).toBe(20)
  })
  it('从 TypeScript interface 推断可选、可空、枚举、日期和外键',()=>{
    const source=`export interface User { readonly id: number; email: string; status: '正常' | '冻结'; nickname?: string | null; createdAt: Date }\nexport interface Order { id: number; userId: number; buyer: User; amount: number; paid: boolean; tags: string[] }`
    const result=importSchemaText(source),users=result.project.tables.find(table=>table.name==='user')!,orders=result.project.tables.find(table=>table.name==='order')!
    expect(result.source).toBe('typescript');expect(users.fields.find(field=>field.name==='status')?.values).toEqual(['正常','冻结']);expect(users.fields.find(field=>field.name==='nickname')).toMatchObject({missing:15,nullable:10});expect(users.fields.find(field=>field.name==='createdAt')).toMatchObject({dataType:'date',generator:'dateTime'})
    expect(orders.fields.find(field=>field.name==='userId')?.ref).toEqual({tableId:users.id,field:'id'});expect(orders.fields.find(field=>field.name==='buyer')?.ref).toEqual({tableId:users.id,field:'id'});expect(orders.fields.find(field=>field.name==='tags')).toMatchObject({dataType:'object',fixedValue:'[]'})
  })
  it('TypeScript 解析不执行代码，并对无法识别的成员给出告警',()=>{
    ;(globalThis as Record<string,unknown>).__mockExecuted=false
    const result=importSchemaText(`interface Safe { id: number; run(): void; payload: { nested: string }; note: string = ((globalThis.__mockExecuted = true) as any) }`)
    expect((globalThis as Record<string,unknown>).__mockExecuted).toBe(false);expect(result.project.tables[0].fields.some(field=>field.name==='payload')).toBe(true);expect(result.warnings.length).toBeGreaterThan(0)
  })
})
