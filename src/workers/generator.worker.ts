/// <reference lib="webworker" />
import { generateProject } from '../lib/engine'
import type { ProjectSchema } from '../types'

self.onmessage = (event:MessageEvent<{project:ProjectSchema;pools:Record<string,string[]>}>) => {
  try { self.postMessage({ok:true,result:generateProject(event.data.project,event.data.pools)}) }
  catch(error) { self.postMessage({ok:false,error:error instanceof Error?error.message:'生成失败'}) }
}
