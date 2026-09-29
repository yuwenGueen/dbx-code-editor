// Bounded line comparison: preserve equal context without allocating an unbounded matrix.
export function proposalDiff(before: string, after: string): string {
 if (before === after) return '内容没有变化。';
 const lines = (text: string) => text ? text.replace(/\n$/, '').split('\n') : [];
 const a = lines(before), b = lines(after);
 if(a.length===b.length&&a.every((line,i)=>line===b[i]))return `@@ -${a.length},1 +${b.length},1 @@\n-${a.at(-1)??''}\n+${b.at(-1)??''}\n\\ 文件末尾换行发生变化`;
 let start = 0, end = 0;
 while (start < a.length && start < b.length && a[start] === b[start]) start++;
 while (end < a.length-start && end < b.length-start && a[a.length-1-end] === b[b.length-1-end]) end++;
 const left=a.slice(start,a.length-end), right=b.slice(start,b.length-end), edits:string[]=[];
 if(left.length*right.length<=500000){
  const width=right.length+1, table=new Uint32Array((left.length+1)*width);
  for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)table[i*width+j]=left[i]===right[j]?1+table[(i+1)*width+j+1]:Math.max(table[(i+1)*width+j],table[i*width+j+1]);
  let i=0,j=0;
  while(i<left.length||j<right.length){
   if(i<left.length&&j<right.length&&left[i]===right[j]){edits.push(' '+left[i++]);j++;}
   else if(i<left.length&&(j===right.length||table[(i+1)*width+j]>=table[i*width+j+1]))edits.push('-'+left[i++]);
   else edits.push('+'+right[j++]);
  }
 }else{edits.push(...left.map(l=>'-'+l),...right.map(l=>'+'+l));}
 const from=Math.max(0,start-3), tail=Math.min(end,3);
 return [`@@ -${from+1},${start-from+left.length+tail} +${from+1},${start-from+right.length+tail} @@`,...a.slice(from,start).map(l=>' '+l),...edits,...a.slice(a.length-end,a.length-end+tail).map(l=>' '+l), ...(before.endsWith('\n')===after.endsWith('\n')?[]:['\\ 文件末尾换行发生变化'])].join('\n');
}
