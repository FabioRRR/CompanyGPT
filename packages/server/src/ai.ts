import { createHash } from 'node:crypto';

export const EMBEDDING_DIMENSIONS = 1024;

export interface Embedder {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface AnswerInput {
  gptName: string;
  instructions: string;
  question: string;
  contexts: { title: string; content: string }[];
}

export interface Llm {
  answer(input: AnswerInput): Promise<string>;
}

const tokens = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);

/**
 * Deterministische Demo-Embeddings (Hashing-Trick). Kein externer Dienst nötig –
 * für Entwicklung und Tests. In Produktion durch HttpEmbedder ersetzen.
 */
export class HashEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  async embed(texts: string[]) {
    return texts.map((t) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const w of tokens(t)) {
        const h = createHash('md5').update(w).digest();
        v[h.readUInt32LE(0) % this.dimensions] += h[4] & 1 ? 1 : -1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}

/** OpenAI-kompatibler Embeddings-Endpunkt (z. B. Voyage, Azure OpenAI, selbst gehostet). */
export class HttpEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  constructor(private url: string, private apiKey: string, private model: string) {}
  async embed(texts: string[]) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions })
    });
    if (!res.ok) throw new Error(`Embeddings fehlgeschlagen: ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

/** Demo-Antworten ohne Sprachmodell: wählt die passendsten Sätze aus den Quellen. */
export class ExtractiveLlm implements Llm {
  async answer({ question, contexts }: AnswerInput) {
    if (!contexts.length) return 'Dazu habe ich im freigegebenen Wissen nichts gefunden.';
    const q = new Set(tokens(question));
    const sentences = contexts.flatMap((c) => c.content.split(/(?<=[.!?])\s+|\n+/).map((s) => ({ s: s.trim(), title: c.title })))
      .filter((x, i, all) => x.s && all.findIndex((y) => y.s === x.s) === i)
      .map((x) => ({ ...x, score: tokens(x.s).filter((w) => q.has(w)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return sentences.map((x) => x.s).join(' ');
  }
}

/** Claude über die Anthropic Messages API. */
export class AnthropicLlm implements Llm {
  constructor(private apiKey: string, private model: string) {}
  async answer({ gptName, instructions, question, contexts }: AnswerInput) {
    const sources = contexts.map((c, i) => `<quelle nr="${i + 1}" titel="${c.title.replace(/"/g, "'")}">\n${c.content}\n</quelle>`).join('\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1200,
        system: `${instructions}\nDu bist ${gptName}. Antworte ausschließlich auf Basis der Quellen. Wenn die Quellen nicht reichen, sag das offen.`,
        messages: [{ role: 'user', content: `${sources}\n\nFrage: ${question}` }]
      })
    });
    if (!res.ok) throw new Error(`Sprachmodell-Anfrage fehlgeschlagen: ${res.status}`);
    const json = (await res.json()) as { content: { type: string; text?: string }[] };
    return json.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  }
}
