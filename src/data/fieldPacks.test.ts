import { describe,expect,it } from 'vitest'
import type { FieldRule } from '../types'
import { FIELD_PACKS,planFieldPack } from './fieldPacks'
import { cloneTemplate } from './templates'
import { generateProject } from '../lib/engine'
import { analyzeCoverage } from '../lib/coverage'

const existing:FieldRule[]=[{id:'1',name:'name',label:'名称',generator:'randomString',dataType:'string'},{id:'2',name:'phone',label:'电话',generator:'phone',dataType:'string'}]

describe('字段套餐',()=>{
  it('提供业务与工程常用套餐',()=>{expect(FIELD_PACKS.length).toBeGreaterThanOrEqual(10);expect(new Set(FIELD_PACKS.map(pack=>pack.category))).toEqual(new Set(['业务','工程']))})
  it('默认跳过同名字段且不修改原字段',()=>{const plan=planFieldPack(existing,'identity');expect(plan.conflicts).toEqual(['name','phone']);expect(plan.fields.some(field=>field.name==='name')).toBe(false);expect(existing).toHaveLength(2)})
  it('可自动生成无冲突字段名和全新 ID',()=>{const plan=planFieldPack(existing,'identity','rename'),names=plan.fields.map(field=>field.name);expect(names).toContain('name_2');expect(names).toContain('phone_2');expect(new Set(plan.fields.map(field=>field.id)).size).toBe(plan.fields.length)})
  it('每套字段套餐生成后没有非预期质量失败',()=>{FIELD_PACKS.forEach(pack=>{const project=cloneTemplate('testing'),table=project.tables[0];table.count=8;table.fields=[table.fields[0],...planFieldPack([table.fields[0]],pack.id).fields];const result=generateProject({...project,tables:[table]});expect(result.report.checks.filter(check=>check.status==='fail'),pack.name).toEqual([])})})
  it('数字枚举覆盖缺口保持数字类型',()=>{const project=cloneTemplate('testing'),table=project.tables[0];table.fields=planFieldPack([],'pagination').fields;const pageSize=table.fields.find(field=>field.name==='pageSize')!;const gaps=analyzeCoverage({...project,tables:[table]},{[table.id]:[{page:1,pageSize:10,total:1,hasNext:false,nextCursor:null}]});expect(gaps.gaps.find(gap=>gap.fieldId===pageSize.id)?.missingValues).toEqual([20,50,100])})
})
