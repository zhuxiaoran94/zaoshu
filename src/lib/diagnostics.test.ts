import { describe, expect, it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { diagnoseProject } from './diagnostics'

describe('生成前约束诊断', () => {
  it('内置模板默认没有阻断问题', () => {
    for (const id of ['users', 'commerce', 'finance', 'game', 'content', 'logistics', 'testing']) {
      expect(diagnoseProject(cloneTemplate(id)).filter(issue => issue.level === 'error')).toEqual([])
    }
  })

  it('发现唯一枚举容量不足并定位字段', () => {
    const project = cloneTemplate('users')
    const field = project.tables[0].fields[1]
    field.generator = 'gender'
    field.unique = true
    project.tables[0].count = 10
    const issue = diagnoseProject(project).find(item => item.id === `unique-${field.id}`)
    expect(issue).toMatchObject({ level: 'error', tableId: project.tables[0].id, fieldId: field.id })
  })

  it('发现循环依赖和公式中的无效引用', () => {
    const project = cloneTemplate('users')
    project.tables[0].fields[0].ref = { tableId: 'addresses', field: 'id' }
    project.tables[0].fields[1].formula = 'missing_name + "-ok"'
    const ids = diagnoseProject(project).map(issue => issue.id)
    expect(ids).toContain('dependency-cycle')
    expect(ids).toContain(`formula-${project.tables[0].fields[1].id}`)
  })

  it('发现条件规则引用自身或不存在字段', () => {
    const project = cloneTemplate('users')
    const field = project.tables[0].fields[1]
    field.condition = { combinator: 'or', rules: [{ field: field.name, operator: 'equals', value: 'A' }, { field: 'deleted', operator: 'empty' }], otherwise: 'omit' }
    const ids = diagnoseProject(project).map(issue => issue.id)
    expect(ids).toContain(`condition-self-${field.id}-0`)
    expect(ids).toContain(`condition-field-${field.id}-1`)
  })

  it('发现枚举权重数量和分布中心问题',()=>{
    const project=cloneTemplate('users'),field=project.tables[0].fields.find(candidate=>candidate.name==='status')!,age=project.tables[0].fields.find(candidate=>candidate.name==='id')!;field.values=['A','B','C'];field.weights=[1,2];age.min=0;age.max=10;age.distributionCenter=20
    const ids=diagnoseProject(project).map(issue=>issue.id);expect(ids).toContain(`weights-length-${field.id}`);expect(ids).toContain(`distribution-center-${age.id}`)
    field.weights=[0,0,0];expect(diagnoseProject(project).map(issue=>issue.id)).toContain(`weights-zero-${field.id}`)
  })
  it('发现公式语法错误、危险语法和自引用',()=>{
    const project=cloneTemplate('commerce'),table=project.tables.find(candidate=>candidate.id==='products')!,field=table.fields.find(candidate=>candidate.name==='price')!;field.formula='price.constructor(1)';expect(diagnoseProject(project).some(issue=>issue.id===`formula-syntax-${field.id}`)).toBe(true)
    field.formula='price + missing';expect(diagnoseProject(project).some(issue=>issue.id===`formula-${field.id}`)).toBe(true)
  })
  it('严格一对一在父表容量不足或允许留空时阻止生成',()=>{
    const project=cloneTemplate('commerce'),users=project.tables.find(table=>table.id==='users')!,orders=project.tables.find(table=>table.id==='orders')!,field=orders.fields.find(candidate=>candidate.name==='userId')!
    users.count=2;orders.count=3;field.ref={tableId:'users',field:'id',strategy:'oneToOne'};field.nullable=5
    const ids=diagnoseProject(project).map(issue=>issue.id)
    expect(ids).toContain(`ref-capacity-${field.id}`);expect(ids).toContain(`ref-one-null-${field.id}`)
    field.condition={combinator:'and',rules:[{field:'status',operator:'equals',value:'已支付'}],otherwise:'null'};field.prefix='X-'
    const conflictIds=diagnoseProject(project).map(issue=>issue.id);expect(conflictIds).toContain(`ref-one-condition-${field.id}`);expect(conflictIds).toContain(`ref-transform-${field.id}`)
  })
})
