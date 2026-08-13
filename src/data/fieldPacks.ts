import type { FieldRule } from '../types'

export interface FieldPack {id:string;name:string;description:string;category:string;fields:Array<Omit<FieldRule,'id'>>}
export type FieldConflictStrategy='skip'|'rename'

const field=(name:string,label:string,generator:string,dataType:FieldRule['dataType']='string',extra:Omit<Partial<FieldRule>,'id'|'name'|'label'|'generator'|'dataType'>={}):Omit<FieldRule,'id'>=>({name,label,generator,dataType,...extra})

export const FIELD_PACKS:FieldPack[]=[
  {id:'identity',name:'用户身份',description:'姓名、账号、联系方式和状态',category:'业务',fields:[field('name','姓名','chineseName'),field('username','用户名','username'),field('phone','手机号','phone','string',{unique:true}),field('email','邮箱','email','string',{unique:true}),field('gender','性别','gender'),field('status','用户状态','userStatus')]},
  {id:'address',name:'中国地址',description:'行政区划、地址、邮编和坐标',category:'业务',fields:[field('country','国家','country'),field('province','省份','province'),field('city','城市','city'),field('district','区县','district'),field('address','详细地址','address'),field('postalCode','邮编','postcode'),field('latitude','纬度','latitude','number',{precision:6}),field('longitude','经度','longitude','number',{precision:6})]},
  {id:'organization',name:'组织员工',description:'员工号、公司、部门、岗位和职级',category:'业务',fields:[field('employeeNo','员工编号','template','string',{format:'EMP-{seq}',unique:true}),field('company','公司','company'),field('department','部门','department'),field('position','职位','position'),field('manager','直属主管','chineseName')]},
  {id:'money',name:'金额交易',description:'币种、金额、折扣、税费和流水号',category:'业务',fields:[field('transactionNo','交易流水号','transactionNo','string',{unique:true}),field('currency','币种','currency'),field('amount','金额','amount','number',{min:0,max:100000,precision:2}),field('discount','折扣','discount','number',{min:0,max:1,precision:2}),field('tax','税额','amount','number',{min:0,max:10000,precision:2}),field('fee','手续费','fee','number',{min:0,max:1000,precision:2})]},
  {id:'audit',name:'审计字段',description:'创建、更新人员与时间',category:'工程',fields:[field('createdBy','创建人','username'),field('createdAt','创建时间','pastDate','date'),field('updatedBy','更新人','username'),field('updatedAt','更新时间','dateTime','date',{formula:"dateAdd(createdAt, 1, 'day')"})]},
  {id:'trace',name:'接口追踪',description:'Trace、Span、会话、IP 与客户端',category:'工程',fields:[field('traceId','Trace ID','traceId','string',{unique:true}),field('spanId','Span ID','spanId'),field('sessionId','Session ID','sessionId'),field('ip','IP 地址','ipv4'),field('userAgent','User-Agent','userAgent'),field('appVersion','应用版本','appVersion')]},
  {id:'pagination',name:'分页响应',description:'页码、页大小、总量和游标',category:'工程',fields:[field('page','页码','positiveInt','number',{min:1,max:100}),field('pageSize','每页数量','customEnum','number',{values:['10','20','50','100']}),field('total','总数量','positiveInt','number',{min:0,max:100000}),field('hasNext','是否有下一页','boolean','boolean'),field('nextCursor','下一页游标','randomString','string',{nullable:35})]},
  {id:'file',name:'文件信息',description:'名称、类型、大小、地址与校验值',category:'工程',fields:[field('fileId','文件 ID','uuid','string',{unique:true}),field('fileName','文件名','fileName'),field('mimeType','文件类型','mimeType'),field('fileSize','文件大小','fileSize','number'),field('fileUrl','文件地址','url'),field('checksum','SHA 校验值','gitCommit')]},
  {id:'device',name:'设备环境',description:'设备、系统、浏览器、网络与版本',category:'工程',fields:[field('deviceId','设备 ID','uuid','string',{unique:true}),field('deviceModel','设备型号','device'),field('os','操作系统','os'),field('browser','浏览器','browser'),field('ip','IP 地址','ipv4'),field('locale','Locale','locale'),field('appVersion','应用版本','appVersion')]},
  {id:'softDelete',name:'软删除',description:'删除标记、时间和操作人',category:'工程',fields:[field('deleted','已删除','boolean','boolean'),field('deletedAt','删除时间','dateTime','date',{nullable:80}),field('deletedBy','删除人','username','string',{nullable:80})]},
]

const nextName=(base:string,used:Set<string>)=>{let index=2,name=`${base}_${index}`;while(used.has(name))name=`${base}_${++index}`;return name}

export function planFieldPack(existing:FieldRule[],packId:string,strategy:FieldConflictStrategy='skip'){
  const pack=FIELD_PACKS.find(candidate=>candidate.id===packId);if(!pack)throw new Error(`未知字段套餐：${packId}`)
  const used=new Set(existing.map(item=>item.name)),conflicts:string[]=[],skipped:string[]=[],renamed:Array<{from:string;to:string}>=[],fields:FieldRule[]=[]
  pack.fields.forEach((source,index)=>{let name=source.name;if(used.has(name)){conflicts.push(name);if(strategy==='skip'){skipped.push(name);return}const renamedName=nextName(name,used);renamed.push({from:name,to:renamedName});name=renamedName}used.add(name);fields.push({...structuredClone(source),id:`pack_${Date.now()}_${index}_${Math.random().toString(36).slice(2,7)}`,name,label:name===source.name?source.label:`${source.label}（副本）`})})
  return{pack,fields,conflicts,skipped,renamed}
}
