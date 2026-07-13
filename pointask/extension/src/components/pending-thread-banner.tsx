import type { PendingAssociation } from '../bridge/runtime-messages';
import type { CandidateAnswer } from '../adapters/site-adapter';
import { RichContentRenderer } from './rich-content-renderer';

interface PendingThreadBannerProps {
  records: PendingAssociation[];
  copiedIds: Set<string>;
  errors: Map<string, string>;
  confirmingIds: Set<string>;
  candidates: Map<string, CandidateAnswer>;
  onCopy(id: string): void;
  onFill(id: string): void;
  onAssociate(id: string, confirmed: boolean): void;
  onReturn(id: string): void;
  onCancel(id: string): void;
  onClose(id: string): void;
  onAttachWhole(id: string): void;
  onSelectPartial(id: string): void;
  onUndo(id: string): void;
}

function summary(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function PendingThreadBanner({
  records, copiedIds, errors, confirmingIds, candidates, onCopy, onFill, onAssociate, onReturn, onCancel, onClose, onAttachWhole, onSelectPartial, onUndo,
}: PendingThreadBannerProps) {
  return (
    <div className="pointask-banner-list" aria-label="PointAsk 等待回答线程">
      {records.map((record) => {
        const pending = record.pendingThread;
        const manual = record.associationStatus === 'awaiting_manual_association';
        const attached = record.localThread.status === 'answer_attached';
        const candidate = candidates.get(pending.id);
        return (
          <section className="pointask-banner" key={pending.id}>
            <button type="button" className="pointask-banner-close" aria-label="关闭提示条" onClick={() => onClose(pending.id)}>×</button>
            <strong>{manual ? '关联手动分支' : attached ? '回答已附加到 PointAsk。' : '这是一个等待回答的 PointAsk 局部线程。'}</strong>
            <div className="pointask-banner-source">来源：{pending.richSelection ? <RichContentRenderer blocks={pending.richSelection.blocks} /> : `“${summary(pending.anchor.selectedText)}”`}</div>
            <p><b>线程：</b>{record.localThread.displayId}</p>
            <p><b>问题：</b>{pending.question}</p>
            {manual ? (
              <>
                <p>请先在 ChatGPT 中手动创建分支，然后将当前页面关联到此线程。</p>
                {confirmingIds.has(pending.id) ? (
                  <div className="pointask-banner-actions" role="alert">
                    <span>这会替换当前关联页面，是否确认？</span>
                    <button type="button" className="pointask-primary" onClick={() => onAssociate(pending.id, true)}>确认重新关联</button>
                    <button type="button" className="pointask-secondary" onClick={() => onAssociate(pending.id, false)}>取消</button>
                  </div>
                ) : (
                  <button type="button" className="pointask-primary" onClick={() => onAssociate(pending.id, false)}>
                    将当前 ChatGPT 页面关联到 PointAsk 线程
                  </button>
                )}
              </>
            ) : attached ? (
              <div className="pointask-banner-actions">
                <button type="button" className="pointask-primary" onClick={() => onReturn(pending.id)}>返回原文</button>
                <button type="button" className="pointask-secondary" onClick={() => onUndo(pending.id)}>撤销附加</button>
                <button type="button" className="pointask-secondary" onClick={() => onCancel(pending.id)}>取消关联</button>
              </div>
            ) : candidate ? (
              <>
                <p>{candidate.streaming ? '回答生成中' : '已可靠定位到此线程的新回答。请选择附加方式。'}</p>
                <div className="pointask-banner-actions">
                  <button type="button" className="pointask-primary" disabled={candidate.streaming} onClick={() => onAttachWhole(pending.id)}>一键附加整条回答</button>
                  <button type="button" className="pointask-secondary" onClick={() => onSelectPartial(pending.id)}>框选部分附加</button>
                  <button type="button" className="pointask-secondary" onClick={() => onReturn(pending.id)}>返回原文</button>
                </div>
              </>
            ) : (
              <>
                <p>点击填入后请检查内容，并由你手动发送。PointAsk 不会自动发送。</p>
                <div className="pointask-banner-actions">
                  <button type="button" className="pointask-primary" onClick={() => onFill(pending.id)}>填入输入框</button>
                  <button type="button" className="pointask-secondary" onClick={() => onCopy(pending.id)}>备用：复制提示词</button>
                  <button type="button" className="pointask-secondary" onClick={() => onSelectPartial(pending.id)}>前往选择回答</button>
                  <button type="button" className="pointask-secondary" onClick={() => onReturn(pending.id)}>返回来源页面</button>
                  <button type="button" className="pointask-secondary" onClick={() => onCancel(pending.id)}>取消关联</button>
                </div>
              </>
            )}
            <div className="pointask-banner-feedback" aria-live="polite">
              {copiedIds.has(pending.id) ? '已复制' : errors.get(pending.id)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
