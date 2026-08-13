import { beforeEach, describe, expect, it } from 'vitest'
import { cloneTemplate } from './data/templates'
import { useAppStore } from './store'

describe('项目建模状态', () => {
  beforeEach(() => {
    const project = cloneTemplate('commerce')
    useAppStore.setState({
      project,
      activeTableId: project.tables[0].id,
      selectedFieldId: project.tables[0].fields[0].id,
      past: [],
      future: [],
      generationError: '',
      diagnostics: [],
    })
  })

  it('可以新增、复制和撤销数据表', () => {
    const initialCount = useAppStore.getState().project.tables.length
    useAppStore.getState().addTable()
    expect(useAppStore.getState().project.tables).toHaveLength(initialCount + 1)
    const addedId = useAppStore.getState().activeTableId
    useAppStore.getState().duplicateTable(addedId)
    expect(useAppStore.getState().project.tables).toHaveLength(initialCount + 2)
    useAppStore.getState().undo()
    expect(useAppStore.getState().project.tables).toHaveLength(initialCount + 1)
    useAppStore.getState().redo()
    expect(useAppStore.getState().project.tables).toHaveLength(initialCount + 2)
  })

  it('被外键引用的数据表不能删除', () => {
    useAppStore.getState().removeTable('users')
    expect(useAppStore.getState().project.tables.some(table => table.id === 'users')).toBe(true)
    expect(useAppStore.getState().generationError).toMatch(/仍被其他表引用/)
  })

  it('复制表会生成不同的表名和字段 ID', () => {
    useAppStore.getState().duplicateTable('products')
    const tables = useAppStore.getState().project.tables
    const original = tables.find(table => table.id === 'products')!
    const copy = tables.find(table => table.label === '商品副本')!
    expect(copy.name).not.toBe(original.name)
    expect(new Set([...original.fields, ...copy.fields].map(field => field.id)).size).toBe(original.fields.length + copy.fields.length)
  })

  it('阻断问题存在时不会启动生成', async () => {
    const table = useAppStore.getState().project.tables[0]
    useAppStore.getState().updateField(table.id, table.fields[0].id, { min: 10, max: 1 })
    await useAppStore.getState().generate()
    const state = useAppStore.getState()
    expect(state.result).toBeNull()
    expect(state.panel).toBe('diagnostics')
    expect(state.generationError).toMatch(/阻断问题/)
  })

  it('编辑、删除和单行重生成后会刷新质量报告', async () => {
    const state = useAppStore.getState()
    state.project.tables.forEach(table => useAppStore.getState().updateTable(table.id, { count: 3 }))
    await useAppStore.getState().generate()
    const generated = useAppStore.getState().result!
    expect(generated).toBeTruthy()
    useAppStore.getState().updateCell(0, 'id', '12345')
    expect(typeof useAppStore.getState().result!.data.users[0].id).toBe('number')
    const before = useAppStore.getState().result!.data.users[0].id
    await useAppStore.getState().regenerateRow(0)
    expect(useAppStore.getState().result!.data.users[0].id).toBe(before)
    useAppStore.getState().deleteRow(0)
    expect(useAppStore.getState().result!.report.checks.find(check => check.id === 'count-users')?.status).toBe('fail')
  })
})
