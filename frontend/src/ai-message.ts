import { marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';
import { languages } from '@codemirror/language-data';
import { highlightTree, classHighlighter } from '@lezer/highlight';

const escapeHTML=(text:string)=>text.replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]!));

export function renderAiMessage(host: HTMLElement, content: string) {
 host.classList.add('ai-markdown');
 const renderer=new Renderer();renderer.html=({text})=>escapeHTML(text);renderer.image=({text})=>escapeHTML(text);
 // No remote images or embedded content: rendering a model response must not fetch URLs.
 host.innerHTML=DOMPurify.sanitize(marked.parse(content,{async:false,gfm:true,renderer}),{ALLOWED_TAGS:['p','br','strong','em','del','s','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','a','table','thead','tbody','tr','th','td','hr','details','summary'],ALLOWED_ATTR:['href','title','class']});
 host.querySelectorAll<HTMLAnchorElement>('a').forEach(a=>{
  const href=a.getAttribute('href')??'';
  if(!/^https?:\/\//i.test(href))a.removeAttribute('href');
  else{a.target='_blank';a.rel='noopener noreferrer';}
 });
 host.querySelectorAll<HTMLElement>('pre code').forEach(code=>{
  const source=code.textContent??'';
  const button=document.createElement('button');button.className='ghost-button';button.textContent='复制代码';
  button.onclick=async()=>{try{await navigator.clipboard.writeText(source);button.textContent='已复制';}catch{button.textContent='复制不可用，请选中代码复制';}};
  code.parentElement!.before(button);
  const language=code.className.match(/language-([\w+-]+)/)?.[1]?.toLowerCase();
  const description=languages.find(l=>l.name.toLowerCase()===language||l.alias.includes(language??''));
  if(description&&source.length<=16000)void description.load().then(support=>{
   const fragment=document.createDocumentFragment();let position=0;
   highlightTree(support.language.parser.parse(source),classHighlighter,(from,to,classes)=>{
    fragment.append(document.createTextNode(source.slice(position,from)));const span=document.createElement('span');span.className=classes;span.textContent=source.slice(from,to);fragment.append(span);position=to;
   });fragment.append(document.createTextNode(source.slice(position)));code.replaceChildren(fragment);
  }).catch(()=>{});
 });
}
