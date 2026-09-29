/** A visible tooltip inside the plugin iframe; native title bubbles are unreliable in DBX. */
export function installTooltips() {
 const tip=document.createElement("div");tip.id="editor-control-tooltip";tip.className="control-tooltip";tip.role="tooltip";tip.hidden=true;document.body.append(tip);
 let active:HTMLElement|null=null;let originalTitle="";let originalDescription:string|null=null;
 function hide(){
  if(active){if(originalTitle && !active.title)active.title=originalTitle;if(originalDescription===null)active.removeAttribute("aria-describedby");else active.setAttribute("aria-describedby",originalDescription);}
  active=null;tip.hidden=true;
 }
 function show(target:EventTarget|null){
  const el=target instanceof Element?target.closest<HTMLElement>("button[title], button[data-tooltip], .icon-button[aria-label]"):null;
  if(el===active)return;hide();if(!el)return;
  const label=el.dataset.tooltip || el.title || el.getAttribute("aria-label");if(!label)return;
  active=el;originalTitle=el.title;originalDescription=el.getAttribute("aria-describedby");el.removeAttribute("title");el.setAttribute("aria-describedby",[originalDescription,tip.id].filter(Boolean).join(" "));
  tip.textContent=label;tip.hidden=false;
  const rect=el.getBoundingClientRect();const bounds=tip.getBoundingClientRect();
  tip.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-bounds.width-8))+"px";
  tip.style.top=(rect.bottom+bounds.height+10<=window.innerHeight?rect.bottom+6:Math.max(8,rect.top-bounds.height-6))+"px";
 }
 document.addEventListener("pointerover",e=>show(e.target));
 document.addEventListener("focusin",e=>show(e.target));
 document.addEventListener("pointerout",e=>{if(active && !active.contains(e.relatedTarget as Node|null))hide();});
 document.addEventListener("focusout",hide);
 document.addEventListener("pointerdown",hide);
 document.addEventListener("keydown",e=>{if(e.key==="Escape")hide();});
 document.addEventListener("scroll",hide,true);window.addEventListener("resize",hide);window.addEventListener("blur",hide);
 new MutationObserver(()=>{if(active&&!active.isConnected)hide();}).observe(document.querySelector(".app-shell")!,{childList:true,subtree:true});
}
