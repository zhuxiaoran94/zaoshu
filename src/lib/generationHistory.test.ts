import { describe, expect, it } from 'vitest'
import { cloneTemplate } from '../data/templates'
import { generateProject } from './engine'
import { createGenerationHistoryItem } from './generationHistory'

describe('生成历史',()=>{
  it('只保存可复现配置和摘要，不保存生成数据',()=>{
    const project=cloneTemplate('users');project.tables.forEach(table=>table.count=2);const result=generateProject(project),item=createGenerationHistoryItem(project,result,new Date('2026-08-14T00:00:00.000Z'))
    expect(item).toMatchObject({createdAt:'2026-08-14T00:00:00.000Z',totalRows:6,duration:result.report.duration});expect(item.project).toEqual(project);expect(item).not.toHaveProperty('data');expect(item).not.toHaveProperty('result')
  })
  it('历史配置与之后的项目编辑隔离',()=>{
    const project=cloneTemplate('testing');project.tables.forEach(table=>table.count=1);const item=createGenerationHistoryItem(project,generateProject(project));project.seed=9;project.tables[0].fields[0].label='修改后';expect(item.project.seed).not.toBe(9);expect(item.project.tables[0].fields[0].label).not.toBe('修改后')
  })
})
