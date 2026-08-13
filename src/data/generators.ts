import { fakerZH_CN as faker } from '@faker-js/faker'
import type { FieldRule } from '../types'
import { ENUM_VALUES } from './enumValues'
export { GENERATORS } from './generatorCatalog'

const pick = <T>(items: T[], index?: number): T => items[(index ?? faker.number.int({ min: 0, max: items.length - 1 })) % items.length]
const pad = (n: number, width = 6) => String(n).padStart(width, '0')
const randomDigits = (len: number) => Array.from({ length: len }, () => faker.number.int({ min: 0, max: 9 })).join('')
const cnWords = ['质量','星河','智造','远航','敏捷','数智','云端','先锋','卓越','未来','协同','守护']
const DETERMINISTIC_EPOCH = 1755129600000
const isoDate = (d: Date, withTime = false) => withTime ? d.toISOString() : d.toISOString().slice(0,10)
const boundedNumber = (rule: FieldRule, defaultMin = 0, defaultMax = 100) => {
  const min = rule.min ?? defaultMin; const max = rule.max ?? defaultMax
  return rule.precision ? Number(faker.number.float({ min, max, fractionDigits: rule.precision }).toFixed(rule.precision)) : faker.number.int({ min, max })
}

export interface GenerateValueContext { mode?:'random'|'realistic'|'boundary'|'exception'|'pairwise'; totalRows?:number }
const weightedIndex=(length:number,weights?:number[])=>{if(!weights||weights.length!==length||!weights.some(weight=>weight>0))return faker.number.int({min:0,max:length-1});const total=weights.reduce((sum,weight)=>sum+Math.max(0,weight),0);let cursor=faker.number.float({min:0,max:total});for(let index=0;index<weights.length;index++){cursor-=Math.max(0,weights[index]);if(cursor<=0)return index}return length-1}
const relativeCenter=(center:number|undefined,min:number,max:number,fallback=.5)=>center===undefined?fallback:Math.max(0,Math.min(1,(center-min)/Math.max(max-min,1e-9)))
const distributedNumber=(rule:FieldRule,rowIndex:number,totalRows:number,defaultMin=0,defaultMax=100)=>{const min=rule.min??defaultMin,max=rule.max??defaultMax,range=max-min,distribution=rule.distribution||'uniform';let ratio:number
  if(distribution==='ascending')ratio=totalRows<=1?0:rowIndex/(totalRows-1)
  else if(distribution==='descending')ratio=totalRows<=1?1:1-rowIndex/(totalRows-1)
  else if(distribution==='normal'){const u1=Math.max(1e-9,faker.number.float({min:0,max:1})),u2=faker.number.float({min:0,max:1}),z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2),center=relativeCenter(rule.distributionCenter,min,max);ratio=Math.max(0,Math.min(1,center+z/6))}
  else if(distribution==='longTail')ratio=Math.pow(faker.number.float({min:0,max:1}),3)
  else if(distribution==='hotspot'){const center=relativeCenter(rule.distributionCenter,min,max,.2);ratio=faker.number.float({min:0,max:1})<.8?Math.max(0,Math.min(1,center+(faker.number.float({min:0,max:1})-.5)*.12)):faker.number.float({min:0,max:1})}
  else ratio=faker.number.float({min:0,max:1})
  const value=min+range*ratio,precision=rule.precision??(Number.isInteger(min)&&Number.isInteger(max)?0:2);return precision?Number(value.toFixed(precision)):Math.round(value)}

const distributedDate=(rule:FieldRule,rowIndex:number,totalRows:number,from:string,to:string)=>{
  const min=new Date(from).getTime(),max=new Date(to).getTime()
  return new Date(distributedNumber({...rule,min,max,precision:0},rowIndex,totalRows,min,max))
}

export function generateValue(rule: FieldRule, rowIndex: number, pools: Record<string,string[]> = {}, context:GenerateValueContext = {}): unknown {
  const g = rule.generator
  if (rule.fixedValue !== undefined && rule.fixedValue !== '') {if(rule.dataType==='object'){try{return JSON.parse(rule.fixedValue)}catch{return{}}}return rule.fixedValue}
  if (g === 'customEnum' && rule.values?.length) {const value=context.mode==='realistic'?(rule.values[weightedIndex(rule.values.length,rule.weights)]):pick(rule.values,rowIndex);if(rule.dataType==='number'){const number=Number(value);return Number.isFinite(number)?number:value}if(rule.dataType==='boolean'&&['true','false'].includes(value))return value==='true';return value}
  if (g === 'dataPool') {const values=pools[rule.fixedValue || ''] || ['未配置数据池'];return context.mode==='realistic'?values[weightedIndex(values.length,rule.weights)]:pick(values,rowIndex)}
  if (ENUM_VALUES[g]) {const values=ENUM_VALUES[g];if(context.mode==='realistic'&&(rule.weights?.length===values.length||rule.distribution==='hotspot'))return values[weightedIndex(values.length,rule.weights||[70,...Array(Math.max(0,values.length-1)).fill(30/Math.max(1,values.length-1))])];return pick(values,rowIndex)}
  if (['autoId','sequence'].includes(g)) return (rule.min ?? 1) + rowIndex * (rule.max ?? 1)
  if (g === 'uuid') return faker.string.uuid()
  if (g === 'ulid') return `${(DETERMINISTIC_EPOCH+rowIndex).toString(36).toUpperCase()}${faker.string.alphanumeric(16).toUpperCase()}`.slice(0,26)
  if (g === 'snowflake') return String(BigInt(DETERMINISTIC_EPOCH) * 100000n + BigInt(rowIndex + 1))
  if (['traceId','sessionId'].includes(g)) return faker.string.hexadecimal({ length: 32, prefix: '' }).toLowerCase()
  if (g === 'spanId') return faker.string.hexadecimal({ length: 16, prefix: '' }).toLowerCase()
  if (g === 'orderNo') return `ORD20250814${pad(rowIndex+1,8)}`
  if (g === 'transactionNo') return `TXN${DETERMINISTIC_EPOCH+rowIndex}${pad(rowIndex+1,5)}`
  if (g === 'accountNo') return `AC${randomDigits(14)}`
  if (['sku','productCode'].includes(g)) return `${g==='sku'?'SKU':'PRD'}-${faker.string.alpha({ length: 3, casing: 'upper' })}-${pad(rowIndex+1)}`
  if (g === 'chineseName') return faker.person.fullName()
  if (g === 'englishName') return `${faker.person.firstName()} ${faker.person.lastName()}`
  if (g === 'firstName') return faker.person.firstName()
  if (g === 'lastName') return faker.person.lastName()
  if (g === 'nickname') return `${pick(cnWords)}_${faker.string.alphanumeric(4)}`
  if (g === 'username') return faker.internet.username()
  if (g === 'age') return context.mode==='realistic'?distributedNumber(rule,rowIndex,context.totalRows??1,18,70):boundedNumber(rule,18,70)
  if (g === 'birthday') return isoDate(faker.date.birthdate({ min: 18, max: 70, mode:'age' }))
  if (g === 'phone') return `1${pick(['3','5','6','7','8','9'])}${randomDigits(9)}`
  if (g === 'telephone') return `0${faker.number.int({min:10,max:99})}-${randomDigits(8)}`
  if (g === 'email') return faker.internet.email().toLowerCase()
  if (['idCard','driverLicense'].includes(g)) return `11010119${randomDigits(10)}`
  if (g === 'passport') return `E${randomDigits(8)}`
  if (g === 'avatar') return `https://api.dicebear.com/9.x/initials/svg?seed=${rowIndex+1}`
  if (g === 'bio') return `${pick(cnWords)}领域从业者，关注产品体验与工程质量。`
  if (g === 'job') return pick(['测试开发工程师','产品经理','后端工程师','设计师','数据分析师'])
  if (g === 'company') return `${pick(cnWords)}科技有限公司`
  if (g === 'department') return pick(['研发中心','质量工程部','产品部','运营部','财务部'])
  if (g === 'position') return pick(['工程师','高级工程师','主管','经理','专家'])
  if (g === 'country') return pick(['中国','新加坡','日本','美国','英国'])
  if (g === 'province') return pick(['北京市','上海市','广东省','浙江省','四川省','湖北省'])
  if (g === 'city') return pick(['北京','上海','深圳','杭州','成都','武汉'])
  if (g === 'district') return pick(['朝阳区','浦东新区','南山区','余杭区','武侯区','洪山区'])
  if (g === 'address') return `${generateValue({...rule,generator:'province'},rowIndex)}${generateValue({...rule,generator:'city'},rowIndex)}${generateValue({...rule,generator:'district'},rowIndex)}未来路${faker.number.int({min:1,max:999})}号`
  if (g === 'postcode') return randomDigits(6)
  if (g === 'latitude') return boundedNumber({...rule,precision:6},-90,90)
  if (g === 'longitude') return boundedNumber({...rule,precision:6},-180,180)
  if (g === 'ipv4') return faker.internet.ipv4()
  if (g === 'ipv6') return faker.internet.ipv6()
  if (g === 'mac') return faker.internet.mac()
  if (g === 'url') return faker.internet.url()
  if (g === 'domain') return faker.internet.domainName()
  if (g === 'path') return `/${pick(['api','open','v1'])}/${pick(['users','orders','items'])}/${rowIndex+1}`
  if (g === 'query') return `page=${rowIndex+1}&size=20`
  if (g === 'userAgent') return faker.internet.userAgent()
  if (g === 'device') return pick(['iPhone 16','Pixel 9','MacBook Pro','Windows PC','iPad Air'])
  if (g === 'appVersion') return `${faker.number.int({min:1,max:9})}.${faker.number.int({min:0,max:9})}.${faker.number.int({min:0,max:20})}`
  if (g === 'gitCommit') return faker.string.hexadecimal({length:40,prefix:''}).toLowerCase()
  if (g === 'errorCode') return `E${faker.number.int({min:1000,max:9999})}`
  if (['integer','positiveInt'].includes(g)) return context.mode==='realistic'?distributedNumber(rule,rowIndex,context.totalRows??1,0,10000):boundedNumber(rule,0,10000)
  if (g === 'negativeInt') return context.mode==='realistic'?-distributedNumber(rule,rowIndex,context.totalRows??1,1,10000):-boundedNumber(rule,1,10000)
  if (g === 'float') return context.mode==='realistic'?distributedNumber({...rule,precision:rule.precision??2},rowIndex,context.totalRows??1,0,1000):boundedNumber({...rule,precision:rule.precision??2},0,1000)
  if (['amount','fee','exchangeRate'].includes(g)) return context.mode==='realistic'?distributedNumber({...rule,precision:rule.precision??2},rowIndex,context.totalRows??1,rule.min??0.01,rule.max??9999):boundedNumber({...rule,precision:rule.precision??2},rule.min??0.01,rule.max??9999)
  if (g === 'discount') return context.mode==='realistic'?distributedNumber({...rule,precision:2},rowIndex,context.totalRows??1,0,1):boundedNumber({...rule,precision:2},0,1)
  if (g === 'taxRate') {const values=ENUM_VALUES.taxRate as number[];return context.mode==='realistic'?values[weightedIndex(values.length,rule.weights)]:pick(values)}
  if (g === 'percentage') return context.mode==='realistic'?distributedNumber({...rule,precision:2},rowIndex,context.totalRows??1,0,100):boundedNumber({...rule,precision:2},0,100)
  if (g === 'probability') return context.mode==='realistic'?distributedNumber({...rule,precision:3},rowIndex,context.totalRows??1,0,1):boundedNumber({...rule,precision:3},0,1)
  if (g === 'rating') return context.mode==='realistic'?distributedNumber({...rule,precision:1},rowIndex,context.totalRows??1,1,5):boundedNumber({...rule,precision:1},1,5)
  if (g === 'bankCard') return `62${randomDigits(17)}`
  if (g === 'stockCode') return String(faker.number.int({min:1,max:999999})).padStart(6,'0')
  if (g === 'fundCode') return String(faker.number.int({min:1,max:999999})).padStart(6,'0')
  if (['date','pastDate','futureDate','workday','weekend','monthStart','monthEnd','dateTime'].includes(g)) {
    let d = context.mode==='realistic'
      ? distributedDate(rule,rowIndex,context.totalRows??1,g==='futureDate'?'2026-08-14':g==='pastDate'?'2023-01-01':'2023-01-01',g==='pastDate'?'2026-08-14':g==='futureDate'?'2029-12-31':'2027-12-31')
      : g==='futureDate' ? faker.date.future() : g==='pastDate' ? faker.date.past() : faker.date.between({from:'2023-01-01',to:'2027-12-31'})
    if(g==='workday') while([0,6].includes(d.getDay())) d.setDate(d.getDate()+1)
    if(g==='weekend') while(![0,6].includes(d.getDay())) d.setDate(d.getDate()+1)
    if(g==='monthStart') d.setDate(1)
    if(g==='monthEnd') d = new Date(d.getFullYear(),d.getMonth()+1,0)
    return isoDate(d,g==='dateTime')
  }
  if (g === 'time') return `${pad(faker.number.int({min:0,max:23}),2)}:${pad(faker.number.int({min:0,max:59}),2)}:${pad(faker.number.int({min:0,max:59}),2)}`
  if (g === 'timestamp') return faker.date.recent().getTime()
  if (g === 'quarter') return `${faker.number.int({min:2024,max:2027})}-Q${faker.number.int({min:1,max:4})}`
  if (g === 'fiscalYear') return `FY${faker.number.int({min:2024,max:2028})}`
  if (g === 'chineseWord') return pick(cnWords)
  if (['chineseSentence','newsTitle','articleTitle'].includes(g)) return `${pick(cnWords)}${pick(['平台','计划','报告','实践','观察'])}：${pick(['让数据更可信','构建稳定体验','洞察业务增长'])}`
  if (g === 'chineseParagraph') return `${pick(cnWords)}连接业务与技术。通过清晰的规则、稳定的数据和可追溯的过程，让每一次验证更有价值。`
  if (g === 'englishWord') return faker.word.noun()
  if (g === 'englishSentence') return faker.lorem.sentence()
  if (g === 'lorem') return faker.lorem.paragraph()
  if (g === 'productName') return `${pick(['轻云','极光','远山','青鸟'])}${pick(['智能手表','机械键盘','降噪耳机','旅行背包'])}`
  if (g === 'comment') return pick(['体验很好，符合预期。','功能完整，操作很顺手。','包装完好，物流速度快。','还有提升空间。'])
  if (g === 'logMessage') return `${pick(['INFO','WARN','ERROR'])} request completed in ${faker.number.int({min:8,max:800})}ms`
  if (g === 'randomString') return faker.string.alphanumeric(rule.length??12)
  if (g === 'numericString') return randomDigits(rule.length??10)
  if (g === 'alphaNumeric') return faker.string.alphanumeric(rule.length??16)
  if (g === 'emoji') return pick(['🚀','🧪','✅','🎮','📦','💡'])
  if (g === 'specialChars') return pick([`' OR 1=1 --`,'<script>alert(1)</script>','../../etc/passwd','测试\n换行','é'])
  if (g === 'productName') return `${pick(cnWords)}${pick(['耳机','手表','键盘','背包'])}`
  if (g === 'serverName' || g === 'itemName' || g === 'guildName') return pick(ENUM_VALUES[g] ?? [`${pick(cnWords)}公会`])
  if (g === 'playerLevel') return context.mode==='realistic'?distributedNumber(rule,rowIndex,context.totalRows??1,1,100):boundedNumber(rule,1,100)
  if (g === 'experience') return context.mode==='realistic'?distributedNumber(rule,rowIndex,context.totalRows??1,0,999999):boundedNumber(rule,0,999999)
  if (g === 'gold') return context.mode==='realistic'?distributedNumber(rule,rowIndex,context.totalRows??1,0,1000000):boundedNumber(rule,0,1000000)
  if (g === 'tag') return pick(['测试','技术','效率','分享','产品'])
  if (g === 'trackingNo') return `SF${randomDigits(13)}`
  if (g === 'packageWeight') return context.mode==='realistic'?distributedNumber({...rule,precision:2},rowIndex,context.totalRows??1,0.1,50):boundedNumber({...rule,precision:2},0.1,50)
  if (g === 'courierName') return faker.person.fullName()
  if (g === 'fileName') return `${pick(['report','avatar','contract','data'])}_${rowIndex+1}.${pick(['pdf','png','csv','json'])}`
  if (g === 'mimeType') return pick(['application/pdf','image/png','text/csv','application/json'])
  if (g === 'fileSize') return context.mode==='realistic'?distributedNumber(rule,rowIndex,context.totalRows??1,1024,104857600):boundedNumber(rule,1024,104857600)
  if (g === 'treePath') return `/总部/${pick(['研发','质量','产品'])}/${pick(['一组','二组','平台组'])}`
  if (g === 'template') return (rule.format || '{date}-{seq}').replace('{date}','20250814').replace('{seq}',pad(rowIndex+1))
  if (g === 'fixed') return rule.fixedValue ?? ''
  return faker.string.alphanumeric(rule.length??10)
}

export function reseed(seed: number) { faker.seed(seed) }
