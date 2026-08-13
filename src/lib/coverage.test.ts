import { describe, expect, it } from 'vitest'
import type { ProjectSchema } from '../types'
import { analyzeCoverage } from './coverage'
import { generateProject, supplementCoverageGaps } from './engine'
import { validate } from './modeling'

const project=():ProjectSchema=>({
  id:'coverage_project',name:'覆盖补数测试',templateId:'custom',description:'',seed:42,mode:'random',version:'1.0',
  tables:[{id:'users',name:'users',label:'用户',count:1,fields:[
    {id:'id',name:'id',label:'ID',generator:'autoId',dataType:'number',primaryKey:true,unique:true,min:1},
    {id:'status',name:'status',label:'状态',generator:'customEnum',dataType:'string',values:['正常','冻结','注销']},
    {id:'score',name:'score',label:'评分',generator:'integer',dataType:'number',min:0,max:100},
    {id:'note',name:'note',label:'备注',generator:'randomString',dataType:'string',nullable:5,missing:5},
  ]}],
})

describe('覆盖缺口分析与补数',()=>{
  it('精确列出枚举、空值、缺失和数值边界缺口',()=>{
    const schema=project(),result=generateProject(schema),kinds=new Set(analyzeCoverage(schema,result.data).gaps.map(gap=>gap.kind))
    expect(kinds).toEqual(new Set(['enum','null','missing','boundary']))
  })

  it('使用最少追加记录补齐全部缺口，并保持质量检查通过',()=>{
    const schema=project(),result=generateProject(schema),supplemented=supplementCoverageGaps(schema,result.data)
    expect(supplemented.added).toBe(2)
    expect(analyzeCoverage(supplemented.project,supplemented.data).gaps).toEqual([])
    expect(new Set(supplemented.data.users.map(row=>row.id)).size).toBe(supplemented.data.users.length)
    expect(validate(supplemented.project,supplemented.data).every(check=>check.status==='pass')).toBe(true)
  })
})
