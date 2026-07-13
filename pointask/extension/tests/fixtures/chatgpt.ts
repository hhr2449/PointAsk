export const chatGptFixture = `
  <main>
    <article data-testid="conversation-turn-1">
      <div data-message-author-role="user"><div class="markdown"><p id="user-text">脱敏用户问题</p></div></div>
    </article>
    <article data-testid="conversation-turn-2">
      <div data-message-author-role="assistant">
        <div class="markdown">
          <p id="assistant-first">第一段脱敏回答，包含一个可供选择的事实。</p>
          <p id="assistant-second">第二段脱敏回答，用于测试跨段落拒绝。</p>
        </div>
      </div>
    </article>
    <article data-testid="conversation-turn-3">
      <div data-message-author-role="assistant"><div class="markdown"><p id="assistant-other">另一条脱敏回答。</p></div></div>
    </article>
    <textarea id="composer">脱敏输入内容</textarea>
    <div id="editable" contenteditable="true">可编辑内容</div>
    <p id="ordinary">普通网页文字</p>
  </main>
`;
