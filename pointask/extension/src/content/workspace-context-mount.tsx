import { createRoot, type Root } from 'react-dom/client';
import { WorkspaceContextUpdater } from '../components/workspace-context-updater';
import type { PointAskWorkspace, WorkspaceContextMessage } from '../shared/local-thread';
import { threadStyles } from './shadow-styles';

export class WorkspaceContextMount {
  private host: HTMLElement | null = null;
  private root: Root | null = null;
  open(workspace: PointAskWorkspace, messages: WorkspaceContextMessage[], handlers: {
    submit(messages: WorkspaceContextMessage[], label: string): void;
    useSelectionOnly(): void;
    createWorkspace(): void;
  }): void {
    this.close();
    this.host = document.createElement('pointask-workspace-context-updater'); this.host.dataset.pointaskOwned = 'true';
    const shadow = this.host.attachShadow({ mode: 'open' }); const style = document.createElement('style'); style.textContent = threadStyles;
    const mount = document.createElement('div'); shadow.append(style, mount); document.documentElement.append(this.host);
    this.root = createRoot(mount); this.root.render(<WorkspaceContextUpdater workspace={workspace} messages={messages}
      onCancel={() => this.close()} onSubmit={(selected, label) => { handlers.submit(selected, label); this.close(); }}
      onUseSelectionOnly={() => { handlers.useSelectionOnly(); this.close(); }} onCreateWorkspace={() => { handlers.createWorkspace(); this.close(); }} />);
  }
  close(): void { this.root?.unmount(); this.host?.remove(); this.root = null; this.host = null; }
}
