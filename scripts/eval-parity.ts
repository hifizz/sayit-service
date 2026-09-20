import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { z } from 'zod';
const {values}=parseArgs({options:{left:{type:'string'},right:{type:'string'},out:{type:'string',default:'reports/parity'},seed:{type:'string',default:'sayit-parity-v1'},votes:{type:'string'}}});
if(!values.left||!values.right)throw new Error('Required: --left SayIt-report.json --right Typeless-export.json');
const row=z.object({id:z.string(),input_sha256:z.string().regex(/^[a-f0-9]{64}$/),output_text:z.string()});
const parse=async(path:string)=>z.object({rows:z.array(row)}).parse(JSON.parse(await readFile(path,'utf8'))).rows;
const left=await parse(values.left),right=await parse(values.right),rightMap=new Map(right.map(r=>[r.id,r]));
if(new Set(left.map(r=>r.id)).size!==left.length||rightMap.size!==right.length||left.length!==right.length)throw new Error('Both sides require the same unique case IDs');
const mapping:Record<string,{A:'left'|'right';B:'left'|'right'}>={};
const blind=left.map(l=>{const r=rightMap.get(l.id);if(!r||r.input_sha256!==l.input_sha256)throw new Error('Mismatched input SHA256: '+l.id);const flip=(createHash('sha256').update(values.seed!+l.id).digest()[0]!&1)===1;mapping[l.id]=flip?{A:'right',B:'left'}:{A:'left',B:'right'};return {id:l.id,input_sha256:l.input_sha256,A:flip?r.output_text:l.output_text,B:flip?l.output_text:r.output_text};});
await mkdir(values.out!,{recursive:true});await writeFile(resolve(values.out!,'blind.json'),JSON.stringify(blind,null,2));await writeFile(resolve(values.out!,'answer-key.private.json'),JSON.stringify(mapping,null,2));
await writeFile(resolve(values.out!,'ballots.example.jsonl'),blind.map(r=>JSON.stringify({id:r.id,choice:'tie',semantic_issue_A:false,semantic_issue_B:false,notes:'Replace with a human judgment after listening to the original audio.'})).join('\n')+'\n');
if(values.votes){
  const ballot=z.object({id:z.string(),choice:z.enum(['A','B','tie']),semantic_issue_A:z.boolean(),semantic_issue_B:z.boolean(),notes:z.string().optional()});
  const votes=(await readFile(values.votes,'utf8')).split(/\r?\n/).filter(Boolean).map(l=>ballot.parse(JSON.parse(l)));
  if(new Set(votes.map(v=>v.id)).size!==votes.length||votes.some(v=>!mapping[v.id]))throw new Error('Invalid/duplicate ballot IDs');
  let wins=0,losses=0,ties=0,leftIssues=0,rightIssues=0;
  for(const v of votes){const m=mapping[v.id]!;if(v.choice==='tie')ties++;else if(m[v.choice]==='left')wins++;else losses++;
    if(v.semantic_issue_A){if(m.A==='left')leftIssues++;else rightIssues++;}if(v.semantic_issue_B){if(m.B==='left')leftIssues++;else rightIssues++;}}
  const n=wins+losses,p=n?wins/n:0,z95=1.96,denom=1+z95*z95/Math.max(n,1),center=(p+z95*z95/(2*Math.max(n,1)))/denom,delta=z95*Math.sqrt((p*(1-p)+z95*z95/(4*Math.max(n,1)))/Math.max(n,1))/denom;
  const summary={evaluated_cases:votes.length,total_cases:left.length,unrated_cases:left.length-votes.length,left_wins:wins,right_wins:losses,ties,left_decisive_win_rate:n?p:null,left_decisive_win_rate_wilson_95:n?[center-delta,center+delta]:null,left_human_semantic_issue_rate:votes.length?leftIssues/votes.length:null,right_human_semantic_issue_rate:votes.length?rightIssues/votes.length:null,limitations:'Human judgments on this dataset only; ties excluded from decisive win rate; one ballot per case. This is not a guarantee of product-wide parity.'};
  await writeFile(resolve(values.out!,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}else console.log('Blind bundle written. No quality score exists until genuine human ballots are supplied. Keep answer-key.private.json away from reviewers.');
