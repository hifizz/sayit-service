/** Server-only transport. Resolve userId from ThreadChat's authenticated session, never a browser body. */
export interface SayItResult {id:string;text:string;raw_transcript:string;output_sha256:string;meta:{guard_status:string;[key:string]:unknown}}
export function createSayItClient(baseUrl:string,serviceToken:string){
  const base=baseUrl.replace(/\/$/,'');
  const headers=(authenticatedUserId:string)=>({Authorization:'Bearer '+serviceToken,'X-Sayit-User-Id':authenticatedUserId});
  return {
    async dictate(authenticatedUserId:string,file:Blob,filename:string,recordingId:string,projectId?:string):Promise<SayItResult>{
      const form=new FormData();form.append('context',JSON.stringify({type:'ai_prompt',app:'threadchat',projectId}));form.append('file',file,filename);
      const response=await fetch(base+'/v1/dictations',{method:'POST',headers:{...headers(authenticatedUserId),'Idempotency-Key':recordingId},body:form,signal:AbortSignal.timeout(125000)});
      if(!response.ok)throw new Error('SayIt request failed: '+response.status);return await response.json() as SayItResult;
    },
    async feedback(authenticatedUserId:string,result:SayItResult,eventId:string,finalSpanText:string,attributed:boolean):Promise<void>{
      const response=await fetch(base+'/v1/dictations/'+result.id+'/feedback',{method:'POST',headers:{...headers(authenticatedUserId),'Content-Type':'application/json'},body:JSON.stringify({event_id:eventId,output_sha256:result.output_sha256,final_text:finalSpanText,attribution:attributed?'dictation_span':'whole_message'}),signal:AbortSignal.timeout(125000)});
      if(!response.ok)throw new Error('SayIt feedback failed: '+response.status);
    }
  };
}
