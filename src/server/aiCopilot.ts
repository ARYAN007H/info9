import { GoogleGenAI, Type } from '@google/genai';
import type { InvestigationCase, ProvenanceMeta } from '../types/osint';

export type CopilotMode = 'ner_extract' | 'ach_matrix' | 'next_pivots' | 'briefing_qa';

export interface CopilotAnalysisRequest {
  mode: CopilotMode;
  caseData: InvestigationCase;
  question?: string;
  rawText?: string;
}

export interface CopilotAnalysisResponse {
  mode: CopilotMode;
  model: string;
  provenance: ProvenanceMeta;
  summary: string;
  nerEntities?: Array<{
    label: string;
    type: string;
    verbatimQuote: string;
    sourceRef: string;
  }>;
  nerRelationships?: Array<{
    source: string;
    target: string;
    relation: string;
    verbatimQuote: string;
  }>;
  achHypotheses?: Array<{
    hypothesis: string;
    likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
    supportingEvidence: string[];
    contradictingEvidence: string[];
    missingEvidenceGaps: string[];
  }>;
  recommendedPivots?: Array<{
    title: string;
    rationale: string;
    moduleId: string;
    targetValue: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
  answer?: string;
  citations?: string[];
}

function getGenAiClient(): { ai: GoogleGenAI; model: string } {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured in the server environment. Configure GEMINI_API_KEY to enable the Evidence-Grounded AI Analyst Copilot.'
    );
  }
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return { ai, model };
}

function serializeCaseEvidenceContext(c: InvestigationCase, rawText?: string): string {
  const lines: string[] = [];
  lines.push(`CASE: ${c.codeName} — ${c.title} (${c.classification})`);
  lines.push(`SUMMARY: ${c.summary}`);

  if (c.entities.length > 0) {
    lines.push('\n[SAVED ENTITIES]');
    for (const e of c.entities.slice(0, 25)) {
      lines.push(`- ${e.label} (${e.type}, ${e.jurisdiction}, ${e.identifier}): ${e.summary}`);
    }
  }
  if (c.ownershipEdges.length > 0) {
    lines.push('\n[OWNERSHIP LINKS]');
    for (const edge of c.ownershipEdges.slice(0, 25)) {
      lines.push(
        `- ${edge.sourceId} -> ${edge.targetId}: ${edge.relationship} (${edge.ownershipPercent ?? '?'}%) [source: ${edge.verifiedSource}]`
      );
    }
  }
  if (c.infraRecords.length > 0) {
    lines.push('\n[INFRASTRUCTURE RECORDS]');
    for (const r of c.infraRecords.slice(0, 20)) {
      lines.push(
        `- Domain ${r.domain}: A=[${r.aRecords.join(',')}] ASN=${r.asn ?? 'unknown'} (${r.asnOrg ?? 'unknown'}) Registrar=${r.registrar ?? 'unknown'} Created=${r.createdAt ?? 'unknown'} Risk=${r.riskAssessment.score}/100 CT_Subs=${r.ctSubdomainsCount} DataGaps=[${r.dataGaps.join('; ')}]`
      );
    }
  }
  if ((c.enrichedProfiles ?? []).length > 0) {
    lines.push('\n[ENRICHED PROFILES]');
    for (const p of (c.enrichedProfiles ?? []).slice(0, 15)) {
      lines.push(
        `- ${p.platform} @${p.handle}: name=${p.displayName ?? 'n/a'} loc=${p.location ?? 'n/a'} company=${p.company ?? 'n/a'} emails=[${p.discoveredEmails.join(',')}] bio=${(p.bio ?? '').slice(0, 140)}`
      );
    }
  }
  if ((c.collectedPages ?? []).length > 0) {
    lines.push('\n[ARCHIVED WEB PAGES]');
    for (const pg of (c.collectedPages ?? []).slice(0, 10)) {
      lines.push(
        `- URL ${pg.url} (SHA-256 ${pg.sha256.slice(0, 12)}): title="${pg.title}" emails=[${pg.artifacts.emails.join(',')}] wallets=[${pg.artifacts.cryptoWallets.map((w) => w.address).join(',')}] trackers=[${pg.artifacts.analyticsIds.map((t) => t.id).join(',')}] excerpt="${pg.excerpt.slice(0, 280)}"`
      );
    }
  }
  if (c.evidenceLedger.length > 0) {
    lines.push('\n[HASH-CHAINED EVIDENCE LEDGER]');
    for (const l of c.evidenceLedger.slice(-25)) {
      lines.push(
        `- Ledger #${l.index} [${l.module}] (${l.timestampUtc}) ${l.targetLabel}: ${l.findingSummary} (source: ${l.sourceUrl})`
      );
    }
  }
  if (rawText?.trim()) {
    lines.push('\n[ANALYST-SUBMITTED DOCUMENT TEXT]');
    lines.push(rawText.trim().slice(0, 12_000));
  }

  return lines.join('\n').slice(0, 28_000);
}

/**
 * Runs Evidence-Grounded AI Analyst Copilot analysis using @google/genai (gemini-4-hydrogen).
 * Strictly bound to recorded evidence — every claim must cite recorded artifacts or flag gaps.
 */
export async function runEvidenceCopilotAnalysis(
  req: CopilotAnalysisRequest
): Promise<CopilotAnalysisResponse> {
  const { ai, model } = getGenAiClient();
  const context = serializeCaseEvidenceContext(req.caseData, req.rawText);
  const fetchedAtUtc = new Date().toISOString();
  const provenance: ProvenanceMeta = {
    status: 'DERIVED',
    source: `Gemini Case Analyst Copilot (${model})`,
    fetchedAtUtc,
    note: 'AI analytical synthesis derived strictly from recorded case evidence. Verify before publishing.',
  };

  if (req.mode === 'ner_extract') {
    const resp = await ai.models.generateContent({
      model,
      contents: `You are a forensic OSINT intelligence analyst. Extract all verifiable entities (person, company, domain, email, location, wallet, handle) and relationships from the evidence below.
CRITICAL RULE: Every extracted entity and relationship MUST include an exact verbatimQuote copied directly from the provided evidence text. Never invent facts not in the evidence.

EVIDENCE:
${context}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            nerEntities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  type: { type: Type.STRING },
                  verbatimQuote: { type: Type.STRING },
                  sourceRef: { type: Type.STRING },
                },
                required: ['label', 'type', 'verbatimQuote', 'sourceRef'],
              },
            },
            nerRelationships: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  source: { type: Type.STRING },
                  target: { type: Type.STRING },
                  relation: { type: Type.STRING },
                  verbatimQuote: { type: Type.STRING },
                },
                required: ['source', 'target', 'relation', 'verbatimQuote'],
              },
            },
          },
          required: ['summary', 'nerEntities', 'nerRelationships'],
        },
      },
    });
    const parsed = JSON.parse(resp.text || '{}') as Partial<CopilotAnalysisResponse>;
    return {
      mode: 'ner_extract',
      model,
      provenance,
      summary: parsed.summary || 'Entity & relationship extraction complete.',
      nerEntities: parsed.nerEntities ?? [],
      nerRelationships: parsed.nerRelationships ?? [],
    };
  }

  if (req.mode === 'ach_matrix') {
    const resp = await ai.models.generateContent({
      model,
      contents: `You are an intelligence analyst trained in Richards Heuer's Analysis of Competing Hypotheses (ACH).
Evaluate the recorded OSINT case evidence below and generate 2 to 4 distinct, falsifiable competing hypotheses.
For each hypothesis, explicitly cite supporting evidence from the case, contradicting or anomalous evidence, and missing evidence gaps that would disconfirm it. Never fabricate evidence.

EVIDENCE:
${context}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            achHypotheses: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  hypothesis: { type: Type.STRING },
                  likelihood: { type: Type.STRING, enum: ['HIGH', 'MEDIUM', 'LOW'] },
                  supportingEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
                  contradictingEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
                  missingEvidenceGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: [
                  'hypothesis',
                  'likelihood',
                  'supportingEvidence',
                  'contradictingEvidence',
                  'missingEvidenceGaps',
                ],
              },
            },
          },
          required: ['summary', 'achHypotheses'],
        },
      },
    });
    const parsed = JSON.parse(resp.text || '{}') as Partial<CopilotAnalysisResponse>;
    return {
      mode: 'ach_matrix',
      model,
      provenance,
      summary: parsed.summary || 'Analysis of Competing Hypotheses generated.',
      achHypotheses: parsed.achHypotheses ?? [],
    };
  }

  if (req.mode === 'next_pivots') {
    const resp = await ai.models.generateContent({
      model,
      contents: `You are a senior Bellingcat-style open-source investigator.
Review the recorded case artifacts below and recommend the 4 to 6 highest-yield next investigative pivots using available info9 modules:
- webhunter (open web search, dorks, page extractor)
- dossier (GLEIF, SEC EDGAR, CourtListener, ICIJ, maritime vessels)
- infra (passive DNS, Shodan, URLScan reverse-IP, OTX, favicon hash)
- identity (username sweep, profile enrichment, email PGP/breach, phone dorks)
- sanctions (OFAC SDN, OpenSanctions, crypto wallet trace)
- geolocation (coordinates, Overpass landmarks, shadow chronolocation)
- investigate (recursive multi-hop spider)
Only propose targetValue strings that are grounded in the case evidence.

EVIDENCE:
${context}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            recommendedPivots: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  moduleId: { type: Type.STRING },
                  targetValue: { type: Type.STRING },
                  priority: { type: Type.STRING, enum: ['HIGH', 'MEDIUM', 'LOW'] },
                },
                required: ['title', 'rationale', 'moduleId', 'targetValue', 'priority'],
              },
            },
          },
          required: ['summary', 'recommendedPivots'],
        },
      },
    });
    const parsed = JSON.parse(resp.text || '{}') as Partial<CopilotAnalysisResponse>;
    return {
      mode: 'next_pivots',
      model,
      provenance,
      summary: parsed.summary || 'Next-pivot investigation plan ready.',
      recommendedPivots: parsed.recommendedPivots ?? [],
    };
  }

  // Grounded Evidence Briefing Q&A
  const question =
    req.question?.trim() ||
    'Summarize the strongest verified links, key intelligence gaps, and timeline anomalies in this case.';
  const resp = await ai.models.generateContent({
    model,
    contents: `You are an evidence-grounded OSINT case analyst. Answer the analyst's question strictly using ONLY the recorded case evidence below.
If the evidence does not contain the answer, explicitly state what is missing rather than guessing.
List exact citations (ledger index, domain name, entity ID, or archived URL).

QUESTION: ${question}

EVIDENCE:
${context}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          answer: { type: Type.STRING },
          citations: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['summary', 'answer', 'citations'],
      },
    },
  });
  const parsed = JSON.parse(resp.text || '{}') as Partial<CopilotAnalysisResponse>;
  return {
    mode: 'briefing_qa',
    model,
    provenance,
    summary: parsed.summary || 'Grounded briefing generated.',
    answer: parsed.answer || '',
    citations: parsed.citations ?? [],
  };
}
