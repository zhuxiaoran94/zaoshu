import { describe,expect,it } from 'vitest'
import { applyTableView } from './tableView'

const rows=[{id:3,name:'北京',createdAt:'2026-08-03'},{id:1,name:'上海',createdAt:'2026-08-01',_mock_meta:{field:'name',rule:'x',mutation:'x',expected:'x'}},{id:2,name:'北京',createdAt:'2026-08-02'}]

describe('结果视图',()=>{
  it('搜索和异常过滤保留原始行号',()=>{expect(applyTableView(rows,{query:'北京'}).map(item=>item.index)).toEqual([0,2]);expect(applyTableView(rows,{onlyAbnormal:true}).map(item=>item.index)).toEqual([1])})
  it('按数字、日期和文本稳定排序且不修改原数组',()=>{expect(applyTableView(rows,{sortKey:'id',sortDirection:'asc'}).map(item=>item.row.id)).toEqual([1,2,3]);expect(applyTableView(rows,{sortKey:'createdAt',sortDirection:'desc'}).map(item=>item.row.id)).toEqual([3,2,1]);expect(rows.map(row=>row.id)).toEqual([3,1,2])})
})
