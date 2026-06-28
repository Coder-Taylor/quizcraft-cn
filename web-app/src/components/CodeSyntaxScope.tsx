import { useEffect, useRef, type ReactNode } from "react";

type CodeLanguage = "java" | "html" | "css" | "javascript" | "json" | "text";
type TextSegment = { kind: "text"; value: string };
type CodeSegment = { kind: "code"; value: string; language: CodeLanguage; block: boolean };
type RichSegment = TextSegment | CodeSegment;
type TokenKind = "text" | "comment" | "string";

type Token = {
  kind: TokenKind;
  value: string;
};

const LANGUAGE_ALIASES: Record<string, CodeLanguage> = {
  htm: "html",
  html: "html",
  markup: "html",
  xml: "html",
  web: "html",
  css: "css",
  java: "java",
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  ts: "javascript",
  tsx: "javascript",
  typescript: "javascript",
  json: "json",
  text: "text",
  plaintext: "text",
  plain: "text",
};

const KEYWORDS: Record<CodeLanguage, string[]> = {
  java: [
    "abstract",
    "assert",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extends",
    "final",
    "finally",
    "float",
    "for",
    "if",
    "implements",
    "import",
    "instanceof",
    "int",
    "interface",
    "long",
    "new",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "strictfp",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "try",
    "void",
    "volatile",
    "while",
    "true",
    "false",
    "null",
  ],
  javascript: [
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "let",
    "new",
    "null",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "undefined",
    "var",
    "void",
    "while",
    "yield",
  ],
  css: [
    "align-items",
    "background",
    "border",
    "box-sizing",
    "color",
    "display",
    "flex",
    "font-size",
    "font-weight",
    "gap",
    "grid",
    "height",
    "justify-content",
    "line-height",
    "margin",
    "padding",
    "position",
    "text-align",
    "width",
  ],
  html: [],
  json: ["true", "false", "null"],
  text: [],
};

const CODE_FENCE_PATTERN = /```([A-Za-z0-9_-]+)?[ \t]*\r?\n?([\s\S]*?)```/g;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLanguage(language: string | undefined, code = ""): CodeLanguage {
  const normalized = language?.trim().toLowerCase();

  if (normalized && LANGUAGE_ALIASES[normalized]) {
    return LANGUAGE_ALIASES[normalized];
  }

  if (/\b(public|private|protected|class|static|void|String|int|boolean|System\.out)\b/.test(code)) {
    return "java";
  }

  if (/<\/?[A-Za-z][\w:-]*(\s|>|\/)/.test(code)) {
    return "html";
  }

  if (/\b(const|let|var|function|document|console)\b|=>/.test(code)) {
    return "javascript";
  }

  if (/[.#][\w-]+\s*\{|\b(color|display|margin|padding|font-size)\s*:/.test(code)) {
    return "css";
  }

  if (/^\s*[\[{]/.test(code)) {
    return "json";
  }

  return "text";
}

function looksLikeCodeLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  return (
    /\b(public|private|protected|class|static|void|String|int|boolean|System\.out)\b/.test(trimmed) ||
    /<\/?[A-Za-z][\w:-]*(\s|>|\/)/.test(trimmed) ||
    /^\s*(const|let|var|function|if|for|while|return)\b/.test(trimmed) ||
    /=>|[{};]|[.#][\w-]+\s*\{/.test(trimmed) ||
    /\b(color|display|margin|padding|font-size|background)\s*:/.test(trimmed)
  );
}

function splitLooseCode(text: string): RichSegment[] | null {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return null;

  const firstCodeLine = lines.findIndex(looksLikeCodeLine);
  if (firstCodeLine < 0) return null;

  const intro = lines.slice(0, firstCodeLine).join("\n").trimEnd();
  const code = lines.slice(firstCodeLine).join("\n").trimEnd();

  if (!code) return null;

  return [
    ...(intro ? [{ kind: "text" as const, value: intro }] : []),
    { kind: "code" as const, value: code, language: normalizeLanguage(undefined, code), block: true },
  ];
}

function parseRichText(text: string): RichSegment[] {
  CODE_FENCE_PATTERN.lastIndex = 0;

  const segments: RichSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = CODE_FENCE_PATTERN.exec(text))) {
    if (match.index > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, match.index) });
    }

    const code = match[2].replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    segments.push({
      kind: "code",
      value: code,
      language: normalizeLanguage(match[1], code),
      block: true,
    });
    cursor = match.index + match[0].length;
  }

  if (segments.length > 0) {
    if (cursor < text.length) {
      segments.push({ kind: "text", value: text.slice(cursor) });
    }
    return segments;
  }

  const looseCode = splitLooseCode(text);
  if (looseCode) return looseCode;

  INLINE_CODE_PATTERN.lastIndex = 0;
  cursor = 0;
  while ((match = INLINE_CODE_PATTERN.exec(text))) {
    if (match.index > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, match.index) });
    }
    segments.push({
      kind: "code",
      value: match[1],
      language: normalizeLanguage(undefined, match[1]),
      block: false,
    });
    cursor = match.index + match[0].length;
  }

  if (segments.length > 0) {
    if (cursor < text.length) {
      segments.push({ kind: "text", value: text.slice(cursor) });
    }
    return segments;
  }

  return [{ kind: "text", value: text }];
}

function tokenize(code: string): Token[] {
  const patterns: Array<{ kind: Exclude<TokenKind, "text">; pattern: RegExp }> = [
    { kind: "comment", pattern: /\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/y },
    { kind: "comment", pattern: /<!--[\s\S]*?-->/y },
    { kind: "string", pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/y },
  ];

  const tokens: Token[] = [];
  let cursor = 0;
  let textBuffer = "";

  const flushText = () => {
    if (textBuffer) {
      tokens.push({ kind: "text", value: textBuffer });
      textBuffer = "";
    }
  };

  while (cursor < code.length) {
    let matched = false;

    for (const { kind, pattern } of patterns) {
      pattern.lastIndex = cursor;
      const match = pattern.exec(code);
      if (!match) continue;

      flushText();
      tokens.push({ kind, value: match[0] });
      cursor += match[0].length;
      matched = true;
      break;
    }

    if (!matched) {
      textBuffer += code[cursor];
      cursor += 1;
    }
  }

  flushText();
  return tokens;
}

function highlightTextToken(value: string, language: CodeLanguage) {
  let html = escapeHtml(value);

  if (language === "html") {
    html = html.replace(
      /(&lt;\/?)([A-Za-z][\w:-]*)([^&]*?&gt;)/g,
      (_match, open: string, tag: string, rest: string) => {
        const highlightedRest = rest.replace(
          /([A-Za-z_:][-A-Za-z0-9_:.]*)(=)/g,
          '<span class="qc-code-token qc-code-token--attr">$1</span>$2',
        );
        return `${open}<span class="qc-code-token qc-code-token--tag">${tag}</span>${highlightedRest}`;
      },
    );
  }

  const keywords = KEYWORDS[language];
  if (keywords.length > 0) {
    const keywordPattern = new RegExp(`\\b(${keywords.map(escapeRegExp).join("|")})\\b`, "g");
    html = html.replace(keywordPattern, '<span class="qc-code-token qc-code-token--keyword">$1</span>');
  }

  return html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="qc-code-token qc-code-token--number">$1</span>');
}

function highlightCode(code: string, language: CodeLanguage) {
  return tokenize(code)
    .map((token) => {
      if (token.kind === "text") {
        return highlightTextToken(token.value, language);
      }

      return `<span class="qc-code-token qc-code-token--${token.kind}">${escapeHtml(token.value)}</span>`;
    })
    .join("");
}

function renderSegment(segment: RichSegment) {
  if (segment.kind === "text") {
    return escapeHtml(segment.value).replace(/\r?\n/g, "<br />");
  }

  const highlighted = highlightCode(segment.value, segment.language);
  const languageLabel = segment.language === "javascript" ? "JS" : segment.language.toUpperCase();

  if (!segment.block) {
    return `<span class="qc-inline-code">${highlighted}</span>`;
  }

  return `<span class="qc-code-block" data-language="${languageLabel}"><code>${highlighted}</code></span>`;
}

function renderRichText(text: string) {
  return parseRichText(text).map(renderSegment).join("");
}

function shouldEnhanceElement(element: Element) {
  if (
    element.closest(".qc-code-block, .qc-inline-code, pre, code, textarea, input, svg") ||
    element.children.length > 0
  ) {
    return false;
  }

  const text = element.textContent || "";
  if (!text.trim()) return false;

  const currentSource = element.getAttribute("data-qc-code-source");
  if (currentSource === text) return false;

  return (
    text.includes("```") ||
    INLINE_CODE_PATTERN.test(text) ||
    splitLooseCode(text) !== null
  );
}

function enhanceCodeBlocks(scope: HTMLElement) {
  const candidates = Array.from(scope.querySelectorAll("h1, h2, h3, h4, p, span, div"));

  for (const element of candidates) {
    if (!shouldEnhanceElement(element)) continue;

    const text = element.textContent || "";
    element.innerHTML = renderRichText(text);
    element.setAttribute("data-qc-code-source", text);
    element.classList.add("qc-rich-text");
  }
}

export function CodeSyntaxScope({ children }: { children: ReactNode }) {
  const scopeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;

    let frame = 0;
    const run = () => {
      frame = 0;
      enhanceCodeBlocks(scope);
    };
    const scheduleRun = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(run);
    };

    scheduleRun();
    const observer = new MutationObserver(scheduleRun);
    observer.observe(scope, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={scopeRef}>{children}</div>;
}
