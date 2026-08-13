import { describe,expect,it } from 'vitest'
import { parseCliArgs, runCli } from './cli'

describe('Mock造数 CLI',()=>{
  it('解析模板、种子、时间基准、模式、数量和格式',()=>{expect(parseCliArgs(['--template','users','--seed','42','--reference-date','2030-01-02','--mode','boundary','--count','12','--format','csv','--json'])).toMatchObject({template:'users',seed:42,referenceDate:'2030-01-02T00:00:00.000Z',mode:'boundary',count:12,format:'csv',json:true})})
  it('拒绝未知参数、不安全整数、无效日期和冲突输入',()=>{expect(()=>parseCliArgs(['--wat'])).toThrow(/未知参数/);expect(()=>parseCliArgs(['--count','0'])).toThrow(/1–100000/);expect(()=>parseCliArgs(['--reference-date','not-a-date'])).toThrow(/有效 ISO 日期/);expect(()=>parseCliArgs(['--config','a.mock.json','--template','users'])).toThrow(/不能同时/);expect(()=>parseCliArgs(['--dry-run','--output','x.zip'])).toThrow(/不能与/);expect(()=>parseCliArgs(['--dry-run','--summary','summary.json'])).toThrow(/不能与/)})
  it('默认使用电商完整包且不覆盖文件',()=>{expect(parseCliArgs([])).toMatchObject({template:'commerce',format:'bundle',force:false,dryRun:false,failOnQuality:false})})
  it('支持无需生成数据的 Schema 契约格式',()=>expect(parseCliArgs(['--format','schema','--config','project.mock.json'])).toMatchObject({format:'schema',config:'project.mock.json'}))
  it('支持可直接接入项目的 Mock API 交付格式',()=>expect(parseCliArgs(['--format','mock-api','--template','commerce'])).toMatchObject({format:'mock-api',template:'commerce'}))
  it('解析 Mock API 网络场景并拒绝格式误用',()=>{expect(parseCliArgs(['--format','mock-api','--mock-api-latency','120:480','--mock-api-failure-rate','15','--mock-api-failure-status','429','--mock-api-envelope','data-meta']).mockApi).toEqual({latencyMinMs:120,latencyMaxMs:480,failureRate:15,failureStatus:429,envelope:'data-meta'});expect(()=>parseCliArgs(['--format','csv','--mock-api-failure-rate','10'])).toThrow(/只能与/);expect(()=>parseCliArgs(['--format','mock-api','--mock-api-latency','500:100'])).toThrow(/不能小于/);expect(()=>parseCliArgs(['--format','mock-api','--mock-api-envelope','wat'])).toThrow(/仅支持/)})
  it('dry-run 使用动态基数计划量，count 覆盖会切回固定数量',async()=>{
    const dynamic=await runCli({...parseCliArgs(['--template','commerce','--dry-run']),dryRun:true}),fixed=await runCli({...parseCliArgs(['--template','commerce','--count','2','--dry-run']),dryRun:true})
    expect(dynamic).toMatchObject({dryRun:true,plannedRows:239});expect(fixed).toMatchObject({dryRun:true,plannedRows:10})
  })
})
