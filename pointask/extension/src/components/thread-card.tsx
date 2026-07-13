import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PendingThread } from '../bridge/pending-thread-manager';
import type { AnswerSourceLocator, LocalThread, PointAskWorkspace } from '../shared/local-thread';
import { RichContentRenderer } from './rich-content-renderer';
import { richPlainText } from '../shared/rich-content';

interface ThreadCardProps {
  thread: LocalThread; workspace?: PointAskWorkspace; pending: PendingThread | null; copied: boolean; error?: string; manualBranch: boolean; expanded: boolean; sending: boolean; menuOverlay: HTMLElement;
  onToggle(): void; onDelete(): void; onCopy(): void; onOpenTarget(): void; onManualBranch(): void; onCancel(): void;
  onOpenAnswer(): void; onContinue(): void; onDeleteRound(messageId: string): void; onModifyAssociation(): void;
  onUnlinkAssociation(): void; onNewWorkspace(): void; onViewAnswer(locator: AnswerSourceLocator): void;
  onUndoAttachment(): void; onGoCandidate(): void;
  onUpdateWorkspaceContext(): void;
}

const summary = (text: string) => text.length > 48 ? `${text.slice(0, 48)}…` : text;
const MENU_MARGIN = 8;
const MENU_GAP = 4;

function MoreMenu({ label, expanded, overlay, children }: { label: string; expanded: boolean; overlay: HTMLElement; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!expanded) setOpen(false); }, [expanded]);
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const position = () => {
      const trigger = triggerRef.current; const menu = menuRef.current;
      if (!trigger?.isConnected || !menu?.isConnected) { setOpen(false); return; }
      const rect = trigger.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) { setOpen(false); return; }
      const width = Math.min(Math.max(190, menu.scrollWidth), Math.max(1, window.innerWidth - MENU_MARGIN * 2));
      const below = Math.max(0, window.innerHeight - rect.bottom - MENU_GAP - MENU_MARGIN);
      const above = Math.max(0, rect.top - MENU_GAP - MENU_MARGIN);
      const openAbove = below < Math.min(menu.scrollHeight, 240) && above > below;
      const available = Math.max(1, openAbove ? above : below);
      const height = Math.min(menu.scrollHeight, available);
      const left = Math.min(Math.max(MENU_MARGIN, rect.right - width), Math.max(MENU_MARGIN, window.innerWidth - width - MENU_MARGIN));
      const top = openAbove ? Math.max(MENU_MARGIN, rect.top - MENU_GAP - height) : Math.min(window.innerHeight - MENU_MARGIN - height, rect.bottom + MENU_GAP);
      Object.assign(menu.style, { position: 'fixed', left: `${left}px`, top: `${Math.max(MENU_MARGIN, top)}px`, width: `${width}px`, maxHeight: `${available}px`, visibility: 'visible' });
      frame = window.requestAnimationFrame(position);
    };
    position();
    const outside = (event: PointerEvent) => {
      const path = event.composedPath();
      if (!path.includes(triggerRef.current as EventTarget) && !path.includes(menuRef.current as EventTarget)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); } };
    window.addEventListener('pointerdown', outside, true); window.addEventListener('keydown', key, true);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key, true); };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" className="pointask-more-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen((value) => !value)}>···</button>
    {open && createPortal(<div ref={menuRef} className="pointask-more-menu" role="menu" onClick={() => setOpen(false)}>{children}</div>, overlay)}
  </>;
}

export function ThreadCard(props: ThreadCardProps) {
  const { thread, error, manualBranch, expanded, sending } = props;
  const answers = thread.messages.filter((message) => message.role === 'assistant');
  const latestAnswer = answers.at(-1);
  const questionTitle = richPlainText(thread.messages.find((message) => message.role === 'user')?.content ?? []);
  const rounds = thread.messages.filter((message) => message.role === 'user').length;
  const waitingSubmission = thread.status === 'draft' || thread.status === 'prompt_ready' || thread.status === 'waiting_for_submission';
  const waitingAnswer = thread.status === 'waiting_for_answer' || thread.status === 'generating';
  const answerReady = thread.status === 'answer_ready';
  const attached = thread.status === 'answer_attached';
  const currentConversation = thread.answerMode === 'current_conversation';
  const modeLabel = thread.answerMode === 'workspace' ? '共享追问空间' : thread.answerMode === 'current_conversation' ? '当前对话' : '独立分支';
  const failed = thread.status === 'failed';
  const statusLabel = sending || waitingSubmission ? '正在发送……' : waitingAnswer ? (currentConversation ? '正在回答' : '正在等待回答……') : answerReady ? '回答已生成'
    : attached ? '已附加' : failed ? '发送失败' : '关联失效';
  const primaryLabel = attached ? '继续追问' : currentConversation && (waitingAnswer || answerReady) ? '查看新回答'
    : failed ? '重新发送' : '查看回答';
  const primaryAction = attached ? props.onContinue : currentConversation && (waitingAnswer || answerReady)
    ? props.onGoCandidate : failed ? props.onOpenTarget : props.onOpenAnswer;
  const showPrimary = attached || answerReady || failed || currentConversation && waitingAnswer;

  return <pointask-thread-card>
    <header className="pointask-thread-header">
      <button type="button" className="pointask-toggle" aria-expanded={expanded} onClick={props.onToggle}>
        <span className={`pointask-status-dot pointask-status-${thread.status}`} aria-hidden="true" />
        <span className="pointask-summary"><b>{thread.displayId}</b><span>{summary(questionTitle || thread.anchor.selectedText)}</span></span>
        <span className="pointask-count">{rounds} 轮</span>
      </button>
      <div className="pointask-header-actions" aria-label={`${thread.displayId} 快捷操作`}>
        {showPrimary && <button type="button" className="pointask-quick pointask-primary-action" onClick={primaryAction}>{primaryLabel}</button>}
        <MoreMenu label={`${thread.displayId} 更多操作`} expanded={expanded} overlay={props.menuOverlay}>
          {latestAnswer?.answerSource && <button type="button" onClick={() => props.onViewAnswer(latestAnswer.answerSource!)}>查看原回答</button>}
          {attached && <button type="button" onClick={props.onUndoAttachment}>撤销附加</button>}
          {attached && <button type="button" onClick={props.onOpenAnswer}>替换回答</button>}
          <button type="button" onClick={props.onModifyAssociation}>修改关联页面</button>
          <button type="button" onClick={props.onUnlinkAssociation}>解除关联</button>
          {thread.answerMode === 'workspace' && <button type="button" onClick={props.onNewWorkspace}>创建新追问空间</button>}
          <button type="button" onClick={props.onCopy}>备用：复制提示词</button>
          <button type="button" className="pointask-danger" onClick={props.onDelete}>删除线程</button>
        </MoreMenu>
      </div>
    </header>
    {expanded && <div className="pointask-thread-body">
      <div className="pointask-status" role="status"><strong>{thread.displayId} · {modeLabel}</strong><br />
        <span className="pointask-status-line"><span className={`pointask-status-dot pointask-status-${thread.status}`} aria-hidden="true" />{statusLabel}</span></div>
      {thread.answerMode === 'current_conversation' && <p className="pointask-warning">当前对话回答：此局部问答同时存在于 ChatGPT 主聊天记录中。</p>}
      {thread.answerMode === 'workspace' && props.workspace && <div className="pointask-workspace-context" role="status">
        <span>{props.workspace.contextState.status === 'fresh' ? '上下文已更新' : props.workspace.contextState.status === 'outdated'
          ? `主对话此后新增 ${props.workspace.contextState.unsyncedTurnCount} 轮` : '无法确认上次同步位置'}</span>
        <button type="button" className="pointask-primary" onClick={props.onUpdateWorkspaceContext}>更新上下文</button>
      </div>}
      <div className="pointask-selection"><strong>选中文字</strong><div className="pointask-selection-content">{thread.richSelection ? <RichContentRenderer blocks={thread.richSelection.blocks} /> : thread.anchor.selectedText}</div></div>
      {thread.messages.map((message, index) => <div className={`pointask-message pointask-${message.role}`} key={message.id}>
        <strong>{message.role === 'user' ? `用户问题 ${thread.messages.slice(0, index + 1).filter((item) => item.role === 'user').length}` : 'ChatGPT 回答（用户手动附加）'}</strong>
        <div className="pointask-message-content"><RichContentRenderer blocks={message.content} /></div>
        {message.role === 'assistant' && message.answerSource && <button type="button" onClick={() => props.onViewAnswer(message.answerSource!)}>查看原回答</button>}
        {message.role === 'user' && answers.length > 1 && <button type="button" onClick={() => props.onDeleteRound(message.id)}>删除本轮</button>}
      </div>)}
      {error && <p className="pointask-error" role="alert">{error}</p>}
      {error && <div className="pointask-error-actions"><button type="button" onClick={props.onManualBranch}>重新关联当前页面</button><button type="button" onClick={props.onOpenAnswer}>打开已关联页面</button><button type="button" onClick={props.onCancel}>取消当前操作</button></div>}
      {manualBranch && <p>请在目标 ChatGPT 页面重新关联当前线程。</p>}
    </div>}
  </pointask-thread-card>;
}
