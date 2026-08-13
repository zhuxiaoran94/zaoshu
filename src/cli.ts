#!/usr/bin/env node
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cloneTemplate, TEMPLATES } from './data/templates'
import { diagnoseProject } from './lib/diagnostics'
import { generateProject } from './lib/engine'
import { createExportPackage } from './lib/exporters'
import { MAX_CONFIG_BYTES, parseProjectFile, serializeProject } from './lib/projectConfig'
import { createSchemaContractPackage } from './lib/schemaExport'
import type { DataMode, ProjectSchema } from './types'
import { plannedProjectTotal } from './lib/cardinality'

const FORMATS=['schema','bundle','json','jsonl','csv','tsv','yaml','xml','xlsx','mysql','postgres','sqlite','postman','playwright','cypress','jest','pytest','junit','markdown'] as const
const MODES=['random','realistic','boundary','exception','pairwise'] as const
type CliFormat=typeof FORMATS[number]

export interface CliOptions {template:string;config?:string;seed?:number;mode?:DataMode;count?:number;format:CliFormat;output?:string;summary?:string;force:boolean;dryRun:boolean;failOnQuality:boolean;json:boolean;listTemplates:boolean;help:boolean}
interface DryRunSummary {ok:true;dryRun:true;project:string;template:string;seed:number;mode:DataMode;tables:number;plannedRows:number;diagnostics:{errors:number;warnings:number}}
interface GenerateSummary {ok:boolean;dryRun:false;project:string;template:string;seed:number;mode:DataMode;format:CliFormat;output:string;rows:number;normalRows:number;abnormalRows:number;durationMs:number;quality:{passed:number;expected:number;warnings:number;failed:number};coverage:unknown;manifest:unknown}

const needValue=(args:string[],index:number,flag:string)=>{const value=args[index+1];if(!value||value.startsWith('--'))throw new Error(`${flag} 需要一个值`);return value}
const integer=(value:string,flag:string,min:number,max:number)=>{if(!/^\d+$/.test(value))throw new Error(`${flag} 必须是整数`);const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${flag} 必须在 ${min}–${max} 之间`);return parsed}

export function parseCliArgs(args:string[]):CliOptions {
  const options:CliOptions={template:'commerce',format:'bundle',force:false,dryRun:false,failOnQuality:false,json:false,listTemplates:false,help:false}
  for(let index=0;index<args.length;index++){
    const flag=args[index]
    if(flag==='--template'){options.template=needValue(args,index,flag);index++}
    else if(flag==='--config'){options.config=needValue(args,index,flag);index++}
    else if(flag==='--seed'){options.seed=integer(needValue(args,index,flag),flag,0,2_147_483_647);index++}
    else if(flag==='--count'){options.count=integer(needValue(args,index,flag),flag,1,100_000);index++}
    else if(flag==='--mode'){const value=needValue(args,index,flag);if(!MODES.includes(value as DataMode))throw new Error(`--mode 仅支持 ${MODES.join(', ')}`);options.mode=value as DataMode;index++}
    else if(flag==='--format'){const value=needValue(args,index,flag);if(!FORMATS.includes(value as CliFormat))throw new Error(`--format 仅支持 ${FORMATS.join(', ')}`);options.format=value as CliFormat;index++}
    else if(flag==='--output'){options.output=needValue(args,index,flag);index++}
    else if(flag==='--summary'){options.summary=needValue(args,index,flag);index++}
    else if(flag==='--force')options.force=true
    else if(flag==='--dry-run')options.dryRun=true
    else if(flag==='--fail-on-quality')options.failOnQuality=true
    else if(flag==='--json')options.json=true
    else if(flag==='--list-templates')options.listTemplates=true
    else if(flag==='--help'||flag==='-h')options.help=true
    else throw new Error(`未知参数：${flag}`)
  }
  if(options.config&&args.includes('--template'))throw new Error('--config 与 --template 不能同时使用')
  if(options.dryRun&&(options.output||options.summary))throw new Error('--dry-run 不会写文件，不能与 --output 或 --summary 同时使用')
  return options
}

export const CLI_HELP=`Mock造数工具 CLI

用法：
  npm run mock -- --template commerce --seed 42 --format bundle
  npm run mock -- --config project.mock.json --output artifacts/mock.zip

参数：
  --template <id>       内置模板，默认 commerce
  --config <file>       读取网页导出的 .mock.json（与 --template 二选一）
  --seed <number>       覆盖随机种子
  --mode <mode>         random / realistic / boundary / exception / pairwise
  --count <number>      将每张表的数量设置为同一值
  --format <format>     默认 bundle；支持 ${FORMATS.join(', ')}
  --output <file>       输出 ZIP 路径；默认当前目录下的安全文件名
  --summary <file>      额外写入机器可读 JSON 摘要
  --fail-on-quality     存在非预期质量失败时以退出码 2 结束
  --dry-run             只校验配置与依赖，不生成或写文件
  --force               允许覆盖明确指定的输出/摘要文件
  --json                标准输出只打印 JSON 摘要
  --list-templates      列出内置模板
  --help, -h            显示帮助

安全默认值：不联网、不上传数据、不覆盖已有文件、不执行配置中的任何代码。`

async function ensureWritable(path:string,force:boolean){if(force)return;try{await access(path);throw new Error(`文件已存在，拒绝覆盖：${path}（如确认覆盖请加 --force）`)}catch(error){if(error instanceof Error&&'code' in error&&(error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}}
async function writeSafe(path:string,content:Uint8Array|string,force:boolean){const absolute=resolve(path);await ensureWritable(absolute,force);await mkdir(dirname(absolute),{recursive:true});await writeFile(absolute,content,{flag:force?'w':'wx'});return absolute}
const safeOutputName=(name:string,format:string)=>`${name.replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]/g,'_').slice(0,80)||'mock-data'}_${format}.zip`

async function loadProject(options:CliOptions):Promise<ProjectSchema>{let project:ProjectSchema;if(options.config){const path=resolve(options.config),info=await stat(path);if(!info.isFile())throw new Error(`配置路径不是普通文件：${path}`);if(info.size>MAX_CONFIG_BYTES)throw new Error('配置文件不能超过 1 MB');project=parseProjectFile(await readFile(path,'utf8'))}else{if(!TEMPLATES.some(item=>item.templateId===options.template))throw new Error(`未知模板：${options.template}；可用 --list-templates 查看`);project=cloneTemplate(options.template)}if(options.seed!==undefined)project.seed=options.seed;if(options.mode)project.mode=options.mode;const count=options.count;if(count!==undefined)project.tables.forEach(table=>{table.count=count;table.countByReference=undefined});return parseProjectFile(serializeProject(project))}

export async function runCli(options:CliOptions):Promise<DryRunSummary|GenerateSummary>{
  const project=await loadProject(options),diagnostics=diagnoseProject(project),blocking=diagnostics.filter(issue=>issue.level==='error')
  if(blocking.length)throw new Error(`生成前检查失败：${blocking.map(issue=>`${issue.title}：${issue.detail}`).join('；')}`)
  if(options.dryRun)return{ok:true,dryRun:true,project:project.name,template:project.templateId,seed:project.seed,mode:project.mode,tables:project.tables.length,plannedRows:plannedProjectTotal(project),diagnostics:{errors:0,warnings:diagnostics.filter(issue=>issue.level==='warning').length}}
  const outputPath=resolve(options.output??safeOutputName(project.name,options.format)),summaryPath=options.summary?resolve(options.summary):undefined;if(summaryPath===outputPath)throw new Error('--output 与 --summary 不能指向同一个文件');await ensureWritable(outputPath,options.force);if(summaryPath)await ensureWritable(summaryPath,options.force)
  if(options.format==='schema'){const pack=await createSchemaContractPackage(project),output=await writeSafe(outputPath,new Uint8Array(await pack.blob.arrayBuffer()),options.force),summary:GenerateSummary={ok:true,dryRun:false,project:project.name,template:project.templateId,seed:project.seed,mode:project.mode,format:options.format,output,rows:0,normalRows:0,abnormalRows:0,durationMs:0,quality:{passed:0,expected:0,warnings:diagnostics.filter(issue=>issue.level==='warning').length,failed:0},coverage:[],manifest:pack.manifest};if(summaryPath)await writeSafe(summaryPath,`${JSON.stringify(summary,null,2)}\n`,options.force);return summary}
  const result=generateProject(project),pack=await createExportPackage(options.format,project,result.data,result.report,project.tables[0].id),output=await writeSafe(outputPath,new Uint8Array(await pack.blob.arrayBuffer()),options.force),qualityFailures=result.report.checks.filter(check=>check.status==='fail')
  const summary:GenerateSummary={ok:qualityFailures.length===0,dryRun:false,project:project.name,template:project.templateId,seed:project.seed,mode:project.mode,format:options.format,output,rows:result.report.totalRows,normalRows:result.report.normalRows,abnormalRows:result.report.abnormalRows,durationMs:result.report.duration,quality:{passed:result.report.checks.filter(check=>check.status==='pass').length,expected:result.report.checks.filter(check=>check.status==='expected').length,warnings:result.report.checks.filter(check=>check.status==='warning').length,failed:qualityFailures.length},coverage:result.report.coverage,manifest:pack.manifest}
  if(summaryPath)await writeSafe(summaryPath,`${JSON.stringify(summary,null,2)}\n`,options.force)
  return summary
}

async function main(){
  try{const options=parseCliArgs(process.argv.slice(2));if(options.help){console.log(CLI_HELP);return}if(options.listTemplates){const templates=TEMPLATES.map(project=>({id:project.templateId,name:project.name,tables:project.tables.length,rows:plannedProjectTotal(project)}));console.log(options.json?JSON.stringify(templates):templates.map(item=>`${item.id.padEnd(12)} ${item.name} · ${item.tables} 表 · ${item.rows} 条`).join('\n'));return}const summary=await runCli(options);console.log(options.json?JSON.stringify(summary):summary.dryRun?`✓ 配置有效：${summary.project} · ${summary.tables} 表 · ${summary.plannedRows} 条 · seed ${summary.seed}`:summary.format==='schema'?`✓ 已导出 Schema 契约：${summary.output}`:`✓ 已生成 ${summary.rows} 条数据：${summary.output}`);if(!summary.dryRun&&options.failOnQuality&&!summary.ok)process.exitCode=2}catch(error){console.error(`Mock造数失败：${error instanceof Error?error.message:String(error)}`);process.exitCode=1}}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main()
