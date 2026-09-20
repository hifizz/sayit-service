export interface EditSpan { before: string; after: string; start: number; end: number; finalStart: number; finalEnd: number }
function tokenize(text:string):string[] { return text.match(/[A-Za-z0-9_+#.@:/-]+|\s+|[^\s]/gu) ?? []; }
/** Bounded token LCS. Offsets are JS UTF-16 offsets, matching browser input ranges. */
export function changedSpans(before:string,after:string,maxTokens=1200):EditSpan[] | null {
  const a=tokenize(before), b=tokenize(after); const n=a.length,m=b.length;
  if (n>maxTokens || m>maxTokens) return null; // Abstain from learning instead of quadratic work on long input.
  const width=m+1, dp=new Uint16Array((n+1)*width);
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) dp[i*width+j]=a[i]===b[j] ? 1+dp[(i+1)*width+j+1]! : Math.max(dp[(i+1)*width+j]!,dp[i*width+j+1]!);
  const spans:EditSpan[]=[]; let i=0,j=0,x=0,y=0; let current:EditSpan | undefined;
  const flush=()=>{if(current){spans.push(current);current=undefined;}};
  while(i<n || j<m){
    if(i<n && j<m && a[i]===b[j]){flush();x+=a[i++]!.length;y+=b[j++]!.length;continue;}
    current ??= {before:'',after:'',start:x,end:x,finalStart:y,finalEnd:y};
    if(i<n && (j===m || dp[(i+1)*width+j]!>=dp[i*width+j+1]!)){ const s=a[i++]!;current.before+=s;x+=s.length;current.end=x; }
    else {const s=b[j++]!;current.after+=s;y+=s.length;current.finalEnd=y;}
  }
  flush(); return spans;
}
export function normalizedSpelling(text:string):string { return text.normalize('NFKC').toLowerCase().replace(/\s+/gu,''); }
export function riskyLexicalChange(before:string,after:string):boolean {
  const pair=before+' '+after;
  if(!before.trim() || !after.trim() || before.length>50 || after.length>50 || /[\n。！？!?，,;；]/u.test(pair)) return true;
  if(/https?:|www\.|@|(?:sk|key|token)[-_][A-Za-z0-9]{8,}|\d{5,}/i.test(pair)) return true;
  if(/^(?:[\d\s.,%+-]+|[零〇一二三四五六七八九十百千万亿两]+)$/u.test(before.trim()) || /^(?:[\d\s.,%+-]+|[零〇一二三四五六七八九十百千万亿两]+)$/u.test(after.trim())) return true;
  if(/(?:不要|不能|不应|也许|可能|必须|确定|未必|不是|需要确认)/u.test(pair) || /\b(?:not|never|maybe|might|must|definitely)\b/i.test(pair)) return true;
  const oldDigits=before.match(/\d+/g),newDigits=after.match(/\d+/g);
  return !!(oldDigits && newDigits && oldDigits.join(',')!==newDigits.join(','));
}
