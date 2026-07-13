import type { PendingThread } from '../bridge/pending-thread-manager';
import type { AnswerSourceLocator, LocalThread, PointAskWorkspace } from '../shared/local-thread';
import { RichContentRenderer } from './rich-content-renderer';
import { richPlainText } from '../shared/rich-content';

interface ThreadCardProps {
  thread: LocalThread; workspace?: PointAskWorkspace; pending: PendingThread | null; copied: boolean; error?: string; manualBranch: boolean; expanded: boolean;
  onToggle(): void; onDelete(): void; onCopy(): void; onOpenTarget(): void; onManualBranch(): void; onCancel(): void;
  onOpenAnswer(): void; onContinue(): void; onDeleteRound(messageId: string): void; onModifyAssociation(): void;
  onUnlinkAssociation(): void; onNewWorkspace(): void; onViewAnswer(locator: AnswerSourceLocator): void;
  onUndoAttachment(): void; onGoCandidate(): void; onAttachCandidate(): void;
  onUpdateWorkspaceContext(): void;
}

const summary = (text: string) => text.length > 48 ? `${text.slice(0, 48)}…` : text;

export function ThreadCard(props: ThreadCardProps) {
  const { thread, error, manualBranch, expanded } = props;
  const answers = thread.messages.filter((message) => message.role === 'assistant');
  const latestAnswer = answers.at(-1);
  const questionTitle = richPlainText(thread.messages.find((message) => message.role === 'user')?.content ?? []);
  const rounds = thread.messages.filter((message) => message.role === 'user').length;
  const waitingSubmission = thread.status === 'draft' || thread.status === 'prompt_ready' || thread.status === 'waiting_for_submission';
  const waitingAnswer = thread.status === 'waiting_for_answer' || thread.status === 'generating';
  const answerReady = thread.status === 'answer_ready';
  const attached = thread.status === 'answer_attached';
  const modeLabel = thread.answerMode === 'workspace' ? '共享追问空间' : thread.answerMode === 'current_conversation' ? '当前对话' : '独立分支';
  const statusLabel = waitingSubmission ? '等待发送' : waitingAnswer ? '正在回答' : answerReady ? '回答已生成' : attached ? '已附加' : thread.status === 'failed' ? '操作失败' : '关联失效';
  const primaryLabel = attached ? '继续追问' : answerReady && thread.answerMode === 'current_conversation' ? '一键附加'
    : waitingSubmission ? '发送追问' : '查看回答';
  const primaryAction = attached ? props.onContinue : answerReady && thread.answerMode === 'current_conversation'
    ? props.onAttachCandidate : waitingSubmission ? props.onOpenTarget : thread.answerMode === 'current_conversation' ? props.onGoCandidate : props.onOpenAnswer;

  return <pointask-thread-card>
    <header className="pointask-thread-header">
      <button type="button" className="pointask-toggle" aria-expanded={expanded} onClick={props.onToggle}>
        <span className={`pointask-status-dot pointask-status-${thread.status}`} aria-hidden="true" />
        <span className="pointask-summary"><b>{thread.displayId}</b><span>{summary(questionTitle || thread.anchor.selectedText)}</span></span>
        <span className="pointask-count">{rounds} 轮</span>
      </button>
      <div className="pointask-header-actions" aria-label={`${thread.displayId} 快捷操作`}>
        <button type="button" className="pointask-quick pointask-primary-action" onClick={primaryAction}>{primaryLabel}</button>
        {answerReady && thread.answerMode === 'current_conversation' && <button type="button" className="pointask-quick pointask-secondary-action" onClick={props.onGoCandidate}>框选附加</button>}
        <details className="pointask-more"><summary aria-label={`${thread.displayId} 更多操作`}>···</summary><div className="pointask-more-menu">
          {latestAnswer?.answerSource && <button type="button" onClick={() => props.onViewAnswer(latestAnswer.answerSource!)}>查看原回答</button>}
          {attached && <button type="button" onClick={props.onUndoAttachment}>撤销附加</button>}
          {attached && <button type="button" onClick={props.onOpenAnswer}>替换回答</button>}
          {answerReady && thread.answerMode === 'current_conversation' && <button type="button" onClick={props.onGoCandidate}>框选部分附加</button>}
          <button type="button" onClick={props.onModifyAssociation}>修改关联页面</button>
          <button type="button" onClick={props.onUnlinkAssociation}>解除关联</button>
          {thread.answerMode === 'workspace' && <button type="button" onClick={props.onNewWorkspace}>创建新追问空间</button>}
          <button type="button" onClick={props.onCopy}>备用：复制提示词</button>
          <button type="button" className="pointask-danger" onClick={props.onDelete}>删除线程</button>
        </div></details>
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
