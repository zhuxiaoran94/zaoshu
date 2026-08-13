import { describe,expect,it,vi } from 'vitest'
import { searchCommands, type PaletteCommand } from './CommandPalette'

const action=vi.fn(),commands:PaletteCommand[]=[{id:'generate',label:'生成数据',hint:'按当前规则生成',group:'数据',keywords:'run mock',action},{id:'template-commerce',label:'切换到电商系统',hint:'加载订单模板',group:'场景',keywords:'commerce 商城',action},{id:'quality',label:'查看质量检查',hint:'定位失败记录',group:'结果',keywords:'report',action}]

describe('命令中心搜索',()=>{
  it('空查询保留全部命令',()=>expect(searchCommands(commands,'')).toHaveLength(3))
  it('支持中文、英文关键词和多词交集',()=>{expect(searchCommands(commands,'电商')).toHaveLength(1);expect(searchCommands(commands,'commerce')).toHaveLength(1);expect(searchCommands(commands,'结果 report')[0].id).toBe('quality')})
  it('未知关键词返回空列表',()=>expect(searchCommands(commands,'不存在')).toEqual([]))
})
