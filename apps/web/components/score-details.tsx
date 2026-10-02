'use client';
import type { AnalysisAssessment } from '@shotprompt/core';
import { toAnalysisDisplay } from '@/lib/analysis-view';
import { fmtTime } from '@/lib/format';
export function ScoreDetails({ assessment, onSeek }: { assessment: AnalysisAssessment; onSeek?: (time: number) => void }) {
  const view = toAnalysisDisplay({ score: null, assessment });
  const evidence = new Map(view.reasons.flatMap(r => r.evidence).map(e => [e.segmentId, e]));
  if (assessment.schemaVersion === 2) Object.values(assessment.dimensions).forEach(d => d.evidence.forEach(e => evidence.set(e.segmentId, e)));
  return <div className="space-y-2 text-[12px]">
    <p className="text-muted">{view.engineLabel}</p>
    {view.summary && <p className="break-words">{view.summary}</p>}
    <div className="flex flex-wrap gap-1">{view.tags.map(tag => <span key={tag} className="max-w-full break-words rounded bg-bg px-2 py-1">{tag}</span>)}</div>
    {view.reasons.map((reason, index) => <p key={index} className="break-words">{reason.text}</p>)}
    {view.warnings.map(warning => <p key={warning} className="text-accent">{warning}</p>)}
    <details><summary className="cursor-pointer py-1 text-accent">คะแนนและข้อความอ้างอิง</summary>
      <dl className="my-2 space-y-1">{view.dimensions.map(d => <div key={d.key} className="flex justify-between gap-2"><dt>{d.label}</dt><dd>{d.value}</dd></div>)}</dl>
      {[...evidence.values()].map(e => <blockquote key={e.segmentId} className="my-2 border-l-2 border-line3 pl-2"><button type="button" disabled={!onSeek} onClick={() => onSeek?.(e.start)} className="text-accent">{fmtTime(e.start)}</button><p className="whitespace-pre-wrap break-words">{e.text}</p></blockquote>)}
      <p className="text-muted">คะแนนช่วยจัดอันดับภายในรอบนี้ ประเมินเนื้อหาจากบทถอดเสียงและอาจคลาดเคลื่อนได้</p>
    </details>
  </div>;
}
