import type { DataRow, FieldRule } from '../types'

type TokenType='number'|'string'|'identifier'|'operator'|'punctuation'|'eof'
interface Token { type:TokenType; value:string; position:number }
type FormulaNode={type:'literal';value:unknown}|{type:'identifier';name:string}|{type:'unary';operator:string;argument:FormulaNode}|{type:'binary';operator:string;left:FormulaNode;right:FormulaNode}|{type:'conditional';test:FormulaNode;consequent:FormulaNode;alternate:FormulaNode}|{type:'call';name:string;args:FormulaNode[]}

export class FormulaError extends Error { constructor(message:string,public position=0){super(`${message}（位置 ${position+1}）`);this.name='FormulaError'} }

const isIdentifierStart=(char:string)=>/[A-Za-z_]/.test(char)
const isIdentifierPart=(char:string)=>/[A-Za-z0-9_]/.test(char)

function tokenize(source:string):Token[]{
  const tokens:Token[]=[];let index=0
  while(index<source.length){const char=source[index];if(/\s/.test(char)){index++;continue}const position=index
    if(/\d/.test(char)||char==='.'&&/\d/.test(source[index+1]||'')){let raw='';while(index<source.length&&/[\d.]/.test(source[index]))raw+=source[index++];if(!/^\d+(?:\.\d+)?$|^\.\d+$/.test(raw))throw new FormulaError('数字格式无效',position);tokens.push({type:'number',value:raw,position});continue}
    if(char==='"'||char==="'"){const quote=char;let value='';index++;let closed=false;while(index<source.length){const current=source[index++];if(current===quote){closed=true;break}if(current==='\\'){const escaped=source[index++];if(escaped===undefined)break;value+=({n:'\n',r:'\r',t:'\t'} as Record<string,string>)[escaped]??escaped}else value+=current}if(!closed)throw new FormulaError('字符串没有闭合',position);tokens.push({type:'string',value,position});continue}
    if(isIdentifierStart(char)){let value='';while(index<source.length&&isIdentifierPart(source[index]))value+=source[index++];tokens.push({type:'identifier',value,position});continue}
    const pair=source.slice(index,index+2);if(['==','!=','>=','<=','&&','||'].includes(pair)){tokens.push({type:'operator',value:pair,position});index+=2;continue}
    if('+-*/%><!'.includes(char)){tokens.push({type:'operator',value:char,position});index++;continue}
    if('(),?:'.includes(char)){tokens.push({type:'punctuation',value:char,position});index++;continue}
    throw new FormulaError(`不支持字符 ${char}`,position)
  }
  tokens.push({type:'eof',value:'',position:source.length});return tokens
}

const precedence:Record<string,number>={'||':1,'&&':2,'==':3,'!=':3,'>':4,'>=':4,'<':4,'<=':4,'+':5,'-':5,'*':6,'/':6,'%':6}
const ALLOWED_FUNCTIONS=new Set(['round','min','max','length','concat','coalesce','if','upper','lower','dateAdd','dateDiff'])
class Parser{
  private index=0
  constructor(private tokens:Token[]){}
  private current(){return this.tokens[this.index]}
  private consume(value?:string){const token=this.current();if(value&&token.value!==value)throw new FormulaError(`期望 ${value}`,token.position);this.index++;return token}
  parse(){const node=this.expression();if(this.current().type!=='eof')throw new FormulaError(`无法识别 ${this.current().value}`,this.current().position);return node}
  private expression(min=0):FormulaNode{let left=this.unary();while(this.current().type==='operator'&&(precedence[this.current().value]??-1)>=min){const operator=this.consume().value,right=this.expression(precedence[operator]+1);left={type:'binary',operator,left,right}}if(min===0&&this.current().value==='?'){this.consume('?');const consequent=this.expression();this.consume(':');const alternate=this.expression();left={type:'conditional',test:left,consequent,alternate}}return left}
  private unary():FormulaNode{if(this.current().type==='operator'&&['-','+','!'].includes(this.current().value)){const operator=this.consume().value;return{type:'unary',operator,argument:this.unary()}}return this.primary()}
  private primary():FormulaNode{const token=this.current();if(token.type==='number'){this.consume();return{type:'literal',value:Number(token.value)}}if(token.type==='string'){this.consume();return{type:'literal',value:token.value}}if(token.type==='identifier'){this.consume();if(token.value==='true'||token.value==='false'||token.value==='null')return{type:'literal',value:token.value==='null'?null:token.value==='true'};if(this.current().value==='('){if(!ALLOWED_FUNCTIONS.has(token.value))throw new FormulaError(`不支持函数 ${token.value}`,token.position);this.consume('(');const args:FormulaNode[]=[];if(this.current().value!==')')while(true){args.push(this.expression());if(this.current().value!==',')break;this.consume(',')}this.consume(')');return{type:'call',name:token.value,args}}return{type:'identifier',name:token.value}}if(token.value==='('){this.consume('(');const node=this.expression();this.consume(')');return node}throw new FormulaError('此处需要数字、文本、字段或函数',token.position)}
}

export function parseFormula(source:string){if(!source.trim())throw new FormulaError('公式不能为空');if(source.length>500)throw new FormulaError('公式不能超过 500 个字符',500);return new Parser(tokenize(source)).parse()}

const number=(value:unknown)=>{const result=Number(value);if(!Number.isFinite(result))throw new FormulaError(`无法把 ${String(value)} 转成数字`);return result}
const date=(value:unknown)=>{const result=new Date(String(value));if(!Number.isFinite(result.getTime()))throw new FormulaError(`无效日期 ${String(value)}`);return result}
const unitMilliseconds:Record<string,number>={ms:1,second:1000,seconds:1000,minute:60_000,minutes:60_000,hour:3_600_000,hours:3_600_000,day:86_400_000,days:86_400_000,week:604_800_000,weeks:604_800_000}
const functions:Record<string,(args:unknown[])=>unknown>={
  round:args=>{const digits=Math.max(0,Math.min(12,Math.trunc(number(args[1]??0))));return Number(number(args[0]).toFixed(digits))},
  min:args=>Math.min(...args.map(number)),max:args=>Math.max(...args.map(number)),
  length:args=>typeof args[0]==='string'||Array.isArray(args[0])?args[0].length:args[0]&&typeof args[0]==='object'?Object.keys(args[0]).length:0,
  concat:args=>args.map(value=>value??'').join(''),coalesce:args=>args.find(value=>value!==null&&value!==undefined&&value!=='')??null,
  if:args=>args[0]?args[1]:args[2],upper:args=>String(args[0]??'').toUpperCase(),lower:args=>String(args[0]??'').toLowerCase(),
  dateAdd:args=>{const source=String(args[0]),result=new Date(date(args[0]).getTime()+number(args[1])*(unitMilliseconds[String(args[2]??'days')]??(()=>{throw new FormulaError(`不支持日期单位 ${String(args[2])}`)})()));return /^\d{4}-\d{2}-\d{2}$/.test(source)?result.toISOString().slice(0,10):result.toISOString()},
  dateDiff:args=>{const divisor=unitMilliseconds[String(args[2]??'days')];if(!divisor)throw new FormulaError(`不支持日期单位 ${String(args[2])}`);return Number(((date(args[0]).getTime()-date(args[1]).getTime())/divisor).toFixed(6))},
}

function evaluate(node:FormulaNode,row:DataRow):unknown{if(node.type==='literal')return node.value;if(node.type==='identifier')return row[node.name];if(node.type==='unary'){const value=evaluate(node.argument,row);return node.operator==='!'?!value:node.operator==='-'?-number(value):number(value)}if(node.type==='conditional')return evaluate(node.test,row)?evaluate(node.consequent,row):evaluate(node.alternate,row);if(node.type==='call'){if(node.name==='if'){if(node.args.length<3)throw new FormulaError('if 至少需要 3 个参数');return evaluate(node.args[0],row)?evaluate(node.args[1],row):evaluate(node.args[2],row)}const fn=functions[node.name];if(!fn)throw new FormulaError(`不支持函数 ${node.name}`);return fn(node.args.map(argument=>evaluate(argument,row)))}const left=evaluate(node.left,row);if(node.operator==='&&')return left&&evaluate(node.right,row);if(node.operator==='||')return left||evaluate(node.right,row);const right=evaluate(node.right,row);if(node.operator==='+')return typeof left==='number'&&typeof right==='number'?left+right:String(left??'')+String(right??'');if(node.operator==='-')return number(left)-number(right);if(node.operator==='*')return number(left)*number(right);if(node.operator==='/'){const divisor=number(right);if(divisor===0)throw new FormulaError('不能除以零');return number(left)/divisor}if(node.operator==='%'){const divisor=number(right);if(divisor===0)throw new FormulaError('不能除以零');return number(left)%divisor}if(node.operator==='==')return left===right;if(node.operator==='!=')return left!==right;if(node.operator==='>')return left!>right!;if(node.operator==='>=')return left!>=right!;if(node.operator==='<')return left!<right!;return left!<=right!}

export function compileFormula(source:string){const parsed=parseFormula(source);return(row:DataRow)=>evaluate(parsed,row)}
export function evaluateFormula(source:string,row:DataRow){return compileFormula(source)(row)}
export function formulaReferences(source:string){const refs=new Set<string>();const visit=(node:FormulaNode)=>{if(node.type==='identifier')refs.add(node.name);else if(node.type==='unary')visit(node.argument);else if(node.type==='binary'){visit(node.left);visit(node.right)}else if(node.type==='conditional'){visit(node.test);visit(node.consequent);visit(node.alternate)}else if(node.type==='call')node.args.forEach(visit)};visit(parseFormula(source));return[...refs]}
export function validateFormula(source:string,availableFields:string[]){const references=formulaReferences(source),missing=references.filter(reference=>!availableFields.includes(reference));return{references,missing}}

export function orderFormulaFields(fields:FieldRule[]){const formulas=fields.filter(field=>field.formula),byName=new Map(formulas.map(field=>[field.name,field])),visiting=new Set<string>(),visited=new Set<string>(),ordered:FieldRule[]=[];const visit=(field:FieldRule)=>{if(visiting.has(field.name))throw new FormulaError(`计算字段存在循环依赖：${[...visiting,field.name].join(' → ')}`);if(visited.has(field.name))return;visiting.add(field.name);formulaReferences(field.formula!).forEach(reference=>{const dependency=byName.get(reference);if(dependency)visit(dependency)});visiting.delete(field.name);visited.add(field.name);ordered.push(field)};formulas.forEach(visit);return ordered}
