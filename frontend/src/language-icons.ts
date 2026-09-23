type Badge = { token: string; category: string };

const known: Record<string, Badge> = {
  auto: { token: "✦", category: "automatic" },
  plain: { token: "TXT", category: "plain" },
  javascript: { token: "JS", category: "javascript" },
  jsx: { token: "JSX", category: "javascript" },
  typescript: { token: "TS", category: "typescript" },
  tsx: { token: "TSX", category: "typescript" },
  python: { token: "Py", category: "python" },
  go: { token: "GO", category: "go" },
  rust: { token: "⚙", category: "rust" },
  java: { token: "☕", category: "java" },
  c: { token: "C", category: "c" },
  "c++": { token: "C+", category: "cpp" },
  "c#": { token: "C#", category: "csharp" },
  css: { token: "3", category: "css" },
  scss: { token: "S", category: "scss" },
  sass: { token: "S", category: "scss" },
  less: { token: "L", category: "css" },
  html: { token: "5", category: "html" },
  xml: { token: "<>", category: "xml" },
  json: { token: "{}", category: "json" },
  "json-ld": { token: "{}", category: "json" },
  yaml: { token: "Y", category: "yaml" },
  toml: { token: "T", category: "toml" },
  markdown: { token: "M↓", category: "markdown" },
  sql: { token: "DB", category: "sql" },
  "mariadb sql": { token: "DB", category: "sql" },
  "ms sql": { token: "DB", category: "sql" },
  mysql: { token: "DB", category: "sql" },
  plsql: { token: "DB", category: "sql" },
  postgresql: { token: "DB", category: "sql" },
  sqlite: { token: "DB", category: "sql" },
  shell: { token: ">_", category: "shell" },
  powershell: { token: ">_", category: "powershell" },
  dockerfile: { token: "▤", category: "docker" },
  diff: { token: "±", category: "diff" },
  dart: { token: "D", category: "dart" },
  d: { token: "D", category: "d" },
  php: { token: "PHP", category: "php" },
  ruby: { token: "◆", category: "ruby" },
  swift: { token: "S", category: "swift" },
  kotlin: { token: "K", category: "kotlin" },
  vue: { token: "V", category: "vue" },
  "angular template": { token: "A", category: "angular" },
  elm: { token: "◆", category: "elm" },
  erlang: { token: "E", category: "erlang" },
  edn: { token: "{}", category: "json" },
  eiffel: { token: "Ei", category: "eiffel" },
  dtd: { token: "<>", category: "xml" },
  ebnf: { token: "BNF", category: "grammar" },
  webassembly: { token: "W", category: "wasm" },
  clojure: { token: "Cl", category: "clojure" },
  clojurescript: { token: "Cl", category: "clojure" },
  lua: { token: "Lua", category: "lua" },
  r: { token: "R", category: "r" },
  fortran: { token: "F", category: "fortran" }
};

export function languageBadge(name: string): Badge {
  const key = name.toLowerCase();
  const matched = known[key];
  if (matched) return { token: matched.token, category: `language-icon language-${matched.category}` };
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const token = words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() : (words[0] ?? "?").slice(0, 2).toUpperCase();
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return { token, category: `language-icon language-generic language-tone-${hash % 6}` };
}
