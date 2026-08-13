import { describe,expect,it } from 'vitest'
import type { ProjectSchema } from '../types'
import { validate } from './modeling'

const project:ProjectSchema={id:'p',name:'质量定位',templateId:'x',description:'',seed:1,mode:'random',version:'1',tables:[{id:'users',name:'users',label:'用户',count:3,fields:[{id:'id',name:'id',label:'ID',generator:'autoId',dataType:'number',primaryKey:true,unique:true},{id:'status',name:'status',label:'状态',generator:'customEnum',dataType:'string',values:['正常','冻结']},{id:'score',name:'score',label:'评分',generator:'integer',dataType:'number',min:0,max:100},{id:'code',name:'code',label:'编码',generator:'randomString',dataType:'string',length:4}]}]}

describe('数据质量定位',()=>{
  it('检查必填、类型、枚举、范围、长度和唯一性并返回真实行号',()=>{
    const checks=validate(project,{users:[{id:1,status:'正常',score:50,code:'A'},{id:1,status:'未知',score:101,code:'TOO-LONG'},{id:3,status:null,score:'wrong',code:'B'}]})
    expect(checks.find(check=>check.id==='unique-id')).toMatchObject({status:'fail',rowIndexes:[1],issueCount:1});expect(checks.find(check=>check.id==='enum-status')).toMatchObject({status:'fail',rowIndexes:[1]});expect(checks.find(check=>check.id==='required-status')).toMatchObject({status:'fail',rowIndexes:[2]});expect(checks.find(check=>check.id==='range-score')).toMatchObject({status:'fail',rowIndexes:[1]});expect(checks.find(check=>check.id==='type-score')).toMatchObject({status:'fail',rowIndexes:[2]});expect(checks.find(check=>check.id==='length-code')).toMatchObject({status:'fail',rowIndexes:[1]})
  })
})
