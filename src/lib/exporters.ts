import type { DataRow, GeneratedData, GenerationReport, ProjectSchema } from '../types'

const safeName=(value:string)=>value.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g,'_')
const download=(blob:Blob,name:string)=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const rowsFor=(data:GeneratedData,tableId:string)=>data[tableId]||[]
const clean=(row:DataRow)=>Object.fromEntries(Object.entries(row).filter(([k])=>k!=='_mock_meta'))
export const neutralizeSpreadsheetFormula = (value:string) => /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
const csvCell=(v:unknown,delimiter=',')=>{const raw=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);const s=neutralizeSpreadsheetFormula(raw);return s.includes(delimiter)||/["\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s}
export function toCSV(rows:DataRow[],delimiter=','){if(!rows.length)return '';const keys=[...new Set(rows.flatMap(r=>Object.keys(clean(r))))];return [keys.join(delimiter),...rows.map(r=>keys.map(k=>csvCell(r[k],delimiter)).join(delimiter))].join('\n')}
const sqlValue=(v:unknown,dialect:string)=>{if(v==null)return'NULL';if(typeof v==='number')return String(v);if(typeof v==='boolean')return dialect==='postgres'?String(v):v?'1':'0';return `'${String(v).replaceAll("'","''")}'`}
export function toSQL(project:ProjectSchema,data:GeneratedData,dialect:'mysql'|'postgres'|'sqlite') {
  const quote=dialect==='mysql'?'`':'"'; const identifier=(value:string)=>`${quote}${value.replaceAll(quote,quote+quote)}${quote}`; const lines=[dialect==='mysql'?'SET FOREIGN_KEY_CHECKS=0;':'BEGIN;']
  for(const table of project.tables){const rows=rowsFor(data,table.id).map(clean);if(!rows.length)continue;const keys=Object.keys(rows[0]);lines.push(`DELETE FROM ${identifier(table.name)};`);for(let i=0;i<rows.length;i+=100){const batch=rows.slice(i,i+100);lines.push(`INSERT INTO ${identifier(table.name)} (${keys.map(identifier).join(', ')}) VALUES\n${batch.map(r=>`(${keys.map(k=>sqlValue(r[k],dialect)).join(', ')})`).join(',\n')};`)}}
  lines.push(dialect==='mysql'?'SET FOREIGN_KEY_CHECKS=1;':'COMMIT;');return lines.join('\n\n')
}
export async function exportData(format:string,project:ProjectSchema,data:GeneratedData,report:GenerationReport,activeTableId:string) {
  const base=safeName(project.name);const rows=rowsFor(data,activeTableId)
  if(format==='json') download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`${base}.json`)
  else if(format==='jsonl') download(new Blob([rows.map(r=>JSON.stringify(r)).join('\n')],{type:'application/x-ndjson'}),`${base}.jsonl`)
  else if(format==='csv'||format==='tsv') download(new Blob([toCSV(rows,format==='tsv'?'\t':',')],{type:'text/csv'}),`${base}.${format}`)
  else if(['mysql','postgres','sqlite'].includes(format)) download(new Blob([toSQL(project,data,format as never)],{type:'text/sql'}),`${base}_${format}.sql`)
  else if(format==='xlsx'){const XLSX=await import('xlsx');const wb=XLSX.utils.book_new();project.tables.forEach(t=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rowsFor(data,t.id).map(row=>Object.fromEntries(Object.entries(clean(row)).map(([key,value])=>[key,typeof value==='string'?neutralizeSpreadsheetFormula(value):value])))),t.name.slice(0,31)));XLSX.writeFile(wb,`${base}.xlsx`)}
  else if(format==='postman') download(new Blob([JSON.stringify(rows.map(clean),null,2)],{type:'application/json'}),`${base}_postman.json`)
  else if(format==='fixture') download(new Blob([`export const mockData = ${JSON.stringify(rows.map(clean),null,2)} as const;\n`],{type:'text/typescript'}),`${base}.fixture.ts`)
  else if(format==='markdown'){const md=`# ${project.name} 数据覆盖报告\n\n- Schema 版本：${project.version}\n- 随机种子：${project.seed}\n- 总数据量：${report.totalRows}\n- 正常数据：${report.normalRows}\n- 异常数据：${report.abnormalRows}\n- 生成耗时：${report.duration} ms\n\n## 覆盖情况\n\n${report.coverage.map(x=>`- ${x.label}：${x.value}%（${x.detail}）`).join('\n')}\n\n## 质量检查\n\n${report.checks.map(x=>`- [${x.status==='pass'?'x':' '}] ${x.label}：${x.detail}`).join('\n')}\n`;download(new Blob([md],{type:'text/markdown'}),`${base}_report.md`)}
}
