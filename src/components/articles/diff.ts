/**
 * Comparaison mot à mot de deux textes (plus longue sous-séquence commune).
 * Les mots sont comparés sans leurs espaces ; un texte long est d'abord aligné
 * par paragraphes, puis comparé mot à mot dans les seuls blocs modifiés.
 */

export type DiffPart = { type: "equal" | "insert" | "delete"; text: string };

/** Au-delà, la table LCS deviendrait trop coûteuse : repli sur un remplacement de bloc. */
const MAX_CELLS = 4_000_000;

type Step = { op: "=" | "-" | "+"; i: number; j: number };

function lcsSteps(a: readonly string[], b: readonly string[]): Step[] | null {
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? (dp[(i + 1) * w + j + 1] ?? 0) + 1
          : Math.max(dp[(i + 1) * w + j] ?? 0, dp[i * w + j + 1] ?? 0);
    }
  }
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      steps.push({ op: "=", i, j });
      i++;
      j++;
    } else if ((dp[(i + 1) * w + j] ?? 0) >= (dp[i * w + j + 1] ?? 0)) {
      steps.push({ op: "-", i, j });
      i++;
    } else {
      steps.push({ op: "+", i, j });
      j++;
    }
  }
  while (i < n) steps.push({ op: "-", i: i++, j });
  while (j < m) steps.push({ op: "+", i, j: j++ });
  return steps;
}

/** Mot précédé de ses espaces ; les espaces finaux forment un dernier jeton. */
function tokenize(s: string): string[] {
  return s.match(/\s*\S+|\s+$/g) ?? [];
}

function paragraphs(s: string): string[] {
  const out: string[] = [];
  const re = /\n[ \t]*\n\s*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out.push(s.slice(last, m.index + m[0].length));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

class PartBuilder {
  parts: DiffPart[] = [];
  private del = "";
  private ins = "";

  equal(text: string) {
    this.flush();
    this.push("equal", text);
  }
  delete(text: string) {
    this.del += text;
  }
  insert(text: string) {
    this.ins += text;
  }
  /** Regroupe suppressions puis ajouts d'un même passage modifié (plus lisible). */
  flush() {
    if (this.del) this.push("delete", this.del);
    if (this.ins) this.push("insert", this.ins);
    this.del = "";
    this.ins = "";
  }
  private push(type: DiffPart["type"], text: string) {
    if (!text) return;
    const last = this.parts[this.parts.length - 1];
    if (last && last.type === type) last.text += text;
    else this.parts.push({ type, text });
  }
  done(): DiffPart[] {
    this.flush();
    return this.parts;
  }
}

function diffTokens(out: PartBuilder, aTok: string[], bTok: string[]) {
  const ka = aTok.map((t) => t.trim());
  const kb = bTok.map((t) => t.trim());
  let pre = 0;
  while (pre < ka.length && pre < kb.length && ka[pre] === kb[pre]) pre++;
  let ea = ka.length;
  let eb = kb.length;
  while (ea > pre && eb > pre && ka[ea - 1] === kb[eb - 1]) {
    ea--;
    eb--;
  }
  for (let k = 0; k < pre; k++) out.equal(bTok[k] ?? "");
  const steps = lcsSteps(ka.slice(pre, ea), kb.slice(pre, eb));
  if (steps) {
    for (const s of steps) {
      if (s.op === "=") out.equal(bTok[pre + s.j] ?? "");
      else if (s.op === "-") out.delete(aTok[pre + s.i] ?? "");
      else out.insert(bTok[pre + s.j] ?? "");
    }
  } else {
    for (let k = pre; k < ea; k++) out.delete(aTok[k] ?? "");
    for (let k = pre; k < eb; k++) out.insert(bTok[k] ?? "");
  }
  for (let k = eb; k < bTok.length; k++) out.equal(bTok[k] ?? "");
}

export function diffWords(a: string, b: string): DiffPart[] {
  const out = new PartBuilder();
  if (a === b) {
    out.equal(b);
    return out.done();
  }
  const ta = tokenize(a);
  const tb = tokenize(b);
  if ((ta.length + 1) * (tb.length + 1) <= MAX_CELLS) {
    diffTokens(out, ta, tb);
    return out.done();
  }
  const pa = paragraphs(a);
  const pb = paragraphs(b);
  const steps = lcsSteps(
    pa.map((p) => p.trim()),
    pb.map((p) => p.trim()),
  );
  if (!steps) {
    out.delete(a);
    out.insert(b);
    return out.done();
  }
  let delBuf = "";
  let insBuf = "";
  const flushBlock = () => {
    if (delBuf || insBuf) diffTokens(out, tokenize(delBuf), tokenize(insBuf));
    delBuf = "";
    insBuf = "";
  };
  for (const s of steps) {
    if (s.op === "=") {
      flushBlock();
      out.equal(pb[s.j] ?? "");
    } else if (s.op === "-") delBuf += pa[s.i] ?? "";
    else insBuf += pb[s.j] ?? "";
  }
  flushBlock();
  return out.done();
}

export function diffStats(parts: DiffPart[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    const n = p.text.match(/\S+/g)?.length ?? 0;
    if (p.type === "insert") added += n;
    else if (p.type === "delete") removed += n;
  }
  return { added, removed };
}

export function hasChanges(parts: DiffPart[]): boolean {
  return parts.some((p) => p.type !== "equal" && p.text.trim() !== "");
}
