import { describe,expect,it } from 'vitest'
import { evaluateFormula,formulaReferences,orderFormulaFields,parseFormula,validateFormula } from './formula'

describe('安全公式引擎',()=>{
  const row={price:19.9,quantity:3,discount:2,status:'SUCCESS',name:'商品',createdAt:'2026-08-14',tags:['A','B'],empty:null}
  it('支持算术优先级、括号、精度和最值',()=>{expect(evaluateFormula('round(price * quantity - discount, 2)',row)).toBe(57.7);expect(evaluateFormula('(quantity + 2) * 3',row)).toBe(15);expect(evaluateFormula('max(price, 20)',row)).toBe(20)})
  it('支持条件、比较、拼接、大小写、长度和空值兜底',()=>{expect(evaluateFormula(`status == 'SUCCESS' ? concat(name, '-', quantity) : '失败'`,row)).toBe('商品-3');expect(evaluateFormula(`if(quantity >= 3 && status == 'SUCCESS', upper(name), 'NO')`,row)).toBe('商品');expect(evaluateFormula('if(false, price / 0, 1)',row)).toBe(1);expect(evaluateFormula('length(tags)',row)).toBe(2);expect(evaluateFormula(`coalesce(empty, '', '默认')`,row)).toBe('默认')})
  it('支持日期加减',()=>{expect(evaluateFormula(`dateAdd(createdAt, 30, 'days')`,row)).toBe('2026-09-13');expect(evaluateFormula(`dateDiff('2026-08-20', createdAt, 'days')`,row)).toBe(6)})
  it('提取字段引用并报告缺失字段',()=>{expect(formulaReferences(`round(price * quantity, 2)`)).toEqual(['price','quantity']);expect(validateFormula('price + missing',['price']).missing).toEqual(['missing'])})
  it('拒绝属性访问、未知函数、非法字符、除零和不闭合输入',()=>{expect(()=>parseFormula('user.password')).toThrow(/不支持字符/);expect(()=>evaluateFormula('eval(price)',row)).toThrow(/不支持函数/);expect(()=>parseFormula('price; alert(1)')).toThrow(/不支持字符/);expect(()=>evaluateFormula('price / 0',row)).toThrow(/除以零/);expect(()=>parseFormula("'broken")).toThrow(/没有闭合/)})
  it('按计算字段依赖排序并拒绝循环',()=>{const a={id:'a',name:'a',label:'A',generator:'integer',dataType:'number' as const,formula:'b + 1'},b={id:'b',name:'b',label:'B',generator:'integer',dataType:'number' as const,formula:'price + 1'},price={id:'p',name:'price',label:'价格',generator:'integer',dataType:'number' as const};expect(orderFormulaFields([a,b,price]).map(field=>field.name)).toEqual(['b','a']);b.formula='a + 1';expect(()=>orderFormulaFields([a,b,price])).toThrow(/循环依赖/)})
})
