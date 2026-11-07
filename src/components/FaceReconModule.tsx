import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CircleAlert,
  Fingerprint,
  Layers,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRoundSearch,
} from 'lucide-react';
import type { InvestigationCase } from '../types/osint';
import {
  bandLabel,
  rankCandidates,
  clusterFaces,
  type FaceCandidate,
  type RankedFaceMatch,
  type SimilarityBand,
} from '../utils/faceMatch';
import {
  harvestAvatars,
  harvestWikidataPortrait,
  fetchImageObjectUrl,
  type HarvestedCandidate,
} from '../services/referenceHarvest';
import { detectFaces, type DetectedFace } from '../services/faceEngine';
import { Panel, Well, Button, TextField, FieldLabel, NoticeBanner, EmptyState } from './ui';

interface FaceReconModuleProps {
  activeCase: InvestigationCase;
  onAppendLedger: (entry: {
    module: 'face';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
  }) => void;
}

interface QueryImageState {
  name: string;
  objectUrl: string;
  faces: DetectedFace[];
  selectedFaceIndex: number;
}

const BAND_CHIP: Record<SimilarityBand, string> = {
  STRONG_SIMILARITY: 'border-l-live bg-live/10 text-live',
  POSSIBLE_MATCH: 'border-l-derived bg-derived/10 text-derived',
  WEAK_SIGNAL: 'border-l-gap bg-gap/10 text-gap',
  NO_MATCH: 'border-l-line bg-well text-ink-3',
};

const SOURCE_CHIP: Record<FaceCandidate['sourceType'], string> = {
  UPLOAD: 'border-line text-ink-3',
  AVATAR_HARVEST: 'border-line text-ink-2',
  WIKIDATA_PORTRAIT: 'border-line text-accent',
};

/**
 * Face Recon bench: local-only face matching. Every heavy dependency
 * (the human ML runtime) is dynamically imported on first use, so the
 * main bundle stays lean until an analyst actually opens the bench.
 */
export const FaceReconModule: React.FC<FaceReconModuleProps> = ({
  activeCase,
  onAppendLedger,
}) => {
  const [engineError, setEngineError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [queryImage, setQueryImage] = useState<QueryImageState | null>(null);
  const [queryBusy, setQueryBusy] = useState(false);
  const [corpus, setCorpus] = useState<HarvestedCandidate[]>([]);
  const [corpusBusyText, setCorpusBusyText] = useState<string | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [results, setResults] = useState<RankedFaceMatch[] | null>(null);
  const [clusters, setClusters] = useState<string[][] | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [portraitNameInput, setPortraitNameInput] = useState('');

  const objectUrlsRef = useRef<string[]>([]);
  const trackObjectUrl = (url: string) => {
    objectUrlsRef.current.push(url);
    return url;
  };
  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  const loadQueryImage = useCallback(async (file: File) => {
    setQueryBusy(true);
    setEngineError(null);
    setResults(null);
    try {
      const objectUrl = trackObjectUrl(URL.createObjectURL(file));
      const faces = await detectFaces(file);
      setQueryImage({
        name: file.name,
        objectUrl,
        faces,
        selectedFaceIndex: faces.length > 0 ? 0 : -1,
      });
      if (faces.length === 0) {
        setEngineError(
          `No face detected in “${file.name}”. The image loaded fine — it just contains no face the detector can find.`
        );
      }
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueryBusy(false);
    }
  }, []);

  const addCorpusFiles = useCallback(async (files: File[]) => {
    setCorpusBusyText(`Embedding ${files.length} local image${files.length === 1 ? '' : 's'}…`);
    setGaps((prev) => [...prev]);
    const added: HarvestedCandidate[] = [];
    const newGaps: string[] = [];
    for (const file of files) {
      try {
        const objectUrl = trackObjectUrl(URL.createObjectURL(file));
        const faces = await detectFaces(file);
        const best =
          faces
            .filter((f) => f.embedding && f.embedding.length > 0)
            .sort((a, b) => b.score - a.score)[0] ?? null;
        if (!best || !best.embedding) {
          newGaps.push(`${file.name}: no detectable face — added as reference, excluded from matching`);
          added.push({
            id: `file:${file.name}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
            label: file.name,
            sourceType: 'UPLOAD',
            sourceUrl: 'local file upload',
            embedding: [],
            ageEstimate: null,
            genderEstimate: null,
            thumbnailUrl: objectUrl,
            embedError: 'no detectable face',
          });
          continue;
        }
        added.push({
          id: `file:${file.name}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
          label: file.name,
          sourceType: 'UPLOAD',
          sourceUrl: 'local file upload',
          embedding: best.embedding,
          ageEstimate: best.ageEstimate,
          genderEstimate: best.genderEstimate,
          thumbnailUrl: best.thumbnailDataUrl ?? objectUrl,
        });
      } catch (err) {
        newGaps.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setCorpus((prev) => [...prev, ...added]);
    if (newGaps.length > 0) setGaps((prev) => [...prev, ...newGaps]);
    setCorpusBusyText(null);
  }, []);

  const addUsernameAvatars = useCallback(async () => {
    const handle = usernameInput.trim();
    if (!handle) return;
    setCorpusBusyText(`Sweeping avatar sources for @${handle}…`);
    try {
      const { candidates, gaps: harvestGaps } = await harvestAvatars(handle);
      setCorpus((prev) => [...prev, ...candidates]);
      setGaps((prev) => [...prev, ...harvestGaps.map((g) => `${g.source}: ${g.error}`)]);
    } catch (err) {
      setGaps((prev) => [
        ...prev,
        `avatar sweep: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    } finally {
      setCorpusBusyText(null);
    }
  }, [usernameInput]);

  const addWikidataPortrait = useCallback(async () => {
    const name = portraitNameInput.trim();
    if (!name) return;
    setCorpusBusyText(`Resolving ${name} on Wikidata → P18 portrait…`);
    try {
      const res = await harvestWikidataPortrait(name);
      if (res.ok) {
        setCorpus((prev) => [...prev, res.candidate]);
      } else {
        setGaps((prev) => [...prev, `Wikidata “${name}”: ${res.detail}`]);
      }
    } finally {
      setCorpusBusyText(null);
    }
  }, [portraitNameInput]);

  const addImageFromUrl = useCallback(async (label: string, url: string) => {
    setCorpusBusyText(`Fetching reference image…`);
    try {
      const objectUrl = await fetchImageObjectUrl(url);
      trackObjectUrl(objectUrl);
      const blob = await (await fetch(objectUrl)).blob();
      const faces = await detectFaces(blob);
      const best =
        faces
          .filter((f) => f.embedding && f.embedding.length > 0)
          .sort((a, b) => b.score - a.score)[0] ?? null;
      setCorpus((prev) => [
        ...prev,
        {
          id: `url:${url}:${Date.now()}`,
          label,
          sourceType: 'UPLOAD',
          sourceUrl: url,
          embedding: best?.embedding ?? [],
          ageEstimate: best?.ageEstimate ?? null,
          genderEstimate: best?.genderEstimate ?? null,
          thumbnailUrl: best?.thumbnailDataUrl ?? objectUrl,
          embedError: best ? undefined : 'no detectable face',
        },
      ]);
      if (!best) setGaps((prev) => [...prev, `${label}: no detectable face in reference image`]);
    } catch (err) {
      setGaps((prev) => [...prev, `${label}: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setCorpusBusyText(null);
    }
  }, []);

  const selectedQueryFace =
    queryImage && queryImage.selectedFaceIndex >= 0
      ? queryImage.faces[queryImage.selectedFaceIndex]
      : null;

  const comparableCorpusCount = corpus.filter(
    (c) => c.embedding && c.embedding.length > 0
  ).length;

  const runMatch = useCallback(() => {
    if (!selectedQueryFace?.embedding || comparableCorpusCount === 0) return;
    setClusters(null);
    setResults(
      rankCandidates(
        selectedQueryFace.embedding,
        corpus.filter((c) => c.embedding && c.embedding.length > 0)
      )
    );
  }, [selectedQueryFace, comparableCorpusCount, corpus]);

  const runClustering = useCallback(() => {
    if (comparableCorpusCount === 0) return;
    setResults(null);
    setClusters(
      clusterFaces(
        corpus.filter((c) => c.embedding && c.embedding.length > 0),
        0.5
      )
    );
  }, [comparableCorpusCount, corpus]);

  const candidateById = (id: string) => corpus.find((c) => c.id === id);

  const topMatch = results?.find((r) => r.similarity != null) ?? null;

  const saveToLedger = useCallback(() => {
    if (!selectedQueryFace || !queryImage) return;
    const summary = topMatch && topMatch.similarity != null
      ? `Face similarity analysis (local FaceRes embeddings, browser-only): top reference “${topMatch.candidate.label}” scored ${topMatch.similarity.toFixed(3)} (${bandLabel(topMatch.band!)} of ${comparableCorpusCount} references). Heuristic triage signal — not proof of identity.`
      : `Face corpus analysis (local FaceRes embeddings, browser-only): ${corpus.length} references embedded, no comparable match computed. Heuristic triage signal — not proof of identity.`;
    onAppendLedger({
      module: 'face',
      targetLabel: queryImage.name,
      findingSummary: summary,
      sourceUrl: topMatch?.candidate.sourceUrl ?? 'local://face-recon',
    });
  }, [selectedQueryFace, queryImage, topMatch, comparableCorpusCount, corpus.length, onAppendLedger]);

  const removeCorpusEntry = (id: string) => {
    setCorpus((prev) => prev.filter((c) => c.id !== id));
    setResults(null);
    setClusters(null);
  };

  return (
    <div className="space-y-4">
      <Panel
        tag="08"
        title="Face Recon"
        description="Local face embeddings — detection, deep descriptors and matching run entirely in this browser. Reference portraits are fetched from zero-key public sources; the photos themselves never leave the machine."
      >
        <NoticeBanner tone="hypothesis" icon={<ShieldCheck />}>
          <span className="font-semibold">Method disclosure.</span> Similarity
          scores come from FaceRes descriptors and are <em>triage signals,
          never proof of identity</em> (≥0.55 strong, 0.45–0.55 possible,
          0.30–0.45 weak). There is no free public whole-web face index —
          anything claiming one is a commercial engine. This bench matches
          against corpora you control: uploaded folders, username avatars, and
          named-person portraits from Wikidata.
        </NoticeBanner>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ---- Left: query + corpus assembly ---- */}
        <div className="space-y-4">
          <Panel
            tag="Q"
            title="Query face"
            description="Upload the probe photo. Multiple faces are detected and selectable — the largest-confidence one is preselected."
            actions={
              <label>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void loadQueryImage(file);
                    e.currentTarget.value = '';
                  }}
                />
                <span className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded border border-line bg-well px-2.5 text-xs font-medium text-ink hover:border-accent">
                  {queryBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Upload photo
                </span>
              </label>
            }
          >
            {!queryImage && !queryBusy && (
              <EmptyState
                icon={<Camera className="h-5 w-5" />}
                title="No probe photo loaded"
                hint="Drop in a JPEG/PNG/WebP. Detection and embedding happen locally — the file is not uploaded anywhere."
              />
            )}
            {queryImage && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <img
                    src={queryImage.objectUrl}
                    alt={`Probe photo: ${queryImage.name}`}
                    className="max-h-40 rounded border border-line object-contain"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="truncate font-mono text-xs text-ink-2" title={queryImage.name}>
                      {queryImage.name}
                    </div>
                    <div className="text-xs text-ink-3">
                      {queryImage.faces.length === 0
                        ? 'No face detected'
                        : `${queryImage.faces.length} face${queryImage.faces.length === 1 ? '' : 's'} detected — pick the subject:`}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {queryImage.faces.map((face) => (
                        <button
                          key={face.index}
                          type="button"
                          onClick={() =>
                            setQueryImage((prev) =>
                              prev ? { ...prev, selectedFaceIndex: face.index } : prev
                            )
                          }
                          className={`rounded border p-0.5 transition-colors ${
                            face.index === queryImage.selectedFaceIndex
                              ? 'border-accent bg-well'
                              : 'border-line hover:border-line-strong'
                          }`}
                          title={`Face ${face.index + 1} — detector confidence ${(face.score * 100).toFixed(0)}%`}
                        >
                          {face.thumbnailDataUrl ? (
                            <img
                              src={face.thumbnailDataUrl}
                              alt={`Detected face ${face.index + 1}`}
                              className="h-12 w-12 rounded-sm object-cover"
                            />
                          ) : (
                            <span className="flex h-12 w-12 items-center justify-center text-[10px] text-ink-3">
                              #{face.index + 1}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    {selectedQueryFace && (
                      <div className="font-mono text-[11px] text-ink-3">
                        subject: face #{selectedQueryFace.index + 1} · conf{' '}
                        {(selectedQueryFace.score * 100).toFixed(0)}% · descriptor{' '}
                        {selectedQueryFace.embedding
                          ? `${selectedQueryFace.embedding.length}-d`
                          : 'UNAVAILABLE'}
                        {selectedQueryFace.ageEstimate != null &&
                          ` · age est. ~${selectedQueryFace.ageEstimate.toFixed(0)}`}
                        {selectedQueryFace.genderEstimate &&
                          ` · ${selectedQueryFace.genderEstimate} (${(100 * (selectedQueryFace.genderScore ?? 0)).toFixed(0)}%)`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Panel>

          <Panel
            tag="R"
            title="Reference corpus"
            description={`Zero-key sources only. ${comparableCorpusCount} of ${corpus.length} references carry usable descriptors.`}
          >
            <div className="space-y-3">
              <Well label="Add from username" className="p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-45 flex-1">
                    <FieldLabel htmlFor="face-username">Handle (e.g. torvalds)</FieldLabel>
                    <TextField
                      id="face-username"
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      placeholder="username"
                      icon={<UserRoundSearch className="h-4 w-4" />}
                    />
                  </div>
                  <Button
                    variant="solid"
                    size="md"
                    disabled={!usernameInput.trim() || corpusBusyText != null}
                    onClick={() => void addUsernameAvatars()}
                  >
                    <Search className="h-4 w-4" /> Sweep avatars
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-ink-3">
                  Pulls the same handle's avatar from unavatar.io (GitHub, X, Gravatar, …) and
                  GitHub's avatar endpoint, then embeds it locally.
                </p>
              </Well>

              <Well label="Verify named person (Wikidata)" className="p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-45 flex-1">
                    <FieldLabel htmlFor="face-wikidata">Person name</FieldLabel>
                    <TextField
                      id="face-wikidata"
                      value={portraitNameInput}
                      onChange={(e) => setPortraitNameInput(e.target.value)}
                      placeholder="e.g. Alan Turing"
                      icon={<Fingerprint className="h-4 w-4" />}
                    />
                  </div>
                  <Button
                    variant="solid"
                    size="md"
                    disabled={!portraitNameInput.trim() || corpusBusyText != null}
                    onClick={() => void addWikidataPortrait()}
                  >
                    Fetch portrait
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] leading-4 text-ink-3">
                  Resolves the entity's P18 image on Wikimedia Commons — one-to-one verification
                  against a named individual's public portrait.
                </p>
              </Well>

              <Well label="Add local images" className="p-3">
                <label>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length > 0) void addCorpusFiles(files);
                      e.currentTarget.value = '';
                    }}
                  />
                  <span className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded border border-line bg-well px-2.5 text-xs font-medium text-ink hover:border-accent">
                    <Upload className="h-3.5 w-3.5" /> Choose images…
                  </span>
                </label>
              </Well>

              {corpusBusyText && (
                <NoticeBanner tone="info" icon={<Loader2 className="animate-spin" />}>
                  {corpusBusyText}
                </NoticeBanner>
              )}

              {gaps.length > 0 && (
                <Well label={`Named data gaps (${gaps.length})`} className="p-3">
                  <ul className="space-y-1 text-[11px] leading-4 text-ink-3">
                    {gaps.slice(-8).map((gap, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-gap" />
                        {gap}
                      </li>
                    ))}
                  </ul>
                </Well>
              )}

              {corpus.length > 0 && (
                <Well label={`Corpus (${corpus.length})`} className="p-3">
                  <ul className="space-y-2">
                    {corpus.map((c) => (
                      <li key={c.id} className="flex items-center gap-2.5">
                        {c.thumbnailUrl ? (
                          <img
                            src={c.thumbnailUrl}
                            alt={c.label}
                            className="h-10 w-10 shrink-0 rounded border border-line object-cover"
                          />
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-line text-ink-3">
                            <Camera className="h-4 w-4" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-ink">{c.label}</div>
                          <div className="flex items-center gap-1.5">
                            <span className={`rounded border px-1 py-px font-mono text-[9px] uppercase ${SOURCE_CHIP[c.sourceType]}`}>
                              {c.sourceType === 'WIKIDATA_PORTRAIT'
                                ? 'Wikidata'
                                : c.sourceType === 'AVATAR_HARVEST'
                                  ? 'avatar'
                                  : 'file'}
                            </span>
                            <span className="truncate font-mono text-[10px] text-ink-3">
                              {c.embedding && c.embedding.length > 0
                                ? `${c.embedding.length}-d descriptor`
                                : c.embedError ?? 'no descriptor'}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${c.label} from corpus`}
                          onClick={() => removeCorpusEntry(c.id)}
                          className="shrink-0 text-ink-3 hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Well>
              )}
            </div>
          </Panel>
        </div>

        {/* ---- Right: matching + clustering ---- */}
        <div className="space-y-4">
          <Panel
            tag="M"
            title="Match results"
            description="Ranked descriptor similarity. Bands are heuristic triage — corroborate before concluding."
            actions={
              <div className="flex items-center gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!selectedQueryFace?.embedding || comparableCorpusCount === 0}
                  onClick={runMatch}
                >
                  Run match
                </Button>
                <Button
                  variant="solid"
                  size="sm"
                  disabled={comparableCorpusCount === 0}
                  onClick={runClustering}
                  icon={<Layers className="h-3.5 w-3.5" />}
                >
                  Cluster corpus
                </Button>
                {results && (
                  <Button variant="ghost" size="sm" onClick={saveToLedger}>
                    Save to case
                  </Button>
                )}
              </div>
            }
          >
            {!results && !clusters && (
              <EmptyState
                icon={<Fingerprint className="h-5 w-5" />}
                title={comparableCorpusCount === 0 ? 'No comparable references yet' : 'Ready to match'}
                hint={
                  comparableCorpusCount === 0
                    ? 'Add references above — uploads, avatar sweeps, or a named person’s Wikidata portrait.'
                    : 'Run a match to rank the corpus against the selected query face, or cluster the corpus to find same-person groups.'
                }
              />
            )}
            {results && (
              <ul className="space-y-2">
                {results.map((r) => (
                  <li
                    key={r.candidate.id}
                    className={`flex items-center gap-3 rounded border border-line border-l-2 bg-panel px-3 py-2 ${BAND_CHIP[r.band ?? 'NO_MATCH']}`}
                  >
                    {r.candidate.thumbnailUrl ? (
                      <img
                        src={r.candidate.thumbnailUrl}
                        alt={r.candidate.label}
                        className="h-11 w-11 shrink-0 rounded border border-line object-cover"
                      />
                    ) : (
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded border border-line text-ink-3">
                        <Camera className="h-4 w-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-ink">
                        {r.candidate.label}
                      </div>
                      <div className="font-mono text-[10px] text-ink-3">
                        {r.similarity == null
                          ? 'not comparable (descriptor mismatch)'
                          : `similarity ${r.similarity.toFixed(3)} · ${bandLabel(r.band!)}`}
                        {r.candidate.ageEstimate != null && ` · age est. ~${r.candidate.ageEstimate.toFixed(0)}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-sm font-semibold tabular-nums text-ink">
                        {r.similarity == null ? '—' : `${(r.similarity * 100).toFixed(1)}%`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {clusters && (
              <div className="space-y-2">
                <div className="text-xs text-ink-3">
                  {clusters.length} group{clusters.length === 1 ? '' : 's'} at 0.50 similarity
                  (union-find over descriptors):
                </div>
                {clusters.map((group, gi) => (
                  <Well key={gi} label={`Group ${gi + 1} · ${group.length} member${group.length === 1 ? '' : 's'}`} className="p-3">
                    <div className="flex flex-wrap gap-2">
                      {group.map((id) => {
                        const c = candidateById(id);
                        return (
                          <div key={id} className="w-14 text-center" title={c?.label ?? id}>
                            {c?.thumbnailUrl ? (
                              <img
                                src={c.thumbnailUrl}
                                alt={c.label}
                                className="h-12 w-12 rounded border border-line object-cover"
                              />
                            ) : (
                              <span className="flex h-12 w-12 items-center justify-center rounded border border-line text-ink-3">
                                <Camera className="h-4 w-4" />
                              </span>
                            )}
                            <div className="mt-0.5 truncate font-mono text-[9px] text-ink-3">
                              {c?.label ?? id}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Well>
                ))}
              </div>
            )}
          </Panel>

          {engineError && (
            <Panel tag="!" title="Engine status">
              <NoticeBanner tone="warn" icon={<CircleAlert />}>
                {engineError}
              </NoticeBanner>
            </Panel>
          )}

          <Panel tag="i" title="How this works">
            <ul className="space-y-1.5 text-xs leading-5 text-ink-2">
              <li>• Detection + landmarks + descriptors run on-device (WebGL, vendored model weights in <code className="font-mono text-[10px]">/models/human</code>) — the probe photo is never uploaded.</li>
              <li>• Reference portraits come from keyless public endpoints: unavatar.io, avatars.githubusercontent.com, Wikimedia Commons (via Wikidata P18). CORS-blocked fetches fall back to the local SSRF-guarded proxy.</li>
              <li>• Matching is cosine similarity between FaceRes descriptors (1024-d); clustering is union-find at 0.50.</li>
              <li>• Every score is a heuristic. The bench never claims identity — it ranks and labels, the analyst concludes.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
};
