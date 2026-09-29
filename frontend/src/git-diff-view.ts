export interface DiffCell { text: string; number?: number; kind?: "added" | "deleted" | "hunk" }
export interface DiffRow { before: DiffCell; after: DiffCell }

// Convert unified hunks into aligned rows without treating filenames as HTML.
export function splitDiff(content: string): DiffRow[] {
 const rows: DiffRow[] = [];
 let oldLine = 1, newLine = 1, inHunk = false;
 let removed: DiffCell[] = [], added: DiffCell[] = [];
 const flush = () => {
  for (let i = 0; i < Math.max(removed.length, added.length); i++) rows.push({before: removed[i] ?? {text:""}, after: added[i] ?? {text:""}});
  removed = []; added = [];
 };
 const lines = content.split("\n");
 const newFile = content.startsWith("+++ ") && !content.includes("\n@@ ");
 for (const line of lines) {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (match) {
   flush(); oldLine = Number(match[1]); newLine = Number(match[2]); inHunk = true;
   rows.push({before:{text:line,kind:"hunk"},after:{text:line,kind:"hunk"}}); continue;
  }
  if (!inHunk && !newFile) continue;
  if (newFile && line.startsWith("+++ ")) continue;
  if (line.startsWith("-")) removed.push({text:line.slice(1),number:oldLine++,kind:"deleted"});
  else if (line.startsWith("+")) added.push({text:line.slice(1),number:newLine++,kind:"added"});
  else if (line.startsWith(" ")) {
   flush(); rows.push({before:{text:line.slice(1),number:oldLine++},after:{text:line.slice(1),number:newLine++}});
  }
 }
 flush(); return rows;
}

const diffCleanup = new WeakMap<HTMLElement, () => void>();

export function renderSplitDiff(host: HTMLElement, content: string, staged: boolean, zh: boolean) {
 diffCleanup.get(host)?.();
 const rows = splitDiff(content);
 const view = document.createElement("section"); view.className = "git-split";
 view.setAttribute("aria-label", zh ? "左右差异对比（只读）" : "Side-by-side diff (read only)");
 const panes: HTMLElement[] = [];
 for (const side of ["before", "after"] as const) {
  const column = document.createElement("section"); column.className = "git-split-column";
  const heading = document.createElement("header");
  heading.textContent = side === "before" ? (zh ? `修改前 · ${staged ? "HEAD" : "暂存区"}` : `Before · ${staged ? "HEAD" : "Index"}`) : (zh ? `修改后 · ${staged ? "暂存区" : "工作区"}` : `After · ${staged ? "Index" : "Working tree"}`);
  const pane = document.createElement("div"); pane.className = "git-split-scroll"; pane.tabIndex = 0;
  pane.setAttribute("aria-label", heading.textContent);
  const body = document.createElement("div"); body.className = "git-split-lines";
  if (!rows.length) { const message = document.createElement("pre"); message.className = "git-split-message"; message.textContent = content; body.append(message); }
  for (const row of rows) {
   const cell = row[side];
   const line = document.createElement("div"); line.className = `git-split-line ${cell.kind ? "git-split-" + cell.kind : cell.number === undefined ? "git-split-empty" : ""}`;
   const number = document.createElement("span"); number.className = "git-split-number"; number.textContent = cell.number?.toString() ?? ""; number.setAttribute("aria-hidden", "true");
   const code = document.createElement("span"); code.textContent = cell.text || " ";
   line.append(number,code); body.append(line);
  }
  pane.append(body); column.append(heading,pane); view.append(column); panes.push(pane);
 }
 // Give both columns the same horizontal extent, even when only one side has long lines.
 const bodies=panes.map(pane=>pane.firstElementChild as HTMLElement);
 let syncing=false;
 for (const [index,pane] of panes.entries()) pane.addEventListener("scroll", () => {
  if(syncing)return;
  const other=panes[1-index];syncing=true;
  if(other.scrollTop!==pane.scrollTop)other.scrollTop=pane.scrollTop;
  if(other.scrollLeft!==pane.scrollLeft)other.scrollLeft=pane.scrollLeft;
  syncing=false;
 }, {passive:true});
 const hint = document.createElement("div"); hint.className = "git-split-hint";
 hint.textContent = zh ? "只读 · 横纵滚动同步 · 仅显示修改及附近上下文 · 点击文件刷新" : "Read only · Synchronized scrolling · Changes and context · Click file to refresh";
 host.replaceChildren(hint,view);
 const alignWidths=()=>{
  const left=panes[0].scrollLeft;
  bodies.forEach(body=>{body.style.width="max-content";});
  const width=Math.max(...bodies.map(body=>body.scrollWidth),...panes.map(pane=>pane.clientWidth));
  bodies.forEach(body=>{body.style.width=width+"px";});
  panes.forEach(pane=>{pane.scrollLeft=left;});
 };
 alignWidths();
 const resize=new ResizeObserver(alignWidths);resize.observe(view);
 diffCleanup.set(host,()=>resize.disconnect());
}
