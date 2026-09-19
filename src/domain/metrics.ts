/** Unicode-code-point Levenshtein with bounded work. Null means unmeasured, not zero. */
export function editDistance(left:string,right:string,maxCells=4000000):number|null{
  if(left===right)return 0;let a=[...left],b=[...right];let prefix=0;
  while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
  a=a.slice(prefix);b=b.slice(prefix);while(a.length&&b.length&&a[a.length-1]===b[b.length-1]){a.pop();b.pop();}
  if(!a.length)return b.length;if(!b.length)return a.length;
  if(a.length*b.length>maxCells)return null;
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(row[j-1]!+1,previous[j]!+1,previous[j-1]!+(a[i-1]===b[j-1]?0:1));previous=row;}
  return previous[b.length]!;
}
export function postEditCost(generated:string,final:string):number|null{const distance=editDistance(generated,final);return distance===null?null:distance/Math.max([...final].length,1);}
export function percentile(values:number[],q:number):number|null{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(q*sorted.length)-1)]!;}
