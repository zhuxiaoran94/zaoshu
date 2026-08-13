import { describe,expect,it } from 'vitest'
import { parseCliArgs } from './cli'

describe('Mock造数 CLI',()=>{
  it('解析模板、种子、模式、数量和格式',()=>{expect(parseCliArgs(['--template','users','--seed','42','--mode','boundary','--count','12','--format','csv','--json'])).toMatchObject({template:'users',seed:42,mode:'boundary',count:12,format:'csv',json:true})})
  it('拒绝未知参数、不安全整数和冲突输入',()=>{expect(()=>parseCliArgs(['--wat'])).toThrow(/未知参数/);expect(()=>parseCliArgs(['--count','0'])).toThrow(/1–100000/);expect(()=>parseCliArgs(['--config','a.mock.json','--template','users'])).toThrow(/不能同时/);expect(()=>parseCliArgs(['--dry-run','--output','x.zip'])).toThrow(/不能与/);expect(()=>parseCliArgs(['--dry-run','--summary','summary.json'])).toThrow(/不能与/)})
  it('默认使用电商完整包且不覆盖文件',()=>{expect(parseCliArgs([])).toMatchObject({template:'commerce',format:'bundle',force:false,dryRun:false,failOnQuality:false})})
})
