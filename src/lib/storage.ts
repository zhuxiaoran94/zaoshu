import { get, set, del } from 'idb-keyval'
import type { DataPool, ProjectSchema } from '../types'
const PROJECT='mock-tool-project';const POOLS='mock-tool-pools'
export const storage={
  loadProject:()=>get<ProjectSchema>(PROJECT), saveProject:(p:ProjectSchema)=>set(PROJECT,p), clearProject:()=>del(PROJECT),
  loadPools:async()=>await get<DataPool[]>(POOLS)??[], savePools:(p:DataPool[])=>set(POOLS,p), clearAll:async()=>{await del(PROJECT);await del(POOLS)},
}
