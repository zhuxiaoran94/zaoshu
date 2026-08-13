import type { DataRow } from '../types'

export type SortDirection='asc'|'desc'
export interface TableViewOptions { query?:string; onlyAbnormal?:boolean; sortKey?:string; sortDirection?:SortDirection }

const comparable=(value:unknown)=>{if(value===undefined||value===null)return null;if(typeof value==='number'||typeof value==='boolean')return value;if(typeof value==='string'){const time=/^\d{4}-\d{2}-\d{2}/.test(value)?Date.parse(value):Number.NaN;if(Number.isFinite(time))return time;return value.toLocaleLowerCase()}return JSON.stringify(value)}

export function applyTableView(rows:DataRow[],options:TableViewOptions={}){
  const query=options.query?.trim().toLocaleLowerCase(),filtered=rows.map((row,index)=>({row,index})).filter(({row})=>(!options.onlyAbnormal||!!row._mock_meta)&&(!query||JSON.stringify(row).toLocaleLowerCase().includes(query)))
  if(!options.sortKey)return filtered
  const direction=options.sortDirection==='desc'?-1:1,key=options.sortKey
  return filtered.sort((left,right)=>{const a=comparable(left.row[key]),b=comparable(right.row[key]);if(a===b)return left.index-right.index;if(a===null)return 1;if(b===null)return-1;return(a<b?-1:1)*direction})
}
