import { chunkText, findApp, planRollout } from '@companygpt/core';
import type { Embedder } from './ai';
import type { JobData, JobHandler, JobName, Mailer } from './infra';
import type { Store } from './store/types';

export interface JobDeps {
  store: Store;
  embedder: Embedder;
  mailer: Mailer;
  /** Lädt den Text einer Webseite – austauschbar für Tests */
  fetchText?: (url: string) => Promise<string>;
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'CompanyGPT-Indexer/1.0' } });
  if (!res.ok) throw new Error(`Seite nicht erreichbar (${res.status})`);
  const html = await res.text();
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Alle Hintergrund-Jobs. Laufen im Worker (Produktion) oder inline in der API (Entwicklung). */
export function createJobHandler(deps: JobDeps): JobHandler {
  const fetchText = deps.fetchText ?? defaultFetchText;

  const handlers: { [N in JobName]: (data: JobData[N]) => Promise<void> } = {
    async 'index-source'({ tenantId, sourceId }) {
      const src = await deps.store.getSource(tenantId, sourceId);
      if (!src || src.state === 'deleted') return;
      await deps.store.updateSource(tenantId, sourceId, { indexStatus: 'indexing' });
      try {
        let text = src.content ?? '';
        if (!text && src.kind === 'web' && src.url) text = await fetchText(src.url);
        const parts = chunkText(text);
        const embeddings: number[][] = [];
        for (let i = 0; i < parts.length; i += 64) embeddings.push(...(await deps.embedder.embed(parts.slice(i, i + 64))));
        await deps.store.replaceDraftChunks(tenantId, sourceId, src.collectionId, parts.map((content, i) => ({ content, embedding: embeddings[i] })));
        await deps.store.updateSource(tenantId, sourceId, { indexStatus: 'indexed' });
      } catch (e) {
        await deps.store.updateSource(tenantId, sourceId, { indexStatus: 'failed' });
        throw e;
      }
    },

    async 'send-email'(mail) {
      await deps.mailer.send(mail);
    },

    async rollout({ version, tenantIds, batchSize }) {
      const tenants = await deps.store.listTenants();
      const waves = planRollout(tenants, version, { only: tenantIds, batchSize: batchSize ?? 25 });
      for (const wave of waves) {
        await Promise.all(wave.map(async (t) => {
          await deps.store.updateTenant(t.id, { templateVersion: version, noticeVersion: version });
          await deps.store.logActivity(t.id, `${t.gptName} auf Vorlage v${version} aktualisiert.`);
        }));
      }
    },

    async 'sync-connection'({ tenantId, connectionId }) {
      const conn = await deps.store.getConnection(tenantId, connectionId);
      if (!conn || conn.state === 'removed') return;
      const app = findApp(conn.app);
      if (!app) throw new Error(`Unbekannte App: ${conn.app}`);
      // Je Bereich eine Quelle anlegen; die eigentlichen Dokumente liefert später der App-Connector.
      const existing = (await deps.store.listSources(tenantId)).filter((s) => s.connectionId === connectionId);
      for (const area of app.areas.filter((a) => conn.areas.includes(a.key))) {
        const name = `${app.name} · ${area.label}`;
        if (!existing.some((s) => s.name === name)) {
          await deps.store.createSource(tenantId, { kind: 'app', name, collectionId: conn.collectionId, connectionId, state: 'live' });
        }
      }
      await deps.store.updateConnection(tenantId, connectionId, { lastSyncAt: new Date().toISOString() });
    }
  };

  return async (name, data) => {
    const h = handlers[name] as (d: unknown) => Promise<void>;
    await h(data);
  };
}
